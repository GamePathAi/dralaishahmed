/**
 * POST /api/cron/lembretes — dispara o lembrete das consultas próximas.
 *
 * Feito para ser chamado de fora, por um agendador (cron do EC2, systemd timer
 * ou serviço equivalente), a cada 15 minutos:
 *
 *     curl -fsS -X POST https://.../api/cron/lembretes \
 *          -H "Authorization: Bearer $CRON_SECRET"
 *
 * Duas propriedades que o desenho garante:
 *
 * 1. **Não duplica.** A linha é *reservada* antes do envio: um `updateMany`
 *    condicionado a `lembreteEnviadoEm: null` só afeta uma linha uma vez. Duas
 *    execuções sobrepostas do cron não mandam dois e-mails para a mesma pessoa.
 *
 * 2. **Não perde.** A varredura é por estado da linha, não por "o que venceu
 *    desde a última execução". Se o cron ficar horas fora do ar, a rodada
 *    seguinte pega tudo que ainda está na janela. E se o SMTP falhar, a reserva
 *    é desfeita para a próxima rodada tentar de novo.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { notificarLinkConsulta } from "@/lib/notificacoes";
import { retomarTranscricoesPendentes } from "@/lib/ia/pipeline-notas";
import { FOLGA_ENCERRAMENTO_MIN } from "@/lib/agenda";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Antecedência do lembrete automático.
 *
 * A sala abre 15 min antes da consulta, então o lembrete com o link vale pouco
 * antes disso. Como o cron roda a cada 15 min, a janela de 20 min garante que
 * cada consulta é pega em algum tique entre ~5 e ~20 min antes — o link chega
 * enquanto a sala já está (ou está prestes a ficar) aberta, não uma hora antes.
 * Para enviar na hora exata, a médica usa o botão "Enviar link" na agenda.
 */
const ANTECEDENCIA_MIN = 20;

/**
 * Comparação de tempo constante. Comparar segredo com `===` vaza, pelo tempo
 * de resposta, quantos caracteres iniciais o palpite acertou. O hash primeiro
 * é o que garante o comprimento igual que `timingSafeEqual` exige.
 */
