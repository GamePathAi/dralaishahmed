"use client";

/**
 * Editor de solicitação de exames. A médica marca exames comuns (rápido) e/ou
 * digita os próprios, escreve a indicação clínica e assina. Assinada é imutável;
 * corrigir retifica (nova versão), igual à receita/atestado.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  EXAMES_COMUNS,
  ROTULO_CATEGORIA_EXAME,
  type CategoriaExame,
  type ItemExame,
} from "@/lib/documentos/exames-comuns";

interface Props {
  solicitacaoId: string;
  nomePaciente: string;
  jaAssinada: boolean;
  itensIniciais: ItemExame[];
  indicacaoInicial: string;
}

const CATEGORIAS: CategoriaExame[] = ["SANGUE", "IMAGEM", "OUTROS"];

export function EditorExames({ solicitacaoId, nomePaciente, jaAssinada, itensIniciais, indicacaoInicial }: Props) {
  const router = useRouter();
  const [itens, setItens] = useState<ItemExame[]>(itensIniciais);
  const [indicacao, setIndicacao] = useState(indicacaoInicial);
  const [novoNome, setNovoNome] = useState("");
  const [novaCat, setNovaCat] = useState<CategoriaExame>("OUTROS");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const temExame = (nome: string) => itens.some((i) => i.nome.toLowerCase() === nome.toLowerCase());

  const alternar = (item: ItemExame) =>
    setItens((atual) =>
      temExame(item.nome) ? atual.filter((i) => i.nome.toLowerCase() !== item.nome.toLowerCase()) : [...atual, item],
    );

  const adicionarLivre = () => {
    const nome = novoNome.trim();
    if (!nome || temExame(nome)) {
      setNovoNome("");
      return;
    }
    setItens((atual) => [...atual, { categoria: novaCat, nome }]);
    setNovoNome("");
  };

  const remover = (nome: string) =>
    setItens((atual) => atual.filter((i) => i.nome.toLowerCase() !== nome.toLowerCase()));

  const assinar = async () => {
    setErro(null);
    if (itens.length === 0) return setErro("Selecione ou adicione ao menos um exame.");
    if (jaAssinada && motivo.trim().length < 10) return setErro("Descreva o motivo da retificação (mín. 10 caracteres).");

    setEnviando(true);
    try {
      const r = await fetch(`/api/exames/${solicitacaoId}/assinar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens,
          indicacaoClinica: indicacao.trim() || null,
          ...(jaAssinada ? { motivoRetificacao: motivo.trim() } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(d.erro ?? "Não foi possível assinar a solicitação.");
      router.push(`/exames/${d.solicitacaoId}/imprimir`);
    } catch {
      setErro("Sem conexão para assinar. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-serif text-2xl text-slate-900">Solicitação de exames — {nomePaciente}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Marque os exames comuns ou digite os seus. Nada vale antes de você assinar.
      </p>

      {/* Exames comuns por categoria */}
      <div className="mt-5 space-y-4">
        {CATEGORIAS.map((cat) => {
          const doGrupo = EXAMES_COMUNS.filter((e) => e.categoria === cat);
          if (doGrupo.length === 0) return null;
          return (
            <div key={cat}>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {ROTULO_CATEGORIA_EXAME[cat]}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {doGrupo.map((e) => (
                  <button
                    key={e.nome}
                    type="button"
                    onClick={() => alternar(e)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      temExame(e.nome)
                        ? "border-teal-700 bg-teal-50 font-medium text-teal-900"
                        : "border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {temExame(e.nome) ? "✓ " : ""}
                    {e.nome}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Adicionar exame livre */}
      <div className="mt-5 flex flex-wrap items-end gap-2">
        <label className="text-sm font-medium text-slate-700">
          Adicionar exame
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarLivre())}
            placeholder="ex.: PSA total"
            className="mt-1 w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
          />
        </label>
        <select
          value={novaCat}
          onChange={(e) => setNovaCat(e.target.value as CategoriaExame)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>{ROTULO_CATEGORIA_EXAME[c]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={adicionarLivre}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-teal-600 hover:text-teal-800"
        >
          Adicionar
        </button>
      </div>

      {/* Selecionados */}
      <div className="mt-6">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Exames solicitados ({itens.length})
        </span>
        {itens.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Nenhum exame ainda.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {itens.map((i) => (
              <li key={i.nome} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="text-slate-800">
                  {i.nome} <span className="text-xs text-slate-400">· {ROTULO_CATEGORIA_EXAME[i.categoria]}</span>
                </span>
                <button type="button" onClick={() => remover(i.nome)} className="text-xs font-medium text-red-600 hover:text-red-800">
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6">
        <label htmlFor="indicacao" className="text-sm font-medium text-slate-700">
          Indicação clínica <span className="font-normal text-slate-400">(opcional)</span>
        </label>
        <textarea
          id="indicacao"
          rows={3}
          value={indicacao}
          onChange={(e) => setIndicacao(e.target.value)}
          placeholder="ex.: investigação de anemia; controle de dislipidemia."
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
        />
      </div>

      {jaAssinada && (
        <div className="mt-4">
          <label htmlFor="motivo" className="text-sm font-medium text-slate-700">Motivo da retificação</label>
          <input
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Esta solicitação já foi assinada — descreva o que muda e por quê."
            className="mt-1 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm focus:border-amber-600 focus:ring-1 focus:ring-amber-600"
          />
        </div>
      )}

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void assinar()}
          disabled={enviando}
          className="rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
        >
          {enviando ? "Assinando…" : jaAssinada ? "Assinar retificação" : "Assinar solicitação"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Voltar
        </button>
      </div>

      <p className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        Ao assinar, a solicitação fica imutável e recebe seu CRM. Uma correção posterior cria nova
        versão; a anterior permanece registrada.
      </p>
    </div>
  );
}
