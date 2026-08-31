/**
 * Cálculo do DRE gerencial (server-only — usa Prisma). Fonte única usada pela
 * tela `/financeiro` e pelo export CSV, pra os dois nunca divergirem.
 *
 * RECEITA = pagamentos PAGO no mês (por `pagoEm`), separados por método
 * (Pix real do Asaas × Dinheiro do encaixe manual). CAIXA, não competência: conta
 * quando o dinheiro entrou.
 * DESPESA = lançamentos do mês + recorrentes já iniciados (repetem todo mês).
 *
 * É GERENCIAL, não fiscal: retrato do negócio pra médica. A DRE que vai à Receita
 * é do contador.
 */

import { prisma } from "./prisma";
import { referenciaMes, type Referencia } from "./financeiro";
import type { CategoriaDespesa } from "@prisma/client";

export interface LinhaDespesa {
  id: string;
  descricao: string;
  categoria: CategoriaDespesa;
  valorCent: number;
  data: Date;
  recorrente: boolean;
}

export interface DRE {
  ref: Referencia;
  receita: { total: number; pix: number; dinheiro: number; outros: number };
  despesaTotal: number;
  porCategoria: { categoria: CategoriaDespesa; valorCent: number }[];
  despesas: LinhaDespesa[];
  resultado: number;
}

export async function calcularDRE(medicaId: string, mes?: string): Promise<DRE> {
  const ref = referenciaMes(mes);

  const [pagos, despesas] = await Promise.all([
    prisma.pagamento.findMany({
      where: {
        status: "PAGO",
        pagoEm: { gte: ref.inicio, lt: ref.fim },
        // Consulta cancelada/faltou não conta como receita (o dinheiro seria
        // devolvido). Quando houver estorno, o Pagamento vira REEMBOLSADO e já
        // sai por status != PAGO.
        consulta: { medicaId, status: { notIn: ["CANCELADA", "FALTOU"] } },
      },
      select: { valorCent: true, metodo: true },
    }),
    prisma.despesa.findMany({
      where: {
        medicaId,
        OR: [
          { recorrente: true, data: { lt: ref.fim } }, // recorrente já iniciada conta todo mês
          { recorrente: false, data: { gte: ref.inicio, lt: ref.fim } },
        ],
      },
      orderBy: { data: "desc" },
      select: { id: true, descricao: true, categoria: true, valorCent: true, data: true, recorrente: true },
    }),
  ]);

  let pix = 0;
  let dinheiro = 0;
  let outros = 0;
  for (const p of pagos) {
    if (p.metodo === "PIX") pix += p.valorCent;
    else if (p.metodo === "DINHEIRO") dinheiro += p.valorCent;
    else outros += p.valorCent;
  }
  const receitaTotal = pix + dinheiro + outros;

  const porCatMap = new Map<CategoriaDespesa, number>();
  let despesaTotal = 0;
  for (const d of despesas) {
    porCatMap.set(d.categoria, (porCatMap.get(d.categoria) ?? 0) + d.valorCent);
    despesaTotal += d.valorCent;
  }
  const porCategoria = [...porCatMap.entries()]
    .map(([categoria, valorCent]) => ({ categoria, valorCent }))
    .sort((a, b) => b.valorCent - a.valorCent);

  return {
    ref,
    receita: { total: receitaTotal, pix, dinheiro, outros },
    despesaTotal,
    porCategoria,
    despesas,
    resultado: receitaTotal - despesaTotal,
  };
}
