/**
 * GET /api/health — verificação de saúde para monitor externo (uptime).
 *
 * Confirma que o app RESPONDE e que o BANCO está alcançável (um `SELECT 1`). Um
 * monitor externo pinga isto de minuto em minuto; se cair ou o banco sumir, o
 * alerta chega antes de o paciente reclamar. Público de propósito (é o que um
 * monitor precisa) e não vaza nada além de vivo/degradado.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Toca o banco — a query mais barata possível, sem entrada do usuário.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", horario: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Não vaza o erro (nada de detalhe de infra numa rota pública).
    return NextResponse.json(
      { status: "degradado" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