function segredoConfere(recebido: string): boolean {
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(env.CRON_SECRET).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const cabecalho = req.headers.get("authorization") ?? "";
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";

  if (!token || !segredoConfere(token)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const agora = new Date();
  const limite = new Date(agora.getTime() + ANTECEDENCIA_MIN * 60_000);

  const candidatas = await prisma.consulta.findMany({
    where: {
      // Cancelada e faltou não recebem lembrete; em andamento e concluída já
      // passaram do ponto.
      status: { in: ["AGENDADA", "CONFIRMADA"] },
      lembreteEnviadoEm: null,
      inicioEm: { gte: agora, lte: limite },
    },
    select: {
      id: true,
      inicioEm: true,
      modalidade: true,
      paciente: {
        select: { usuario: { select: { nome: true, email: true } } },
      },
    },
    orderBy: { inicioEm: "asc" },
    // Teto de sanidade: se algo estiver muito errado, o estrago é limitado a
    // uma rodada. O restante sai na execução seguinte.
    take: 200,
  });

  let enviados = 0;
  const falhas: { consultaId: string }[] = [];

  for (const consulta of candidatas) {
    // ---- reserva ---------------------------------------------------------
    const reserva = await prisma.consulta.updateMany({
      where: { id: consulta.id, lembreteEnviadoEm: null },
      data: { lembreteEnviadoEm: new Date() },
    });
    // Outra execução chegou primeiro nesta linha.
    if (reserva.count === 0) continue;

    try {
      // Mesma camada do botão "Enviar link" da agenda — quando o WhatsApp
      // estiver configurado, os dois caminhos passam a mandar pelos dois canais.
      const r = await notificarLinkConsulta({
        nome: consulta.paciente.usuario.nome,
        email: consulta.paciente.usuario.email,
        consultaId: consulta.id,
        inicioEm: consulta.inicioEm,
        modalidade: consulta.modalidade,
      });
      if (!r.email && !r.whatsapp) throw new Error("nenhum canal entregou");
      enviados++;
    } catch (erro) {
      // Devolve a linha para a fila. Enquanto a consulta não começar, a rodada
      // seguinte tenta de novo; passado o horário, ela sai da janela sozinha.
      await prisma.consulta.update({
        where: { id: consulta.id },
        data: { lembreteEnviadoEm: null },
      });
      // Só o id na resposta. A mensagem crua do SMTP (host, credencial parcial,
      // caminho interno) fica no log do servidor, não no corpo HTTP.
      falhas.push({ consultaId: consulta.id });
      console.error("[cron/lembretes] falha ao enviar", consulta.id, erro);
    }
  }

  // ---- transcrições abandonadas ------------------------------------------
  //
  // O job da Transcribe é disparado e acompanhado pelo navegador da médica. Se
  // ela fecha a aba no meio, o job termina na AWS e ninguém busca o resultado:
  // o rascunho nunca nasce e o áudio da consulta fica no S3 indefinidamente.
  //
  // Como o `concluirNotas` é idempotente, retomar aqui é seguro mesmo que a
  // médica esteja com a tela aberta processando ao mesmo tempo.
  const retomadas = await retomarTranscricoesPendentes().catch((erro) => {
    // Falha aqui não pode derrubar o envio de lembretes, que é a função
    // principal desta rota.
    console.error("[cron] falha ao retomar transcrições", erro);
    return [] as { consultaId: string; estado: string }[];
  });

  if (retomadas.length > 0) {
    console.log("[cron] transcrições retomadas", retomadas);
  }

  // ---- reservas de horário não pagas que venceram -----------------------
  //
  // Uma consulta AGUARDANDO_PAGAMENTO segura o horário (a agenda a conta como
  // ocupada). Passada a janela de reserva sem pagar, o horário precisa VOLTAR à
  // grade. O lock é a constraint `@@unique([medicaId, inicioEm])`, que NÃO some
  // com o status CANCELADA — então "liberar o slot" aqui é REMOVER a linha, não
  // marcá-la cancelada. É seguro porque uma consulta nunca-paga não tem
  // consentimento, gravação, prontuário nem receita: não há dado clínico a
  // preservar (a guarda de 20 anos vale para prontuário, que aqui não existe).
  const expiradas = await expirarReservasNaoPagas(agora);

  // ---- consultas EM_ANDAMENTO abandonadas --------------------------------
  //
  // Uma consulta entra em EM_ANDAMENTO quando a médica abre a sala, e a ÚNICA
  // saída limpa hoje é assinar o registro. Mas dá para sair sem assinar (fechar
  // a aba, "voltar à agenda", cair a conexão) — e a consulta ficaria EM_ANDAMENTO
  // para sempre. Aqui o estado converge sozinho: passada a janela da sala mais a
  // folga, marca CONCLUIDA. É idempotente (só afeta quem ainda está EM_ANDAMENTO),
  // então não regride quem já assinou.
  const encerradas = await encerrarConsultasAbandonadas(agora);

  return NextResponse.json({
    verificadas: candidatas.length,
    enviados,
    falhas: falhas.length,
    detalheFalhas: falhas,
    transcricoesRetomadas: retomadas,
    expiradas,
    encerradas,
  });
}

/**
 * Fecha consultas EM_ANDAMENTO cuja janela (início + duração + folga) já passou.
 *
 * O prazo depende da `duracaoMin` de cada linha, que o `updateMany` não computa
 * no `where` — então buscamos as candidatas (pré-filtradas por um teto seguro) e
 * aplicamos o prazo exato em memória. O `updateMany` final é condicionado a
 * `status: "EM_ANDAMENTO"`: idempotente e sem corrida com quem assinou agora.
 */
async function encerrarConsultasAbandonadas(agora: Date): Promise<number> {
  // Pré-filtro seguro: mesmo com duração 0, o prazo é `inicioEm + FOLGA`. Com
  // duração real (>= 15) o prazo é ainda mais tarde, então isto é um superset.
  const cortePreFiltro = new Date(agora.getTime() - FOLGA_ENCERRAMENTO_MIN * 60_000);
  const candidatas = await prisma.consulta.findMany({
    where: { status: "EM_ANDAMENTO", inicioEm: { lt: cortePreFiltro } },
    select: { id: true, inicioEm: true, duracaoMin: true },
    take: 200,
  });

  const vencidasIds = candidatas
    .filter(
      (c) =>
        agora.getTime() >
        c.inicioEm.getTime() + (c.duracaoMin + FOLGA_ENCERRAMENTO_MIN) * 60_000,
    )
    .map((c) => c.id);

  if (vencidasIds.length === 0) return 0;

  const r = await prisma.consulta.updateMany({
    where: { id: { in: vencidasIds }, status: "EM_ANDAMENTO" },
    data: { status: "CONCLUIDA", encerradaEm: agora },
  });
  if (r.count > 0) console.log("[cron] consultas abandonadas encerradas", r.count);
  return r.count;
}

/**
 * Remove consultas AGUARDANDO_PAGAMENTO cuja cobrança venceu, liberando o slot.
 * Cada remoção é condicionada ao estado ainda ser AGUARDANDO_PAGAMENTO, então
 * uma corrida com o webhook (que confirma o pagamento) nunca apaga uma consulta
 * que acabou de ser paga.
 */
async function expirarReservasNaoPagas(agora: Date): Promise<number> {
  const vencidas = await prisma.consulta.findMany({
    where: {
      status: "AGUARDANDO_PAGAMENTO",
      // `status: { not: PAGO }` cobre PENDENTE e também FALHOU (cobrança que
      // nunca nasceu) — este último ficava preso porque o filtro antigo só
      // pegava PENDENTE. E exclui explicitamente o PAGO, para a corrida com o
      // webhook nunca apagar uma consulta recém-paga.
      pagamento: { is: { status: { not: "PAGO" }, expiraEm: { lt: agora } } },
    },
    select: { id: true },
    take: 200,
  });

  let removidas = 0;
  for (const c of vencidas) {
    const apagou = await prisma.$transaction(async (tx) => {
      // Reserva condicionada AO PAGAMENTO, não só ao status da consulta: o
      // webhook move o pagamento→PAGO ANTES de mover a consulta→CONFIRMADA, então
      // checar só a consulta deixava uma janela para apagar algo já pago.
      const ainda = await tx.consulta.findFirst({
        where: {
          id: c.id,
          status: "AGUARDANDO_PAGAMENTO",
          pagamento: { is: { status: { not: "PAGO" } } },
        },
        select: { id: true },
      });
      if (!ainda) return false;
      await tx.pagamento.deleteMany({ where: { consultaId: c.id } });
      await tx.consulta.delete({ where: { id: c.id } });
      return true;
    });
    if (apagou) removidas++;
  }

  if (removidas > 0) console.log("[cron] reservas não pagas liberadas", removidas);
  return removidas;
}
