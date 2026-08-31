/**
 * Helpers PUROS do Financeiro (sem Prisma — importável pelo cliente).
 *
 * O mês de referência do DRE é sempre calculado no FUSO DA MÉDICA: "quanto entrou
 * em agosto" é agosto no relógio dela, não em UTC. As fronteiras viram instantes
 * UTC (inicio/fim) prontos pra consulta no banco.
 */

import { fromZonedTime, toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { FUSO_MEDICA } from "./agenda";
import type { CategoriaDespesa } from "@prisma/client";

export const CATEGORIAS: { valor: CategoriaDespesa; rotulo: string }[] = [
  { valor: "FERRAMENTAS", rotulo: "Ferramentas (Daily, AWS, IA)" },
  { valor: "CONTADOR", rotulo: "Contador" },
  { valor: "IMPOSTOS", rotulo: "Impostos" },
  { valor: "MARKETING", rotulo: "Marketing" },
  { valor: "ALUGUEL", rotulo: "Aluguel" },
  { valor: "OUTROS", rotulo: "Outras" },
];

export const ROTULO_CATEGORIA = Object.fromEntries(
  CATEGORIAS.map((c) => [c.valor, c.rotulo]),
) as Record<CategoriaDespesa, string>;

const RE_MES = /^\d{4}-\d{2}$/;

/** "YYYY-MM" do mês corrente no fuso da médica. */
export function mesAtual(): string {
  return format(toZonedTime(new Date(), FUSO_MEDICA), "yyyy-MM", { timeZone: FUSO_MEDICA });
}

export interface Referencia {
  mes: string; // "YYYY-MM"
  inicio: Date; // instante UTC do 1º dia 00:00 no fuso da médica
  fim: Date; // instante UTC do 1º dia do mês seguinte
  anterior: string;
  proximo: string;
  rotulo: string; // "agosto de 2026"
}

/** Fronteiras e vizinhos de um mês "YYYY-MM" (default: mês corrente). */
export function referenciaMes(mes?: string): Referencia {
  const m = mes && RE_MES.test(mes) ? mes : mesAtual();
  const [ano, mm] = m.split("-").map(Number) as [number, number];

  const inicio = fromZonedTime(`${m}-01T00:00:00`, FUSO_MEDICA);
  const prox = proximoMes(ano, mm);
  const fim = fromZonedTime(`${prox}-01T00:00:00`, FUSO_MEDICA);

  return {
    mes: m,
    inicio,
    fim,
    anterior: mesAnterior(ano, mm),
    proximo: prox,
    rotulo: format(toZonedTime(inicio, FUSO_MEDICA), "MMMM 'de' yyyy", {
      timeZone: FUSO_MEDICA,
      locale: ptBR,
    }),
  };
}

function proximoMes(ano: number, mm: number): string {
  const a = mm === 12 ? ano + 1 : ano;
  const m = mm === 12 ? 1 : mm + 1;
  return `${a}-${String(m).padStart(2, "0")}`;
}

function mesAnterior(ano: number, mm: number): string {
  const a = mm === 1 ? ano - 1 : ano;
  const m = mm === 1 ? 12 : mm - 1;
  return `${a}-${String(m).padStart(2, "0")}`;
}
