/**
 * Janelas de atendimento recorrentes.
 *
 * GET    lista as janelas da médica
 * POST   cria uma janela
 * DELETE remove uma janela (?id=)
 *
 * A validação que importa aqui é a de sobreposição. Duas janelas que se cruzam
 * no mesmo dia geram horários duplicados na grade — e a médica descobre isso
 * quando dois pacientes aparecem para o mesmo encaixe. É barato impedir na
 * criação e caro descobrir depois.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addDays } from "date-fns";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HORIZONTE_DIAS, chaveData, MOTIVO_FOLGA } from "@/lib/agenda";

const Janela = z
  .object({
    diaSemana: z.number().int().min(0).max(6),
    inicioMin: z.number().int().min(0).max(1439),
    fimMin: z.number().int().min(1).max(1440),
    modalidade: z.enum(["TELECONSULTA", "PRESENCIAL"]),
    duracaoMin: z.number().int().min(10).max(180).default(30),
    intervaloMin: z.number().int().min(0).max(60).default(10),
  })
  .refine((j) => j.fimMin > j.inicioMin, {
    message: "O fim da janela precisa vir depois do início.",
    path: ["fimMin"],
  })
  .refine((j) => j.fimMin - j.inicioMin >= j.duracaoMin, {
    message: "A janela é curta demais para caber uma consulta.",
    path: ["duracaoMin"],
  });

async function exigirMedica() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") return null;
  return sessao.user;
}

// ------------------------------------------------------------------- GET

export async function GET() {
  const medica = await exigirMedica();
  if (!medica) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const agora = new Date();
  const horizonte = addDays(agora, HORIZONTE_DIAS);

  const [janelas, datasBrutas, folgasBrutas] = await Promise.all([
    prisma.disponibilidade.findMany({
      where: { medicaId: medica.id, ativo: true },
      orderBy: [{ diaSemana: "asc" }, { inicioMin: "asc" }],
    }),
    // Horários especiais futuros, dentro do horizonte de agendamento.
    prisma.disponibilidadeData.findMany({
      where: { medicaId: medica.id, data: { gte: addDays(agora, -1), lte: horizonte } },
      orderBy: { data: "asc" },
    }),
    // Folgas = bloqueios de dia inteiro criados pelo dashboard.
    prisma.bloqueio.findMany({
      where: {
        medicaId: medica.id,
        motivo: MOTIVO_FOLGA,
        fimEm: { gte: agora },
        inicioEm: { lte: horizonte },
      },
      orderBy: { inicioEm: "asc" },
    }),
  ]);

  // O calendário resolve cada dia por uma chave "yyyy-MM-dd" no fuso da médica.
  const datas = datasBrutas.map((d) => ({
    id: d.id,
    data: chaveData(d.data),
    inicioMin: d.inicioMin,
    fimMin: d.fimMin,
    modalidade: d.modalidade,
    duracaoMin: d.duracaoMin,
    intervaloMin: d.intervaloMin,
  }));
  // Só bloqueios que cobrem o dia INTEIRO contam como folga no calendário — um
  // bloqueio parcial rotulado "Folga" (2h de reunião) não deve pintar o dia
  // todo de folga, já que a grade ainda oferece o resto do dia.
  const folgas = folgasBrutas
    .filter((b) => b.fimEm.getTime() - b.inicioEm.getTime() >= 23 * 60 * 60_000)
    .map((b) => ({ id: b.id, data: chaveData(b.inicioEm) }));

  return NextResponse.json({ janelas, datas, folgas });
}

// ------------------------------------------------------------------ POST

export async function POST(req: NextRequest) {
  const medica = await exigirMedica();
  if (!medica) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const analise = Janela.safeParse(await req.json());
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const nova = analise.data;

  const existentes = await prisma.disponibilidade.findMany({
    where: { medicaId: medica.id, diaSemana: nova.diaSemana, ativo: true },
  });

  // Encostar não é sobrepor: 08:00–12:00 e 12:00–18:00 convivem bem.
  const conflito = existentes.find(
    (e) => nova.inicioMin < e.fimMin && nova.fimMin > e.inicioMin,
  );

  if (conflito) {
    return NextResponse.json(
      {
        erro: `Esta janela se sobrepõe a outra já cadastrada (${paraHora(
          conflito.inicioMin,
        )}–${paraHora(conflito.fimMin)}).`,
        codigo: "SOBREPOSICAO",
      },
      { status: 409 },
    );
  }

  const janela = await prisma.disponibilidade.create({
    data: { ...nova, medicaId: medica.id },
  });

  return NextResponse.json({ janela }, { status: 201 });
}

// ---------------------------------------------------------------- DELETE

export async function DELETE(req: NextRequest) {
  const medica = await exigirMedica();
  if (!medica) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  // Desligar um dia inteiro numa chamada só (dashboard): remove TODAS as janelas
  // do dia de uma vez, em vez de o cliente deletar uma a uma (que falharia pela
  // metade se a rede caísse no meio).
  const diaSemanaParam = req.nextUrl.searchParams.get("diaSemana");
  if (diaSemanaParam !== null) {
    const diaSemana = Number(diaSemanaParam);
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
      return NextResponse.json({ erro: "Dia da semana inválido." }, { status: 400 });
    }
    const r = await prisma.disponibilidade.updateMany({
      where: { medicaId: medica.id, diaSemana, ativo: true },
      data: { ativo: false },
    });
    return NextResponse.json({ removidas: r.count });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ erro: "Informe o id." }, { status: 400 });
  }

  const janela = await prisma.disponibilidade.findUnique({ where: { id } });
  if (!janela || janela.medicaId !== medica.id) {
    return NextResponse.json({ erro: "Não encontrada." }, { status: 404 });
  }

  // Desativa em vez de apagar. Uma janela removida hoje não pode fazer
  // desaparecer o rastro de por que existia um horário disponível ontem —
  // e consultas já marcadas nela seguem valendo.
  await prisma.disponibilidade.update({
    where: { id },
    data: { ativo: false },
  });

  const marcadas = await prisma.consulta.count({
    where: {
      medicaId: medica.id,
      inicioEm: { gte: new Date() },
      status: { in: ["AGENDADA", "CONFIRMADA"] },
    },
  });

  return NextResponse.json({
    removida: true,
    aviso:
      marcadas > 0
        ? "Consultas já agendadas não foram canceladas — apenas novos horários deixam de ser oferecidos."
        : undefined,
  });
}

function paraHora(minutos: number) {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(
    minutos % 60,
  ).padStart(2, "0")}`;
}
