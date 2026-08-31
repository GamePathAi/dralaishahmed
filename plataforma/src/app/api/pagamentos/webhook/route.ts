/**
 * POST /api/pagamentos/webhook — recebe o aviso de pagamento do provedor.
 *
 * É a ÚNICA porta que confirma um pagamento. Nunca confia no cliente: a
 * assinatura é verificada pelo próprio provedor (`verificarWebhook`) ANTES de o
 * corpo valer alguma coisa, e a confirmação é idempotente por `provedorRef`
 * (webhook chega repetido) — ambos em `lib/pagamento/confirmacao.ts`.
 *
 * Pública (sem sessão), como todo webhook: quem autentica é a assinatura.
 */

import { NextRequest, NextResponse } from "next/server";
import { provedorPagamento } from "@/lib/pagamento";
import { registrarPagamentoAprovado } from "@/lib/pagamento/confirmacao";
import { ipDoPedido } from "@/lib/pedido";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const provedor = provedorPagamento();

  const evento = await provedor.verificarWebhook(req).catch(() => ({
    valido: false as const,
  }));

  if (!evento.valido) {
    // Assinatura inválida: nem loga o corpo, nem revela o motivo.
    return NextResponse.json({ erro: "Assinatura inválida." }, { status: 400 });
  }

  // Só PAGO muda estado por enquanto. Outros eventos (expirou, falhou) são
  // reconhecidos como recebidos para o provedor parar de reenviar, mas o
  // caminho de expiração fica com o cron, dono do relógio.
  if (evento.status !== "PAGO" || !evento.provedorRef) {
    return NextResponse.json({ ok: true, ignorado: true });
  }

  const r = await registrarPagamentoAprovado(
    evento.provedorRef,
    evento.bruto,
    ipDoPedido(req),
  );

  if (!r.encontrado) {
    // 200 mesmo assim: um provedorRef desconhecido não é erro a repetir — pode
    // ser evento de outro ambiente. Devolver 4xx faria o provedor reenviar em
    // loop.
    return NextResponse.json({ ok: true, encontrado: false });
  }

  return NextResponse.json({
    ok: true,
    jaProcessado: r.jaProcessado,
    consultaId: r.consultaId,
  });
}
