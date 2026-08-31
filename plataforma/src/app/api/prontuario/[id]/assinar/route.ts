/**
 * POST /api/prontuario/[id]/assinar
 * Aplica as edições da médica e assina o registro.
 *
 * A regra que dá valor jurídico ao prontuário: **registro ASSINADO nunca muda.**
 * Uma correção posterior não edita o original — cria uma nova versão que o
 * substitui, e o original vira RETIFICADO, preservado para auditoria. É o
 * equivalente digital de riscar e rubricar, em vez de apagar.
 *
 * Por isso não existe PUT/PATCH neste recurso, e não existe DELETE em lugar
 * nenhum do prontuário (guarda de 20 anos, Res. CFM 1.821/2007).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ipDoPedido } from "@/lib/pedido";

const Relatorio = z.object({
  queixaPrincipal: z.string().min(1, "Queixa principal não pode ficar vazia."),
  historiaMoleastiaAtual: z.string().min(1),
  antecedentes: z.string().min(1),
  hipotesesDiagnosticas: z.string().min(1),
  conduta: z.string().min(1, "Conduta não pode ficar vazia."),
  observacoes: z.string().optional().nullable(),
});

const Corpo = z.object({
  relatorio: Relatorio,
  /** Justificativa obrigatória quando se retifica um registro já assinado. */
  motivoRetificacao: z.string().min(10).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: registroId } = await params;

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
  const { relatorio, motivoRetificacao } = analise.data;

  const original = await prisma.registroClinico.findUnique({
    where: { id: registroId },
    include: { consulta: { select: { medicaId: true } } },
  });

  if (!original) {
    return NextResponse.json({ erro: "Registro não encontrado." }, { status: 404 });
  }
  if (original.consulta.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const ip = ipDoPedido(req);
  const agora = new Date();

  // Detecta se a médica alterou o texto da IA — informação que fica no prontuário.
  const editado =
    original.origemIA &&
    (["queixaPrincipal", "historiaMoleastiaAtual", "antecedentes",
      "hipotesesDiagnosticas", "conduta"] as const).some(
      (c) => relatorio[c] !== (original as Record<string, unknown>)[c],
    );

  const campos = {
    queixaPrincipal: relatorio.queixaPrincipal,
    historiaMoleastiaAtual: relatorio.historiaMoleastiaAtual,
    antecedentes: relatorio.antecedentes,
    hipotesesDiagnosticas: relatorio.hipotesesDiagnosticas,
    conduta: relatorio.conduta,
    observacoes: relatorio.observacoes || null,
  };

  // ---- caminho 1: rascunho → assinado ------------------------------------
  if (original.status === "RASCUNHO") {
    const assinado = await prisma.$transaction(async (tx) => {
      const r = await tx.registroClinico.update({
        where: { id: registroId },
        data: {
          ...campos,
          status: "ASSINADO",
          editadoPelaMedica: editado,
          assinadoEm: agora,
          assinadoPor: env.CRM_MEDICA,
        },
      });

      await tx.consulta.update({
        where: { id: original.consultaId },
        data: { status: "CONCLUIDA", encerradaEm: agora },
      });

      await tx.auditoria.create({
        data: {
          usuarioId: sessao.user!.id,
          acao: "ASSINOU_REGISTRO",
          recursoId: r.id,
          detalhe: { versao: r.versao, editouTextoDaIA: editado },
          ip,
        },
      });

      return r;
    });

    return NextResponse.json({
      registroId: assinado.id,
      versao: assinado.versao,
      assinadoEm: assinado.assinadoEm,
      assinadoPor: assinado.assinadoPor,
    });
  }

  // ---- caminho 2: retificação de registro já assinado ---------------------
  if (original.status === "ASSINADO") {
    if (!motivoRetificacao) {
      return NextResponse.json(
        {
          erro:
            "Este registro já está assinado e não pode ser alterado. " +
            "Para corrigi-lo, informe o motivo da retificação — será criada " +
            "uma nova versão, e a original permanece no prontuário.",
          codigo: "EXIGE_MOTIVO_RETIFICACAO",
        },
        { status: 409 },
      );
    }

    const nova = await prisma.$transaction(async (tx) => {
      const r = await tx.registroClinico.create({
        data: {
          ...campos,
          consultaId: original.consultaId,
          pacienteId: original.pacienteId,
          status: "ASSINADO",
          versao: original.versao + 1,
          substituiId: original.id,
          origemIA: original.origemIA,
          modeloIA: original.modeloIA,
          rascunhoIA: original.rascunhoIA ?? undefined,
          editadoPelaMedica: true,
          assinadoEm: agora,
          assinadoPor: env.CRM_MEDICA,
          observacoes: [campos.observacoes, `Retificação: ${motivoRetificacao}`]
            .filter(Boolean)
            .join("\n\n"),
        },
      });

      // O original NÃO é apagado nem editado — só marcado como superado.
      await tx.registroClinico.update({
        where: { id: original.id },
        data: { status: "RETIFICADO" },
      });

      await tx.auditoria.create({
        data: {
          usuarioId: sessao.user!.id,
          acao: "RETIFICOU_REGISTRO",
          recursoId: r.id,
          detalhe: { substitui: original.id, motivo: motivoRetificacao },
          ip,
        },
      });

      return r;
    });

    return NextResponse.json({
      registroId: nova.id,
      versao: nova.versao,
      substitui: original.id,
      assinadoEm: nova.assinadoEm,
    });
  }

  // ---- caminho 3: já retificado -------------------------------------------
  return NextResponse.json(
    {
      erro:
        "Este registro já foi substituído por uma versão posterior. " +
        "Retifique a versão vigente.",
      codigo: "REGISTRO_SUPERADO",
    },
    { status: 409 },
  );
}
