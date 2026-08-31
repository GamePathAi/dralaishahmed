/**
 * PUT /api/consultas/[id]/nota-sessao — salva a anotação livre da médica feita
 * DURANTE a consulta (autosave da sala). Só a médica dona; upsert do campo
 * `notaSessaoMedica`. Vazio grava NULL.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const Corpo = z.object({ nota: z.string().max(20000) });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: consultaId } = await params;
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  const consulta = await prisma.consulta.findFirst({
    where: { id: consultaId, medicaId: sessao.user.id },
    select: { notaSessaoMedica: true },
  });
  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ nota: consulta.notaSessaoMedica ?? "" });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const analise = Corpo.safeParse(await req.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  }

  // `updateMany` filtrando por medicaId é, ao mesmo tempo, a checagem de posse
  // (a médica só edita a própria consulta) e evita um read-depois-write.
  const r = await prisma.consulta.updateMany({
    where: { id: consultaId, medicaId: sessao.user.id },
    data: { notaSessaoMedica: analise.data.nota.trim() || null },
  });
  if (r.count === 0) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
