/**
 * POST /api/agenda/dia — estado de UMA data no calendário do dashboard.
 *
 * Uma rota, três ações, cada uma ATÔMICA:
 *   - "padrao"   → volta ao padrão semanal (remove folga E especial da data)
 *   - "especial" → horário diferente só nesta data (substitui folga/especial)
 *   - "folga"    → dia inteiro fora da agenda (bloqueio; com o mesmo fluxo de
 *                  conflito/cancelamento/e-mail dos bloqueios)
 *
 * Por que uma rota só: o cliente NÃO deve orquestrar "deleta um tipo, cria o
 * outro" em requisições separadas — se a segunda falhasse, o dia podia ficar
 * num estado ruim (ex.: folga apagada e especial não criado → dia de folga
 * vira agendável). Aqui a transição inteira acontece numa transação; ou muda
 * tudo, ou nada. Para a FOLGA com conflito, a checagem é ANTES de qualquer
 * escrita: recusar (409) não apaga nada, então "Voltar" preserva o estado.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enviarCancelamentoConsulta } from "@/lib/email";
import { FUSO_MEDICA, MOTIVO_FOLGA } from "@/lib/agenda";

const Janela = z
  .object({
    inicioMin: z.number().int().min(0).max(1439),
    fimMin: z.number().int().min(1).max(1440),
    modalidade: z.enum(["TELECONSULTA", "PRESENCIAL"]),
    duracaoMin: z.number().int().min(10).max(180).default(30),
    intervaloMin: z.number().int().min(0).max(60).default(10),
  })
  .refine((j) => j.fimMin > j.inicioMin, { message: "O fim precisa vir depois do início.", path: ["fimMin"] })
  .refine((j) => j.fimMin - j.inicioMin >= j.duracaoMin, {
    message: "A janela é curta demais para caber uma consulta.",
    path: ["duracaoMin"],
  });

const Corpo = z
  .object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
    acao: z.enum(["padrao", "folga", "especial"]),
    cancelarConflitos: z.boolean().default(false),
    janela: Janela.optional(),
  })
  .refine((b) => !isNaN(new Date(`${b.data}T12:00:00-04:00`).getTime()), {
    message: "Data inválida.",
    path: ["data"],
  })
  .refine((b) => b.acao !== "especial" || !!b.janela, {
    message: "Informe o horário do dia especial.",
    path: ["janela"],
  });

async function exigirMedica() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") return null;
  return sessao.user;
}

export async function POST(req: NextRequest) {
  const medica = await exigirMedica();
  if (!medica) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  const analise = Corpo.safeParse(await req.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const { data, acao, cancelarConflitos, janela } = analise.data;

  const meioDia = fromZonedTime(`${data}T12:00:00`, FUSO_MEDICA);
  const inicioDia = fromZonedTime(`${data}T00:00:00`, FUSO_MEDICA);
  const fimDia = new Date(inicioDia.getTime() + 24 * 60 * 60_000);

  // Filtros que casam o especial e a folga DESTA data.
  const especialDaData = { medicaId: medica.id, data: meioDia };
  const folgaDaData = {
    medicaId: medica.id,
    motivo: MOTIVO_FOLGA,
    inicioEm: { gte: inicioDia, lt: fimDia },
  };

  // ---- voltar ao padrão --------------------------------------------------
  if (acao === "padrao") {
    await prisma.$transaction([
      prisma.disponibilidadeData.deleteMany({ where: especialDaData }),
      prisma.bloqueio.deleteMany({ where: folgaDaData }),
    ]);
    return NextResponse.json({ ok: true });
  }

  // ---- horário especial --------------------------------------------------
  if (acao === "especial") {
    const j = janela!;
    const especial = await prisma.$transaction(async (tx) => {
      // Especial vence folga, e substitui um especial anterior: limpa os dois.
      await tx.bloqueio.deleteMany({ where: folgaDaData });
      await tx.disponibilidadeData.deleteMany({ where: especialDaData });
      return tx.disponibilidadeData.create({
        data: {
          medicaId: medica.id,
          data: meioDia,
          inicioMin: j.inicioMin,
          fimMin: j.fimMin,
          modalidade: j.modalidade,
          duracaoMin: j.duracaoMin,
          intervaloMin: j.intervaloMin,
        },
      });
    });
    return NextResponse.json({ ok: true, especial }, { status: 201 });
  }

  // ---- folga (dia inteiro) ----------------------------------------------
  // Conflitos são checados ANTES de escrever: se houver consulta marcada e a
  // médica não confirmou o cancelamento, devolvemos 409 SEM apagar nada (nem o
  // especial), para "Voltar" não destruir o estado do dia.
  const conflitos = await prisma.consulta.findMany({
    where: {
      medicaId: medica.id,
      status: { in: ["AGENDADA", "CONFIRMADA"] },
      inicioEm: { gte: inicioDia, lt: fimDia },
    },
    orderBy: { inicioEm: "asc" },
    select: {
      id: true,
      inicioEm: true,
      modalidade: true,
      paciente: { select: { usuario: { select: { nome: true, telefone: true, email: true } } } },
    },
  });

  if (conflitos.length > 0 && !cancelarConflitos) {
    return NextResponse.json(
      {
        erro: `Há ${conflitos.length} consulta${conflitos.length > 1 ? "s" : ""} marcada${
          conflitos.length > 1 ? "s" : ""
        } neste dia.`,
        codigo: "CONFLITO_CONSULTAS",
        conflitos: conflitos.map((c) => ({
          id: c.id,
          inicioEm: c.inicioEm,
          paciente: c.paciente.usuario.nome,
        })),
      },
      { status: 409 },
    );
  }

  const bloqueio = await prisma.$transaction(async (tx) => {
    await tx.disponibilidadeData.deleteMany({ where: especialDaData });
    const b = await tx.bloqueio.create({
      data: { medicaId: medica.id, inicioEm: inicioDia, fimEm: fimDia, motivo: MOTIVO_FOLGA },
    });
    if (conflitos.length > 0) {
      await tx.consulta.updateMany({
        where: { id: { in: conflitos.map((c) => c.id) } },
        data: { status: "CANCELADA" },
      });
      await tx.auditoria.create({
        data: {
          usuarioId: medica.id,
          acao: "CANCELOU_POR_BLOQUEIO",
          recursoId: b.id,
          detalhe: {
            motivo: MOTIVO_FOLGA,
            consultasCanceladas: conflitos.map((c) => ({
              id: c.id,
              paciente: c.paciente.usuario.nome,
              inicioEm: c.inicioEm,
            })),
          },
        },
      });
    }
    return b;
  });

  // Aviso aos pacientes fora da transação: o cancelamento já está gravado, e
  // SMTP fora do ar não pode desfazê-lo.
  const naoAvisados: string[] = [];
  for (const c of conflitos) {
    try {
      await enviarCancelamentoConsulta({
        nome: c.paciente.usuario.nome,
        email: c.paciente.usuario.email,
        inicioEm: c.inicioEm,
        modalidade: c.modalidade,
      });
    } catch (erro) {
      naoAvisados.push(c.paciente.usuario.nome);
      console.error("[agenda/dia] falha ao avisar cancelamento", c.id, erro);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      bloqueio,
      canceladas: conflitos.length,
      avisados: conflitos.length - naoAvisados.length,
      naoAvisados,
      aviso:
        naoAvisados.length > 0
          ? `Não foi possível avisar por e-mail: ${naoAvisados.join(", ")}. Entre em contato diretamente.`
          : undefined,
    },
    { status: 201 },
  );
}
