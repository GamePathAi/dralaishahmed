/**
 * DELETE /api/despesas/[id] — remove uma despesa (só a médica dona).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const r = await prisma.despesa.deleteMany({ where: { id, medicaId: sessao.user.id } });
  if (r.count === 0) {
    return NextResponse.json({ erro: "Despesa não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
