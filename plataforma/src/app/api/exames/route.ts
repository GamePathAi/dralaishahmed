/**
 * POST /api/exames — cria uma solicitação de exames RASCUNHO para uma consulta
 * (só médica dona). Reusa um RASCUNHO existente da mesma consulta.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const Corpo = z.object({ consultaId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const analise = Corpo.safeParse(await req.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  }

  const consulta = await prisma.consulta.findFirst({
    where: { id: analise.data.consultaId, medicaId: sessao.user.id },
    select: { id: true, pacienteId: true },
  });
  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }

  const existente = await prisma.solicitacaoExame.findFirst({
    where: { consultaId: consulta.id, medicaId: sessao.user.id, status: "RASCUNHO" },
    select: { id: true },
  });
  if (existente) return NextResponse.json({ id: existente.id });

  const solicitacao = await prisma.solicitacaoExame.create({
    data: {
      consultaId: consulta.id,
      pacienteId: consulta.pacienteId,
      medicaId: sessao.user.id,
      itens: [] as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: solicitacao.id }, { status: 201 });
}
