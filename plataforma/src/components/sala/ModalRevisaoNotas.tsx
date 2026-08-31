"use client";

/**
 * Revisão e assinatura do rascunho gerado pela IA.
 *
 * Duas decisões de UX que são, na verdade, decisões de segurança clínica:
 *
 *   1. Não existe "assinar tudo" sem passar pelos campos. Os pontos de atenção
 *      levantados pelo modelo precisam ser reconhecidos um a um. Um botão de
 *      aceite em massa converteria a revisão médica em formalidade.
 *
 *   2. Campos editados são marcados visualmente. A médica vê o que já revisou e
 *      o que ainda está exatamente como a máquina escreveu.
 */

import { useMemo, useState } from "react";
import type { RelatorioClinico } from "@/lib/ia/notas-clinicas";

interface Props {
  registroId: string;
  relatorioInicial: RelatorioClinico;
  nomePaciente: string;
  crmMedica: string;
  aoAssinar: (registroId: string, relatorio: RelatorioClinico) => Promise<void>;
  aoFechar: () => void;
}

const CAMPOS = [
  { chave: "queixaPrincipal", rotulo: "Queixa Principal", sigla: "QP", linhas: 3 },
  { chave: "historiaMoleastiaAtual", rotulo: "História da Moléstia Atual", sigla: "HMA", linhas: 8 },
  { chave: "antecedentes", rotulo: "Antecedentes", sigla: "AP/AF", linhas: 5 },
  { chave: "hipotesesDiagnosticas", rotulo: "Hipóteses Diagnósticas", sigla: "HD", linhas: 4 },
  { chave: "conduta", rotulo: "Conduta e Plano Terapêutico", sigla: "CD", linhas: 8 },
  { chave: "observacoes", rotulo: "Observações", sigla: "OBS", linhas: 3 },
] as const;

type ChaveCampo = (typeof CAMPOS)[number]["chave"];

export function ModalRevisaoNotas({
  registroId,
  relatorioInicial,
  nomePaciente,
  crmMedica,
  aoAssinar,
  aoFechar,
}: Props) {
  const [relatorio, setRelatorio] = useState(relatorioInicial);
  const [editados, setEditados] = useState<Set<ChaveCampo>>(new Set());
  const [pontosVistos, setPontosVistos] = useState<Set<number>>(new Set());
  const [assinando, setAssinando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pontos = relatorioInicial.pontosParaRevisao ?? [];
  const pendentes = pontos.length - pontosVistos.size;
  const podeAssinar = pendentes === 0 && !assinando;

  const editar = (chave: ChaveCampo, valor: string) => {
    setRelatorio((r) => ({ ...r, [chave]: valor }));
    setEditados((s) => new Set(s).add(chave));
  };

  const contagem = useMemo(
    () =>
      CAMPOS.reduce(
        (n, c) => n + ((relatorio[c.chave] as string)?.trim() ? 1 : 0),
        0,
      ),
    [relatorio],
  );

  const assinar = async () => {
    setAssinando(true);
    setErro(null);
    try {
      await aoAssinar(registroId, relatorio);
    } catch {
      setErro("Não foi possível assinar. Tente novamente — o rascunho está salvo.");
      setAssinando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* cabeçalho */}
        <header className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-xl text-slate-900">
                Revisão do registro clínico
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {nomePaciente} · {contagem} de {CAMPOS.length} campos preenchidos
              </p>
            </div>
            <button
              onClick={aoFechar}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            >
              Fechar
            </button>
          </div>

          <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <span aria-hidden>⚠</span>
            <span>
              Rascunho gerado automaticamente a partir da transcrição.{" "}
              <strong>Confira cada campo antes de assinar</strong> — a
              responsabilidade pelo conteúdo do prontuário é sua.
            </span>
          </p>
        </header>

        {/* pontos de atenção */}
        {pontos.length > 0 && (
          <section className="border-b border-amber-200 bg-amber-50/60 px-6 py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-800">
              Pontos de atenção {pendentes > 0 && `— ${pendentes} pendente(s)`}
            </h3>
            <ul className="mt-2 space-y-1.5">
              {pontos.map((p, i) => (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={pontosVistos.has(i)}
                      onChange={(e) =>
                        setPontosVistos((s) => {
                          const n = new Set(s);
                          e.target.checked ? n.add(i) : n.delete(i);
                          return n;
                        })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400 text-teal-700"
                    />
                    <span className={pontosVistos.has(i) ? "line-through opacity-50" : ""}>
                      {p}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* campos */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {CAMPOS.map(({ chave, rotulo, sigla, linhas }) => (
            <div key={chave}>
              <div className="mb-1.5 flex items-center gap-2">
                <label
                  htmlFor={chave}
                  className="text-sm font-semibold text-slate-800"
                >
                  {rotulo}
                </label>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                  {sigla}
                </span>
                {editados.has(chave) ? (
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">
                    revisado
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                    texto original da IA
                  </span>
                )}
              </div>
              <textarea
                id={chave}
                rows={linhas}
                value={(relatorio[chave] as string) ?? ""}
                onChange={(e) => editar(chave, e.target.value)}
                className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed text-slate-800 focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              />
            </div>
          ))}
        </div>

        {/* rodapé */}
        <footer className="border-t border-slate-200 bg-slate-50 px-6 py-4">
          {erro && <p className="mb-3 text-sm text-red-700">{erro}</p>}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              Assinado por <strong>{crmMedica}</strong>. Após assinar, o registro
              torna-se imutável — correções geram nova versão.
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={aoFechar}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-200"
              >
                Salvar rascunho
              </button>
              <button
                onClick={assinar}
                disabled={!podeAssinar}
                title={
                  pendentes > 0
                    ? `Marque os ${pendentes} ponto(s) de atenção antes de assinar`
                    : undefined
                }
                className="rounded-lg bg-teal-800 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {assinando ? "Assinando…" : "Assinar e salvar no prontuário"}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
