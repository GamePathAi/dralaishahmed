/**
 * Financeiro — DRE gerencial mensal da médica.
 *
 * Server Component: lê o banco e monta o retrato do mês (receita por método −
 * despesas por categoria = resultado). GERENCIAL, não fiscal — a DRE oficial é do
 * contador; aqui é pra ela ver quanto entrou e sobrou, e exportar CSV pra ele.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { calcularDRE } from "@/lib/financeiro-dados";
import { ROTULO_CATEGORIA } from "@/lib/financeiro";
import { formatarBRL } from "@/lib/config-medica";
import { FUSO_MEDICA } from "@/lib/agenda";
import { format, toZonedTime } from "date-fns-tz";
import { LancarDespesa, ExcluirDespesa } from "@/components/financeiro/LancarDespesa";

export const dynamic = "force-dynamic";

export default async function PaginaFinanceiro({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") redirect("/entrar");

  const { mes } = await searchParams;
  const dre = await calcularDRE(sessao.user.id, mes);
  const { ref, receita, despesaTotal, porCategoria, despesas, resultado } = dre;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-slate-900">Financeiro</h1>
          <p className="mt-1 text-sm capitalize text-slate-600">{ref.rotulo}</p>
        </div>
        <nav className="flex items-center gap-1">
          <Link href={`/financeiro?mes=${ref.anterior}`} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            ← Anterior
          </Link>
          <Link href="/financeiro" className="rounded-lg px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50">
            Mês atual
          </Link>
          <Link href={`/financeiro?mes=${ref.proximo}`} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Próximo →
          </Link>
        </nav>
      </header>

      {/* ---- DRE ---- */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-100">
          <LinhaGrupo titulo="Receita de consultas" valor={receita.total} tom="receita" />
          <LinhaItem rotulo="Pix" valor={receita.pix} />
          <LinhaItem rotulo="Dinheiro / encaixe" valor={receita.dinheiro} />
          {receita.outros > 0 && <LinhaItem rotulo="Outros" valor={receita.outros} />}

          <LinhaGrupo titulo="(−) Despesas" valor={despesaTotal} tom="despesa" />
          {porCategoria.length === 0 ? (
            <p className="px-5 py-3 text-sm text-slate-400">Nenhuma despesa lançada neste mês.</p>
          ) : (
            porCategoria.map((c) => (
              <LinhaItem key={c.categoria} rotulo={ROTULO_CATEGORIA[c.categoria]} valor={c.valorCent} />
            ))
          )}
        </div>

        <div
          className={`flex items-center justify-between px-5 py-4 text-lg font-semibold ${
            resultado >= 0 ? "bg-teal-50 text-teal-900" : "bg-red-50 text-red-800"
          }`}
        >
          <span>= Resultado</span>
          <span className="tabular-nums">{formatarBRL(resultado)}</span>
        </div>
      </section>

      <p className="mt-3 text-xs text-slate-500">
        Retrato gerencial por regime de <b>caixa</b> (quando o dinheiro entrou). Não é a DRE oficial —
        essa é do contador. A receita em Pix é preenchida automaticamente quando o pagamento online
        estiver ligado; hoje entra pelos encaixes.
      </p>

      {/* ---- Despesas do mês ---- */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-lg text-slate-900">Despesas do mês</h2>
          <a
            href={`/api/financeiro/csv?mes=${ref.mes}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Exportar CSV
          </a>
        </div>

        {/* Full-width: quando o formulário abre, ocupa a linha toda (não fica
            espremido ao lado do CSV). */}
        <div className="mt-4">
          <LancarDespesa />
        </div>

        <ul className="mt-4 space-y-2">
          {despesas.length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
              Nenhuma despesa neste mês. Use “Lançar despesa”.
            </li>
          )}
          {despesas.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
            >
              <span className="w-12 shrink-0 font-mono text-sm tabular-nums text-slate-500">
                {format(toZonedTime(d.data, FUSO_MEDICA), "dd/MM", { timeZone: FUSO_MEDICA })}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{d.descricao}</p>
                <p className="text-xs text-slate-500">
                  {ROTULO_CATEGORIA[d.categoria]}
                  {d.recorrente && " · recorrente"}
                </p>
              </div>
              <span className="shrink-0 font-mono text-sm tabular-nums text-slate-800">
                {formatarBRL(d.valorCent)}
              </span>
              <ExcluirDespesa id={d.id} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function LinhaGrupo({ titulo, valor, tom }: { titulo: string; valor: number; tom: "receita" | "despesa" }) {
  return (
    <div className="flex items-center justify-between bg-slate-50 px-5 py-3">
      <span className="text-sm font-semibold text-slate-800">{titulo}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tom === "receita" ? "text-teal-800" : "text-slate-700"}`}>
        {formatarBRL(valor)}
      </span>
    </div>
  );
}

function LinhaItem({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5 pl-8">
      <span className="text-sm text-slate-600">{rotulo}</span>
      <span className="font-mono text-sm tabular-nums text-slate-600">{formatarBRL(valor)}</span>
    </div>
  );
}
