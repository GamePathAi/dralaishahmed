"use client";

/**
 * Formulário de lançar despesa + botão de excluir, usados na tela /financeiro.
 * Ambos chamam a API e dão `router.refresh()` para o DRE (Server Component)
 * recalcular com o dado novo.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIAS } from "@/lib/financeiro";

const FUSO_CLINICA = "America/Campo_Grande";
const hojeClinica = () => new Date().toLocaleDateString("en-CA", { timeZone: FUSO_CLINICA });
const reaisParaCent = (v: string) => {
  // Aceita o jeito natural BR ("1.234,56"), US ("1234.56") e simples ("45").
  let s = v.trim().replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // vírgula=decimal, ponto=milhar
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

const CAMPO =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700";

export function LancarDespesa() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState({
    descricao: "",
    categoria: "FERRAMENTAS",
    valor: "",
    data: hojeClinica(),
    recorrente: false,
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  const salvar = async () => {
    setErro(null);
    if (!f.descricao.trim()) return setErro("Descreva a despesa.");
    if (reaisParaCent(f.valor) < 1) return setErro("Informe o valor.");
    setEnviando(true);
    try {
      const r = await fetch("/api/despesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: f.descricao.trim(),
          categoria: f.categoria,
          valorCent: reaisParaCent(f.valor),
          data: f.data,
          recorrente: f.recorrente,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return setErro(d.erro ?? "Não foi possível salvar.");
      }
      setF({ descricao: "", categoria: f.categoria, valor: "", data: hojeClinica(), recorrente: false });
      setAberto(false);
      router.refresh();
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
      >
        + Lançar despesa
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
          Descrição
          <input
            value={f.descricao}
            onChange={(e) => set({ descricao: e.target.value })}
            placeholder="ex.: Assinatura Daily, honorário do contador…"
            className={CAMPO}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Categoria
          <select value={f.categoria} onChange={(e) => set({ categoria: e.target.value })} className={CAMPO}>
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>{c.rotulo}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Valor (R$)
          <input
            type="text"
            inputMode="decimal"
            value={f.valor}
            onChange={(e) => set({ valor: e.target.value })}
            placeholder="0,00"
            className={CAMPO}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Data
          <input type="date" value={f.data} onChange={(e) => set({ data: e.target.value })} className={CAMPO} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={f.recorrente}
            onChange={(e) => set({ recorrente: e.target.checked })}
            className="h-4 w-4 rounded border-slate-400 text-teal-800"
          />
          Repete todo mês
        </label>
      </div>

      {erro && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => { setAberto(false); setErro(null); }}
          className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={() => void salvar()}
          className="rounded-lg bg-teal-800 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
        >
          {enviando ? "Salvando…" : "Salvar despesa"}
        </button>
      </div>
    </div>
  );
}

export function ExcluirDespesa({ id }: { id: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const excluir = async () => {
    // 1º clique só arma a confirmação; 2º clique (em até 4s) apaga de fato.
    if (!confirmar) {
      setConfirmar(true);
      setTimeout(() => setConfirmar(false), 4000);
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch(`/api/despesas/${id}`, { method: "DELETE" });
      if (r.ok) router.refresh();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <button
      type="button"
      disabled={enviando}
      onClick={() => void excluir()}
      title="Remover despesa"
      className={`rounded-lg px-2.5 py-1 text-xs transition disabled:opacity-40 ${
        confirmar
          ? "bg-red-600 font-medium text-white hover:bg-red-700"
          : "border border-slate-200 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
      }`}
    >
      {enviando ? "…" : confirmar ? "confirmar?" : "remover"}
    </button>
  );
}
