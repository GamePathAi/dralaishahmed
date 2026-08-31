/**
 * POST /api/receita/[id]/assinar
 * Aplica as edições da médica e assina a receita.
 *
 * Mesma regra do prontuário: **receita ASSINADA nunca muda.** Corrigir depois
 * cria uma nova versão que substitui a anterior (que vira RETIFICADA, preservada
 * para auditoria) — receita é documento clínico-legal, não rascunho editável.
 *
 * A receita continua "própria/impressa" nesta fase: `assinaturaProvedor` fica
 * "IMPRESSA". A assinatura ICP-Brasil/Memed (Fase 2) preencherá os campos de
 * provedor sem mudar este fluxo — por isso a estrutura já os prevê.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ipDoPedido } from "@/lib/pedido";

const Item = z.object({
  medicamento: z.string().min(1, "Todo item precisa de um medicamento.").max(200),
  concentracao: z.string().max(100),
  formaFarmaceutica: z.string().max(100),
  via: z.string().max(60),
  posologia: z.string().min(1, "Todo item precisa de posologia.").max(500),
  quantidade: z.string().max(120),
  duracao: z.string().max(120),
  controlado: z.boolean(),
  observacao: z.string().max(300),
});

const Corpo = z.object({
  itens: z
    .array(Item)
    .min(1, "A receita precisa de ao menos um medicamento.")
    .max(30),
  orientacoesGerais: z.string().max(2000).optional().nullable(),
  /** Justificativa obrigatória quando se retifica uma receita já assinada. */
  motivoRetificacao: z.string().min(10).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: receitaId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const analise = Corpo.safeParse(await req.json());
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const { itens, orientacoesGerais, motivoRetificacao } = analise.data;

  const original = await prisma.receita.findUnique({
    where: { id: receitaId },
  });
  if (!original) {
    return NextResponse.json({ erro: "Receita não encontrada." }, { status: 404 });
  }
  if (original.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const ip = ipDoPedido(req);
  const agora = new Date();
  const temControlado = itens.some((i) => i.controlado);

  // A médica alterou o que a IA sugeriu? Comparação por conteúdo — fica no
  // documento e na auditoria (a origem-IA nunca some, mesmo após edição).
  const rascunho = original.rascunhoIA as { itens?: unknown } | null;
  const editada =
    original.origemIA &&
    JSON.stringify(rascunho?.itens ?? null) !== JSON.stringify(itens);

  const dados = {
    itens: itens as unknown as Prisma.InputJsonValue,
    orientacoesGerais: orientacoesGerais || null,
    temControlado,
  };

  // ---- caminho 1: rascunho → assinada ------------------------------------
  if (original.status === "RASCUNHO") {
    const assinada = await prisma.receita.update({
      where: { id: receitaId },
      data: {
        ...dados,
        status: "ASSINADO",
        editadaPelaMedica: editada,
        assinadaEm: agora,
        assinadaPor: env.CRM_MEDICA,
        assinaturaProvedor: "IMPRESSA",
      },
    });

    await prisma.auditoria.create({
      data: {
        usuarioId: sessao.user.id,
        acao: "ASSINOU_REGISTRO",
        recursoId: assinada.id,
        detalhe: { tipo: "receita", versao: assinada.versao, temControlado },
        ip,
      },
    });

    return NextResponse.json({
      receitaId: assinada.id,
      versao: assinada.versao,
      assinadaEm: assinada.assinadaEm,
    });
  }

  // ---- caminho 2: retificação de receita já assinada ----------------------
  if (original.status === "ASSINADO") {
    if (!motivoRetificacao) {
      return NextResponse.json(
        {
          erro:
            "Esta receita já está assinada e não pode ser alterada. Para " +
            "corrigi-la, informe o motivo — será criada uma nova versão, e a " +
            "original permanece registrada.",
          codigo: "EXIGE_MOTIVO_RETIFICACAO",
        },
        { status: 409 },
      );
    }

    const nova = await prisma.$transaction(async (tx) => {
      const r = await tx.receita.create({
        data: {
          ...dados,
          consultaId: original.consultaId,
          pacienteId: original.pacienteId,
          medicaId: original.medicaId,
          status: "ASSINADO",
          versao: original.versao + 1,
          substituiId: original.id,
          origemIA: original.origemIA,
          modeloIA: original.modeloIA,
          rascunhoIA: original.rascunhoIA ?? undefined,
          editadaPelaMedica: true,
          orientacoesGerais: [
            orientacoesGerais,
            `Retificação: ${motivoRetificacao}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          assinadaEm: agora,
          assinadaPor: env.CRM_MEDICA,
          assinaturaProvedor: "IMPRESSA",
        },
      });

      // A original NÃO é apagada nem editada — só marcada como superada.
      await tx.receita.update({
        where: { id: original.id },
        data: { status: "RETIFICADO" },
      });

      await tx.auditoria.create({
        data: {
          usuarioId: sessao.user!.id,
          acao: "RETIFICOU_REGISTRO",
          recursoId: r.id,
          detalhe: { tipo: "receita", substitui: original.id, motivo: motivoRetificacao },
          ip,
        },
      });

      return r;
    });

    return NextResponse.json({
      receitaId: nova.id,
      versao: nova.versao,
      substitui: original.id,
      assinadaEm: nova.assinadaEm,
    });
  }

  // ---- caminho 3: já retificada -------------------------------------------
  return NextResponse.json(
    {
      erro:
        "Esta receita já foi substituída por uma versão posterior. " +
        "Retifique a versão vigente.",
      codigo: "RECEITA_SUPERADA",
    },
    { status: 409 },
  );
}
