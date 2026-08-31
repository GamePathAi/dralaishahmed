/**
 * GET /api/consultas/[id]/pagamento — estado do pagamento, para o polling leve
 * do front enquanto o paciente paga o Pix.
 *
 * Público de propósito: o agendamento é anônimo (o paciente ainda não tem
 * sessão), então a chave de acesso é o `id` da consulta — um cuid não
 * adivinhável. A resposta é mínima (status + expiração), sem dado pessoal, para
 * não virar um vazamento por id enumerado.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumir } from "@/lib/rate-limit";
import { ipDoPedido } from "@/lib/pedido";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Teto de polling por IP: o front bate a cada poucos segundos; isto só barra
  // varredura de ids em massa.
  const ip = ipDoPedido(req) ?? "sem-ip";
  const limite = consumir(`pagto:${ip}`, 120, 60_000);
  if (!limite.ok) {
    return NextResponse.json(
      { erro: "Muitas consultas de status." },
      { status: 429, headers: { "Retry-After": String(limite.esperaSeg) } },
    );
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id },
    select: {
      status: true,
      statusPagamento: true,
      pagamento: { select: { status: true, expiraEm: true } },
    },
  });

  if (!consulta) {
    return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    status: consulta.status,
    statusPagamento: consulta.statusPagamento,
    pagamento: consulta.pagamento
      ? {
          status: consulta.pagamento.status,
          expiraEm: consulta.pagamento.expiraEm?.toISOString() ?? null,
        }
      : null,
  });
}
