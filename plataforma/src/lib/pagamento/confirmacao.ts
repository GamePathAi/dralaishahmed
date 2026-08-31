/**
 * Aplicação de um pagamento aprovado.
 *
 * Um lugar só, chamado pelo webhook do provedor (`/api/pagamentos/webhook`) e,
 * em dev, pela rota que simula o webhook (`/api/pagamentos/fake/pagar`). É AQUI
 * — e em nenhum outro lugar — que uma consulta vira CONFIRMADA e o e-mail de
 * confirmação sai. O cliente nunca confirma pagamento.
 *
 * Idempotente: o webhook chega repetido. A confirmação é *reservada* com um
 * `updateMany` condicionado a "ainda não PAGO", o mesmo truque do cron de
 * lembretes — a segunda chamada vê `count === 0` e não reprocessa (não duplica
 * e-mail nem trilha).
 */

import { prisma } from "@/lib/prisma";
import { enviarConfirmacaoAgendamento } from "@/lib/email";
import type { MetodoPagamento } from "@prisma/client";

/**
 * Traduz o método REAL do pagamento a partir do payload do provedor. Como a
 * cobrança é criada como "UNDEFINED" (o paciente escolhe Pix/cartão/boleto), só
 * no webhook se sabe como ele pagou — sem isto o DRE contaria tudo como Pix.
 * Retorna undefined quando o payload não diz (ex.: webhook fake): nesse caso o
 * metodo gravado na criação é mantido.
 */
function metodoDoWebhook(bruto: unknown): MetodoPagamento | undefined {
  const bt = (bruto as { payment?: { billingType?: string } } | null)?.payment?.billingType;
  switch (bt) {
    case "PIX":
      return "PIX";
    case "CREDIT_CARD":
      return "CARTAO";
    case "BOLETO":
    case "BANK_SLIP":
      return "BOLETO";
    default:
      return undefined;
  }
}

export interface ResultadoConfirmacao {
  encontrado: boolean;
  jaProcessado: boolean;
  consultaId?: string;
  confirmacaoEnviada?: boolean;
}

export async function registrarPagamentoAprovado(
  provedorRef: string,
  bruto: unknown,
  ip?: string,
): Promise<ResultadoConfirmacao> {
  const pagamento = await prisma.pagamento.findUnique({
    where: { provedorRef },
    include: {
      consulta: {
        select: {
          id: true,
          inicioEm: true,
          modalidade: true,
          duracaoMin: true,
          paciente: {
            select: { usuario: { select: { id: true, nome: true, email: true } } },
          },
        },
      },
    },
  });

  if (!pagamento) return { encontrado: false, jaProcessado: false };

  const consulta = pagamento.consulta;
  const usuario = consulta.paciente.usuario;
  // Como o paciente pagou (Pix/cartão/boleto), quando o provedor informa.
  const metodoReal = metodoDoWebhook(bruto);

  // ATÔMICO: a reserva (pagamento→PAGO), a confirmação da consulta e a
  // auditoria vivem na MESMA transação. Antes eram passos separados: se o
  // segundo falhasse, o pagamento ficava PAGO mas a consulta presa em
  // AGUARDANDO_PAGAMENTO para sempre (o webhook repetido via "já processado" e
  // não corrigia). Agora ou tudo confirma, ou nada muda e o webhook re-tenta.
  const reservou = await prisma.$transaction(async (tx) => {
    const reserva = await tx.pagamento.updateMany({
      where: { id: pagamento.id, status: { not: "PAGO" } },
      data: {
        status: "PAGO",
        pagoEm: new Date(),
        bruto: bruto as never,
        ...(metodoReal ? { metodo: metodoReal } : {}),
      },
    });
    // Outra entrega do webhook já processou este pagamento.
    if (reserva.count === 0) return false;

    await tx.consulta.update({
      where: { id: consulta.id },
      data: { status: "CONFIRMADA", statusPagamento: "PAGO" },
    });
    await tx.auditoria.create({
      data: {
        usuarioId: usuario.id,
        acao: "REGISTROU_PAGAMENTO",
        recursoId: consulta.id,
        detalhe: {
          provedor: pagamento.provedor,
          provedorRef,
          valorCent: pagamento.valorCent,
          metodo: metodoReal ?? pagamento.metodo,
        },
        ip: ip ?? null,
      },
    });
    return true;
  });

  if (!reservou) {
    return { encontrado: true, jaProcessado: true, consultaId: pagamento.consultaId };
  }

  // Confirmação por e-mail: só agora, com o pagamento firme. Best-effort — o
  // dinheiro já entrou e não pode ser desfeito porque o SMTP tropeçou. A marca
  // `confirmacaoEnviadaEm` distingue "não avisado" (a agenda destaca) de enviado.
  let confirmacaoEnviada = false;
  try {
    await enviarConfirmacaoAgendamento({
      nome: usuario.nome,
      email: usuario.email,
      inicioEm: consulta.inicioEm,
      modalidade: consulta.modalidade,
      duracaoMin: consulta.duracaoMin,
    });
    await prisma.consulta.update({
      where: { id: consulta.id },
      data: { confirmacaoEnviadaEm: new Date() },
    });
    confirmacaoEnviada = true;
  } catch (erro) {
    console.error("[pagamento] confirmação paga, mas e-mail falhou", consulta.id, erro);
  }

  return {
    encontrado: true,
    jaProcessado: false,
    consultaId: consulta.id,
    confirmacaoEnviada,
  };
}
