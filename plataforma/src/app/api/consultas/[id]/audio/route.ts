/**
 * POST /api/consultas/[id]/audio
 * Devolve uma URL pré-assinada para o navegador subir o áudio direto ao S3.
 *
 * Emite a URL apenas se: quem pede é a médica dona da consulta E existe
 * consentimento aceito. A checagem de consentimento é repetida aqui de propósito
 * — a rota de notas também a faz, mas esta é a que concede a permissão de
 * ESCRITA no bucket. Conceder upload sem aceite deixaria áudio de consulta não
 * autorizada no storage, mesmo que a transcrição depois fosse recusada.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { urlUploadAudio } from "@/lib/s3";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: { medicaId: true, consentimento: { select: { aceito: true } } },
  });

  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }
  if (consulta.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }
  if (!consulta.consentimento?.aceito) {
    return NextResponse.json(
      { erro: "Sem consentimento para gravação.", codigo: "SEM_CONSENTIMENTO" },
      { status: 403 },
    );
  }

  const { url, audioKey } = await urlUploadAudio(consultaId);
  return NextResponse.json({ url, audioKey });
}
