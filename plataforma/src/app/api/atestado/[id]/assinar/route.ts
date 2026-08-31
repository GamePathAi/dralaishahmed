/**
 * POST /api/atestado/[id]/assinar — aplica as edições da médica e assina.
 *
 * Mesma regra da receita/prontuário: atestado ASSINADO nunca muda. Corrigir cria
 * nova versão (substituiId), e a anterior vira RETIFICADO (preservado). Fica
 * "IMPRESSA" nesta fase; os campos de provedor (ICP-Brasil) são Fase 2.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ipDoPedido } from "@/lib/pedido";
import { fromZonedTime } from "date-fns-tz";
import { FUSO_MEDICA } from "@/lib/agenda";

const Corpo = z.object({
  tipo: z.enum(["COMPARECIMENTO", "AFASTAMENTO", "REPOUSO"]),
  diasAfastamento: z.number().int().min(1).max(365).nullable().optional(),
  cid: z.string().max(20).nullable().optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  textoLivre: z.string().min(1, "O atestado precisa de um texto.").max(5000),
  /** Obrigatório ao retificar um atestado já assinado. */
  motivoRetificacao: z.string().min(10).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: atestadoId } = await params;

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
  const d = analise.data;

  const original = await prisma.atestado.findUnique({ where: { id: atestadoId } });
  if (!original) {
    return NextResponse.json({ erro: "Atestado não encontrado." }, { status: 404 });
  }
  if (original.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  const ip = ipDoPedido(req);
  const agora = new Date();
  const dados = {
    tipo: d.tipo,
    // Dias só fazem sentido em afastamento/repouso.
    diasAfastamento: d.tipo === "COMPARECIMENTO" ? null : (d.diasAfastamento ?? null),
    cid: d.cid?.trim() || null,
    dataInicio: fromZonedTime(`${d.dataInicio}T12:00:00`, FUSO_MEDICA),
    textoLivre: d.textoLivre.trim(),
  };

  // ---- caminho 1: rascunho → assinado ----
  if (original.status === "RASCUNHO") {
    const assinado = await prisma.atestado.update({
      where: { id: atestadoId },
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
        recursoId: assinado.id,
        detalhe: { tipo: "atestado", subtipo: assinado.tipo, versao: assinado.versao },
        ip,
      },
    });
    return NextResponse.json({ atestadoId: assinado.id, versao: assinado.versao, assinadaEm: assinado.assinadaEm });
  }

  // ---- caminho 2: retificação de atestado já assinado ----
  if (original.status === "ASSINADO") {
    if (!d.motivoRetificacao) {
      return NextResponse.json(
        {
          erro:
            "Este atestado já está assinado e não pode ser alterado. Para corrigi-lo, " +
            "informe o motivo — será criada uma nova versão, e a original permanece registrada.",
          codigo: "EXIGE_MOTIVO_RETIFICACAO",
        },
        { status: 409 },
      );
    }

    const nova = await prisma.$transaction(async (tx) => {
      const a = await tx.atestado.create({
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
          // Anexa o motivo ao texto para constar na via retificada.
          textoLivre: `${dados.textoLivre}\n\n(Retificação: ${d.motivoRetificacao})`,
          assinadaEm: agora,
          assinadaPor: env.CRM_MEDICA,
          assinaturaProvedor: "IMPRESSA",
        },
      });
      await tx.atestado.update({ where: { id: original.id }, data: { status: "RETIFICADO" } });
      await tx.auditoria.create({
        data: {
          usuarioId: sessao.user!.id,
          acao: "RETIFICOU_REGISTRO",
          recursoId: a.id,
          detalhe: { tipo: "atestado", substitui: original.id, motivo: d.motivoRetificacao },
          ip,
        },
      });
      return a;
    });

    return NextResponse.json({ atestadoId: nova.id, versao: nova.versao, substitui: original.id, assinadaEm: nova.assinadaEm });
  }

  // ---- caminho 3: já retificado ----
  return NextResponse.json(
    { erro: "Este atestado já foi substituído por uma versão posterior.", codigo: "ATESTADO_SUPERADO" },
    { status: 409 },
  );
}
