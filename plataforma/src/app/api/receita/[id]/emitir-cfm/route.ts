/**
 * POST /api/receita/[id]/emitir-cfm
 *
 * Registra, na NOSSA Receita, o resultado da emissão pela Prescrição Eletrônica
 * do CFM: o frontend assina no iframe do CFM (ICP-Brasil) e nos manda a
 * `urlDocumento` do PDF assinado; aqui gravamos nos campos reservados
 * (`assinaturaProvedor="CFM"`, `assinaturaRef`, `documentoUrl`).
 *
 * FASE 1 (dormente): só responde quando `CFM_ATIVO`. NÃO substitui nem quebra o
 * fluxo atual (IMPRESSA + imprimir). Exige que a receita já esteja ASSINADA no
 * nosso fluxo — a decisão de o CFM ser a assinatura PRIMÁRIA (em vez de
 * complementar) fica para a Fase 2. Idempotente.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ipDoPedido } from "@/lib/pedido";

export const dynamic = "force-dynamic";

const Corpo = z.object({
  urlDocumento: z.string().url(),
  /** Id/código de verificação devolvido pelo CFM, se houver. */
  refCfm: z.string().max(200).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  if (!env.CFM_ATIVO) {
    return NextResponse.json(
      { erro: "Integração CFM desligada.", codigo: "CFM_DESLIGADO" },
      { status: 409 },
    );
  }

  const analise = Corpo.safeParse(await req.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const { urlDocumento, refCfm } = analise.data;

  const receita = await prisma.receita.findUnique({
    where: { id },
    select: {
      medicaId: true,
      status: true,
      assinaturaProvedor: true,
      documentoUrl: true,
    },
  });
  if (!receita) {
    return NextResponse.json({ erro: "Receita não encontrada." }, { status: 404 });
  }
  if (receita.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }
  if (receita.status !== "ASSINADO") {
    return NextResponse.json(
      { erro: "Assine a receita antes de emitir pelo CFM.", codigo: "EXIGE_ASSINADA" },
      { status: 409 },
    );
  }

  // Idempotente: já emitida pelo CFM → devolve a URL guardada.
  if (receita.assinaturaProvedor === "CFM" && receita.documentoUrl) {
    return NextResponse.json({ documentoUrl: receita.documentoUrl, jaEmitida: true });
  }

  const atualizada = await prisma.receita.update({
    where: { id },
    data: {
      assinaturaProvedor: "CFM",
      assinaturaRef: refCfm ?? null,
      documentoUrl: urlDocumento,
    },
    select: { documentoUrl: true },
  });

  // Dado do paciente foi ao CFM e um documento assinado voltou — precisa de
  // rastro. Não gravamos a URL (pode conter token) — só a referência.
  await prisma.auditoria.create({
    data: {
      usuarioId: sessao.user.id,
      acao: "EXPORTOU_DADOS",
      recursoId: id,
      detalhe: { tipo: "receita", provedor: "CFM", ref: refCfm ?? null },
      ip: ipDoPedido(req),
    },
  });

  return NextResponse.json({ documentoUrl: atualizada.documentoUrl });
}
