/**
 * POST /api/consultas/[id]/sala
 * Prepara a sala de teleconsulta e devolve o token de acesso de quem pediu.
 *
 * O token é emitido **por pessoa**, nunca compartilhado. Médica e paciente
 * chamam esta mesma rota e recebem tokens diferentes: ela como dona da sala,
 * ele como participante. Um token não serve para o outro.
 *
 * Por isso a rota é POST e não GET: emitir credencial é efeito colateral, e não
 * deve ser cacheável, pré-buscável pelo navegador nem aparecer em log de acesso
 * com a URL completa.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ipDoPedido } from "@/lib/pedido";
import { garantirSalaConsulta, gerarTokenAcesso, exigeSala } from "@/lib/daily";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Antecedência máxima para pedir acesso. Espelha o `nbf` do token. */
const MIN_ANTES = 15;
/** Depois disso a sala já expirou do lado da Daily. */
const MIN_DEPOIS = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: {
      id: true,
      medicaId: true,
      modalidade: true,
      status: true,
      inicioEm: true,
      duracaoMin: true,
      iniciadaEm: true,
      salaNome: true,
      salaUrl: true,
      salaExpiraEm: true,
      paciente: {
        select: {
          usuarioId: true,
          usuario: { select: { nome: true } },
        },
      },
      medica: { select: { nome: true, modoAssistente: true } },
    },
  });

  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }

  // ---- quem pode entrar --------------------------------------------------
  // Somente as duas pessoas desta consulta. Não existe papel de administrador
  // com acesso à sala: assistir consulta alheia não é função de suporte.
  const ehMedica =
    sessao.user.papel === "MEDICA" && consulta.medicaId === sessao.user.id;
  const ehPaciente = consulta.paciente.usuarioId === sessao.user.id;

  if (!ehMedica && !ehPaciente) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  // ---- a consulta comporta uma sala? -------------------------------------
  if (!exigeSala(consulta.modalidade)) {
    return NextResponse.json(
      {
        erro: "Esta consulta é presencial e não possui sala virtual.",
        codigo: "SEM_SALA",
      },
      { status: 409 },
    );
  }

  if (consulta.status === "CANCELADA" || consulta.status === "FALTOU") {
    return NextResponse.json(
      { erro: "Esta consulta foi cancelada.", codigo: "CONSULTA_CANCELADA" },
      { status: 409 },
    );
  }

  if (consulta.status === "CONCLUIDA") {
    return NextResponse.json(
      { erro: "Esta consulta já foi encerrada.", codigo: "CONSULTA_ENCERRADA" },
      { status: 409 },
    );
  }

  // ---- janela de tempo ---------------------------------------------------
  // O token já carrega nbf/exp, mas entregá-lo fora da janela produziria um
  // erro silencioso da Daily no navegador. Aqui a pessoa recebe uma mensagem
  // que diz o que fazer.
  const agora = Date.now();
  const abreEm = consulta.inicioEm.getTime() - MIN_ANTES * 60_000;
  const fechaEm =
    consulta.inicioEm.getTime() + (consulta.duracaoMin + MIN_DEPOIS) * 60_000;

  if (agora < abreEm) {
    return NextResponse.json(
      {
        erro: "A sala ainda não está aberta.",
        codigo: "SALA_AINDA_FECHADA",
        abreEm: new Date(abreEm).toISOString(),
        inicioEm: consulta.inicioEm.toISOString(),
      },
      { status: 425 }, // Too Early
    );
  }

  if (agora > fechaEm) {
    return NextResponse.json(
      {
        erro:
          "A janela desta consulta se encerrou. Entre em contato para remarcar.",
        codigo: "SALA_EXPIRADA",
      },
      { status: 410 }, // Gone
    );
  }

  try {
    // ---- sala (idempotente) ----------------------------------------------
    const sala = await garantirSalaConsulta({
      consultaId: consulta.id,
      inicioEm: consulta.inicioEm,
      duracaoMin: consulta.duracaoMin,
    });

    // ---- persiste e atualiza status --------------------------------------
    // A entrada da MÉDICA é o que marca a consulta como em andamento. Se fosse
    // a do paciente, uma consulta em que ele entrou e ela não apareceu ficaria
    // registrada como atendida.
    const iniciando =
      ehMedica &&
      (consulta.status === "AGENDADA" || consulta.status === "CONFIRMADA");

    await prisma.consulta.update({
      where: { id: consulta.id },
      data: {
        salaNome: sala.salaNome,
        salaUrl: sala.salaUrl,
        salaExpiraEm: sala.salaExpiraEm,
        ...(iniciando
          ? {
              status: "EM_ANDAMENTO",
              // `iniciadaEm` marca a PRIMEIRA entrada. Se a médica cair e
              // voltar, o horário de início real não é reescrito.
              iniciadaEm: consulta.iniciadaEm ?? new Date(),
            }
          : {}),
      },
    });

    // ---- token individual -------------------------------------------------
    const token = await gerarTokenAcesso({
      salaNome: sala.salaNome,
      usuarioId: sessao.user.id,
      nome: ehMedica ? consulta.medica.nome : consulta.paciente.usuario.nome,
      papel: ehMedica ? "MEDICA" : "PACIENTE",
      inicioEm: consulta.inicioEm,
      duracaoMin: consulta.duracaoMin,
    });

    await prisma.auditoria.create({
      data: {
        usuarioId: sessao.user.id,
        acao: "ENTROU_NA_SALA",
        recursoId: consulta.id,
        detalhe: { papel: ehMedica ? "MEDICA" : "PACIENTE" },
        ip: ipDoPedido(req),
      },
    });

    return NextResponse.json(
      {
        salaUrl: sala.salaUrl,
        token,
        papel: ehMedica ? "MEDICA" : "PACIENTE",
        nomePaciente: consulta.paciente.usuario.nome,
        crmMedica: env.CRM_MEDICA,
        expiraEm: sala.salaExpiraEm.toISOString(),
        // Preferência da médica: controla se/quando o assistente é oferecido.
        modoAssistente: consulta.medica.modoAssistente,
      },
      // Credencial não entra em cache em lugar nenhum do caminho.
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (erro) {
    console.error("[sala] falha ao preparar a sala", { consultaId, erro });
    return NextResponse.json(
      {
        erro:
          "Não foi possível abrir a sala agora. Tente novamente em instantes — " +
          "se persistir, a consulta pode ser feita por telefone.",
        codigo: "FALHA_SALA",
      },
      { status: 502 },
    );
  }
}
