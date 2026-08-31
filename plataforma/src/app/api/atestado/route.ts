/**
 * POST /api/atestado — cria um atestado RASCUNHO para uma consulta (só médica
 * dona). O editor depois deixa a médica escolher o modelo e ajustar. Reusa um
 * RASCUNHO existente da mesma consulta para não acumular rascunhos em branco.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

  const existente = await prisma.atestado.findFirst({
    where: { consultaId: consulta.id, medicaId: sessao.user.id, status: "RASCUNHO" },
    select: { id: true },
  });
  if (existente) return NextResponse.json({ id: existente.id });

  const atestado = await prisma.atestado.create({
    data: {
      consultaId: consulta.id,
      pacienteId: consulta.pacienteId,
      medicaId: sessao.user.id,
      tipo: "COMPARECIMENTO",
      dataInicio: new Date(),
      textoLivre: "",
    },
    select: { id: true },
  });

  return NextResponse.json({ id: atestado.id }, { status: 201 });
}
