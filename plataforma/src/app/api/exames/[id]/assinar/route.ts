/**
 * POST /api/exames/[id]/assinar — assina a solicitação de exames.
 *
 * Mesma regra da receita/atestado: assinada é imutável; corrigir cria nova versão
 * (substituiId), a original vira RETIFICADO. "IMPRESSA" nesta fase.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ipDoPedido } from "@/lib/pedido";

const Item = z.object({
  categoria: z.enum(["SANGUE", "IMAGEM", "OUTROS"]),
  nome: z.string().min(1, "Todo exame precisa de nome.").max(200),
});

const Corpo = z.object({
  itens: z.array(Item).min(1, "Inclua ao menos um exame.").max(50),
  indicacaoClinica: z.string().max(2000).optional().nullable(),
  motivoRetificacao: z.string().min(10).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: solicitacaoId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const analise = Corpo.safeParse(await req.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const { itens, indicacaoClinica, motivoRetificacao } = analise.data;

  const original = await prisma.solicitacaoExame.findUnique({ where: { id: solicitacaoId } });
  if (!original) {
    return NextResponse.json({ erro: "Solicitação não encontrada." }, { status: 404 });
  }
  if (original.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const ip = ipDoPedido(req);
  const agora = new Date();
  const dados = {
    itens: itens as unknown as Prisma.InputJsonValue,
    indicacaoClinica: indicacaoClinica?.trim() || null,
  };

  // ---- caminho 1: rascunho → assinado ----
  if (original.status === "RASCUNHO") {
    const assinada = await prisma.solicitacaoExame.update({
      where: { id: solicitacaoId },
      data: {
        ...dados,
        status: "ASSINADO",
        editadaPelaMedica: original.origemIA,
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
        detalhe: { tipo: "exames", versao: assinada.versao, qtd: itens.length },
        ip,
      },
    });
    return NextResponse.json({ solicitacaoId: assinada.id, versao: assinada.versao, assinadaEm: assinada.assinadaEm });
  }

  // ---- caminho 2: retificação ----
  if (original.status === "ASSINADO") {
    if (!motivoRetificacao) {
      return NextResponse.json(
        {
          erro:
            "Esta solicitação já está assinada e não pode ser alterada. Informe o motivo " +
            "para criar uma nova versão — a original permanece registrada.",
          codigo: "EXIGE_MOTIVO_RETIFICACAO",
        },
        { status: 409 },
      );
    }

    const nova = await prisma.$transaction(async (tx) => {
      const s = await tx.solicitacaoExame.create({
        data: {
          ...dados,
          consultaId: original.consultaId,
          pacienteId: original.pacienteId,
          medicaId: original.medicaId,
          status: "ASSINADO",
          versao: original.versao + 1,
          substituiId: original.id,
          origemIA: original.origemIA,
          editadaPelaMedica: true,
          indicacaoClinica: [dados.indicacaoClinica, `Retificação: ${motivoRetificacao}`]
            .filter(Boolean)
            .join("\n\n"),
          assinadaEm: agora,
          assinadaPor: env.CRM_MEDICA,
          assinaturaProvedor: "IMPRESSA",
        },
      });
      await tx.solicitacaoExame.update({ where: { id: original.id }, data: { status: "RETIFICADO" } });
      await tx.auditoria.create({
        data: {
          usuarioId: sessao.user!.id,
          acao: "RETIFICOU_REGISTRO",
          recursoId: s.id,
          detalhe: { tipo: "exames", substitui: original.id, motivo: motivoRetificacao },
          ip,
        },
      });
      return s;
    });

    return NextResponse.json({ solicitacaoId: nova.id, versao: nova.versao, substitui: original.id, assinadaEm: nova.assinadaEm });
  }

  // ---- caminho 3: já retificada ----
  return NextResponse.json(
    { erro: "Esta solicitação já foi substituída por uma versão posterior.", codigo: "SOLICITACAO_SUPERADA" },
    { status: 409 },
  );
}
