/**
 * POST /api/consultas/[id]/encerrar — encerra a consulta na hora.
 *
 * Chamada quando a médica clica "Encerrar consulta" na sala, para ela não
 * esperar o cron. O cron (`api/cron/lembretes`) é a rede de segurança que pega
 * quem sai SEM clicar (fecha a aba, volta à agenda, cai a conexão); esta rota é
 * só o caminho limpo, imediato.
 *
 * IDEMPOTENTE: um `updateMany` condicionado a `status: "EM_ANDAMENTO"`. Segunda
 * chamada (ou uma consulta já assinada/concluída) não reprocessa nem regride.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ipDoPedido } from "@/lib/pedido";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: { id: true, medicaId: true },
  });
  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }

  // Encerrar é ato da médica dona da consulta. O paciente saindo não encerra.
  const ehMedicaDona =
    sessao.user.papel === "MEDICA" && consulta.medicaId === sessao.user.id;
  if (!ehMedicaDona) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const r = await prisma.consulta.updateMany({
    where: { id: consultaId, status: "EM_ANDAMENTO" },
    data: { status: "CONCLUIDA", encerradaEm: new Date() },
  });

  // Só registra na trilha quando HOUVE transição — a segunda chamada (idempotente)
  // não duplica auditoria.
  if (r.count > 0) {
    await prisma.auditoria.create({
      data: {
        usuarioId: sessao.user.id,
        acao: "ENCERROU_CONSULTA",
        recursoId: consultaId,
        ip: ipDoPedido(req),
      },
    });
  }

  return NextResponse.json({ ok: true, encerrada: r.count > 0 });
}
