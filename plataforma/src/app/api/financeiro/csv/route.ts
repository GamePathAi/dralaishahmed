/**
 * GET /api/financeiro/csv?mes=YYYY-MM — exporta o DRE gerencial do mês em CSV
 * (só médica). Formato pt-BR: separador ";" e decimal com vírgula, com BOM pra o
 * Excel abrir os acentos certos. É o arquivo que "o contador engole".
 */

import { NextRequest, NextResponse } from "next/server";
import { format, toZonedTime } from "date-fns-tz";
import { auth } from "@/lib/auth";
import { calcularDRE } from "@/lib/financeiro-dados";
import { ROTULO_CATEGORIA } from "@/lib/financeiro";
import { FUSO_MEDICA } from "@/lib/agenda";

const reais = (cent: number) => (cent / 100).toFixed(2).replace(".", ",");
const campo = (v: string) => {
  // Neutraliza CSV/formula injection: um campo começando com = + - @ tab CR
  // executaria como fórmula no Excel/Sheets. Prefixa com apóstrofo.
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const linha = (cols: (string | number)[]) => cols.map((c) => campo(String(c))).join(";");

export async function GET(req: NextRequest) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const mes = req.nextUrl.searchParams.get("mes") ?? undefined;
  const dre = await calcularDRE(sessao.user.id, mes);

  const linhas: string[] = [];
  linhas.push(linha(["Financeiro gerencial", dre.ref.rotulo]));
  linhas.push("");
  linhas.push(linha(["Tipo", "Categoria", "Descrição", "Data", "Valor (R$)"]));

  linhas.push(linha(["Receita", "Pix", "", "", reais(dre.receita.pix)]));
  linhas.push(linha(["Receita", "Dinheiro/encaixe", "", "", reais(dre.receita.dinheiro)]));
  if (dre.receita.outros > 0) linhas.push(linha(["Receita", "Outros", "", "", reais(dre.receita.outros)]));

  for (const d of dre.despesas) {
    linhas.push(
      linha([
        "Despesa",
        ROTULO_CATEGORIA[d.categoria],
        d.descricao,
        format(toZonedTime(d.data, FUSO_MEDICA), "dd/MM/yyyy", { timeZone: FUSO_MEDICA }),
        reais(d.valorCent),
      ]),
    );
  }

  linhas.push("");
  linhas.push(linha(["Receita total", "", "", "", reais(dre.receita.total)]));
  linhas.push(linha(["Despesa total", "", "", "", reais(dre.despesaTotal)]));
  linhas.push(linha(["Resultado", "", "", "", reais(dre.resultado)]));

  const csv = "﻿" + linhas.join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="financeiro-${dre.ref.mes}.csv"`,
    },
  });
}
