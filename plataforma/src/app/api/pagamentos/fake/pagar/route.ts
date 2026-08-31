/**
 * POST /api/pagamentos/fake/pagar — o "botão de teste" do Pix de dev.
 *
 * Simula o provedor chamando nosso webhook com um pagamento aprovado. Faz um
 * POST interno para `/api/pagamentos/webhook` com a assinatura fake, então
 * exercita o caminho REAL do webhook (validação de assinatura + idempotência),
 * não um atalho. É o equivalente do Mailpit para pagamento.
 *
 * SOMENTE DESENVOLVIMENTO: recusa fora de localhost, como o roteiro e o
 * `nova:consulta` fazem. Em produção com provedor real, esta rota responde 403.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { assinarFake } from "@/lib/pagamento/fake";

export const dynamic = "force-dynamic";

function ehLocal(): boolean {
  // NODE_ENV é o guard primário: num deploy de caixa única (app + Postgres no
  // mesmo host), o DATABASE_URL aponta para localhost mesmo em PRODUÇÃO, então
  // "localhost no banco" NÃO é sinônimo de ambiente de dev. Exigimos os dois.
  return (
    process.env.NODE_ENV !== "production" &&
    /(localhost|127\.0\.0\.1)/.test(env.DATABASE_URL)
  );
}

export async function POST(req: NextRequest) {
  if (!ehLocal() || env.PAGAMENTO_PROVEDOR !== "FAKE") {
    return NextResponse.json(
      { erro: "Indisponível fora do ambiente de desenvolvimento." },
      { status: 403 },
    );
  }

  const corpo = await req.json().catch(() => ({}));
  const consultaId = typeof corpo?.consultaId === "string" ? corpo.consultaId : "";
  if (!consultaId) {
    return NextResponse.json({ erro: "Informe consultaId." }, { status: 400 });
  }

  const pagamento = await prisma.pagamento.findUnique({
    where: { consultaId },
    select: { provedorRef: true, status: true },
  });
  if (!pagamento?.provedorRef) {
    return NextResponse.json(
      { erro: "Cobrança não encontrada para esta consulta." },
      { status: 404 },
    );
  }

  // Forja o corpo do webhook e o assina como o provedor faria.
  const payload = JSON.stringify({ provedorRef: pagamento.provedorRef, status: "PAGO" });
  const assinatura = assinarFake(payload);

  const base = env.AUTH_URL.replace(/\/$/, "");
  const r = await fetch(`${base}/api/pagamentos/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fake-assinatura": assinatura },
    body: payload,
  });

  const dados = await r.json().catch(() => ({}));
  return NextResponse.json(dados, { status: r.status });
}
