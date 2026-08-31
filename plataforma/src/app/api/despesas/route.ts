/**
 * POST /api/despesas — lança uma despesa (só médica). Alimenta o DRE gerencial.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_MEDICA } from "@/lib/agenda";

const MAX_CENT = 100_000_00; // R$ 100.000 — teto de sanidade para um lançamento

const Corpo = z.object({
  descricao: z.string().trim().min(1, "Descreva a despesa.").max(120),
  categoria: z.enum(["FERRAMENTAS", "CONTADOR", "IMPOSTOS", "MARKETING", "ALUGUEL", "OUTROS"]),
  valorCent: z.number().int().min(1, "Informe o valor.").max(MAX_CENT),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  recorrente: z.boolean().default(false),
}).refine(
  (b) => {
    // Rejeita data de calendário impossível (ex.: 2026-13-45, 2026-02-30).
    const [y, m, d] = b.data.split("-").map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  },
  { message: "Data inválida.", path: ["data"] },
);

export async function POST(req: NextRequest) {
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

  try {
    const despesa = await prisma.despesa.create({
      data: {
        medicaId: sessao.user.id,
        descricao: d.descricao,
        categoria: d.categoria,
        valorCent: d.valorCent,
        // Meio-dia no fuso da médica: data estável, imune a borda de fuso.
        data: fromZonedTime(`${d.data}T12:00:00`, FUSO_MEDICA),
        recorrente: d.recorrente,
      },
      select: { id: true },
    });
    return NextResponse.json({ id: despesa.id }, { status: 201 });
  } catch (e) {
    console.error("[despesas] falha ao criar", e);
    return NextResponse.json({ erro: "Não foi possível salvar a despesa." }, { status: 500 });
  }
}
