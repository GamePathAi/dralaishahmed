/**
 * GET/POST /api/medica/configuracoes
 * Preferências da médica que afetam o custo por consulta (modelo da nota,
 * modo do assistente de anotação).
 *
 * Não exige o segundo fator: não expõe segredo nem muda credencial — é escolha
 * operacional, protegida pela sessão de médica como o resto da área clínica.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MODELOS_NOTA, MODOS_ASSISTENTE, PRECO_MAX_CENT } from "@/lib/config-medica";

export const dynamic = "force-dynamic";

const Corpo = z.object({
  modeloNota: z.enum(MODELOS_NOTA),
  modoAssistente: z.enum(MODOS_ASSISTENTE),
  // Preço por modalidade, em centavos. Inteiro, não negativo, com teto de
  // sanidade — dinheiro nunca entra como float e nunca vem negativo do form.
  valorTeleconsultaCent: z.number().int().min(0).max(PRECO_MAX_CENT),
  valorPresencialCent: z.number().int().min(0).max(PRECO_MAX_CENT),
});

const SELECT = {
  modeloNota: true,
  modoAssistente: true,
  valorTeleconsultaCent: true,
  valorPresencialCent: true,
} as const;

export async function GET() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  const m = await prisma.usuario.findUnique({
    where: { id: sessao.user.id },
    select: SELECT,
  });
  return NextResponse.json(m);
}

export async function POST(req: NextRequest) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  const analise = Corpo.safeParse(await req.json().catch(() => ({})));
  if (!analise.success) {
    return NextResponse.json({ erro: "Valores inválidos." }, { status: 400 });
  }
  const m = await prisma.usuario.update({
    where: { id: sessao.user.id },
    data: analise.data,
    select: SELECT,
  });
  return NextResponse.json(m);
}
