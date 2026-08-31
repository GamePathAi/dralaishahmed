/**
 * POST /api/consultas/[id]/registro
 * Cria um rascunho MANUAL de registro clínico.
 *
 * Existe para os casos em que não há rascunho de IA: consulta presencial,
 * paciente que recusou a gravação, ou falha na transcrição. É o caminho que
 * garante que a plataforma nunca dependa da IA para produzir prontuário — se
 * todo o pipeline de IA sair do ar, a médica continua registrando.
 *
 * Cria sempre como RASCUNHO. A assinatura é sempre pela rota de assinar, sem
 * atalho: um registro que nasce assinado pularia a etapa de revisão que dá
 * validade ao documento.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Teto generoso por campo (20k): cabe qualquer registro clínico real e barra
// payload absurdo indo para uma coluna text guardada por 20 anos.
const CAMPO = z.string().min(1).max(20_000);
const Corpo = z.object({
  queixaPrincipal: CAMPO,
  historiaMoleastiaAtual: CAMPO,
  antecedentes: CAMPO,
  hipotesesDiagnosticas: CAMPO,
  conduta: CAMPO,
  observacoes: z.string().max(20_000).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const analise = Corpo.safeParse(await req.json());
  if (!analise.success) {
    return NextResponse.json(
      { erro: "Preencha os campos obrigatórios do registro." },
      { status: 400 },
    );
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: { id: true, medicaId: true, pacienteId: true },
  });

  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }
  if (consulta.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  // Um rascunho por vez. Sem isto, abrir a página duas vezes criaria dois
  // rascunhos concorrentes e a médica assinaria um sem saber do outro.
  const existente = await prisma.registroClinico.findFirst({
    where: { consultaId, status: "RASCUNHO" },
    select: { id: true },
  });

  if (existente) {
    return NextResponse.json(
      {
        erro: "Já existe um rascunho para esta consulta.",
        codigo: "RASCUNHO_EXISTENTE",
        registroId: existente.id,
      },
      { status: 409 },
    );
  }

  const registro = await prisma.registroClinico.create({
    data: {
      ...analise.data,
      observacoes: analise.data.observacoes || null,
      consultaId,
      pacienteId: consulta.pacienteId,
      status: "RASCUNHO",
      origemIA: false, // redigido pela médica
    },
  });

  return NextResponse.json({ registroId: registro.id }, { status: 201 });
}
