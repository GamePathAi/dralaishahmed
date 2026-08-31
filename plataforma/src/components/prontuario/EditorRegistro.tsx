"use client";

/**
 * Editor de registro clínico em página cheia.
 *
 * Cobre os três estados em que a médica chega aqui:
 *   • rascunho da IA para revisar e assinar
 *   • consulta sem registro nenhum (presencial, ou a IA falhou) → redigir do zero
 *   • registro já assinado → retificar, criando nova versão
 *
 * Nota de refatoração: os campos duplicam `ModalRevisaoNotas`. Foram mantidos
 * separados porque o modal roda dentro da videochamada, com restrição de espaço
 * e sem estado de retificação. Unificar num `CamposRegistro` compartilhado é a
 * próxima limpeza natural.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CamposRegistro {
  queixaPrincipal: string;
  historiaMoleastiaAtual: string;
  antecedentes: string;
  hipotesesDiagnosticas: string;
  conduta: string;
  observacoes: string;
}

export type ModoEditor = "novo" | "rascunho" | "retificar";

interface Props {
  consultaId: string;
  /** Destino após assinar. Vem da página, que já carregou a consulta. */
  pacienteId: string;
  registroId?: string;
  modo: ModoEditor;
  inicial: CamposRegistro;
  pontosParaRevisao?: string[];
  origemIA?: boolean;
  crmMedica: string;
  /** Anotações que a médica digitou na sala — oferecidas para pré-preencher. */
  notaSessao?: string;
}

const CAMPOS = [
  { chave: "queixaPrincipal", rotulo: "Queixa Principal", sigla: "QP", linhas: 3 },
  { chave: "historiaMoleastiaAtual", rotulo: "História da Moléstia Atual", sigla: "HMA", linhas: 9 },
  { chave: "antecedentes", rotulo: "Antecedentes", sigla: "AP/AF", linhas: 5 },
  { chave: "hipotesesDiagnosticas", rotulo: "Hipóteses Diagnósticas", sigla: "HD", linhas: 4 },
  { chave: "conduta", rotulo: "Conduta e Plano Terapêutico", sigla: "CD", linhas: 9 },
  { chave: "observacoes", rotulo: "Observações", sigla: "OBS", linhas: 3 },
] as const;

type Chave = (typeof CAMPOS)[number]["chave"];

const OBRIGATORIOS: Chave[] = [
  "queixaPrincipal",
  "historiaMoleastiaAtual",
  "antecedentes",
  "hipotesesDiagnosticas",
  "conduta",
];

export function EditorRegistro({
  consultaId,
  pacienteId,
  registroId,
  modo,
  inicial,
  pontosParaRevisao = [],
  origemIA = false,
  crmMedica,
  notaSessao,
}: Props) {
  const router = useRouter();
  const [notaUsada, setNotaUsada] = useState(false);

  const [campos, setCampos] = useState(inicial);
  const [editados, setEditados] = useState<Set<Chave>>(new Set());
  const [vistos, setVistos] = useState<Set<number>>(new Set());
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pendentes = pontosParaRevisao.length - vistos.size;
  const faltando = OBRIGATORIOS.filter((c) => !campos[c].trim());

  const podeAssinar =
    !salvando &&
    faltando.length === 0 &&
    pendentes === 0 &&
    (modo !== "retificar" || motivo.trim().length >= 10);

  const editar = (chave: Chave, valor: string) => {
    setCampos((c) => ({ ...c, [chave]: valor }));
    setEditados((s) => new Set(s).add(chave));
  };

  const assinar = async () => {
    setSalvando(true);
    setErro(null);

    try {
      let id = registroId;

      // Registro manual ainda não existe no banco — cria antes de assinar.
      if (modo === "novo") {
        const r = await fetch(`/api/consultas/${consultaId}/registro`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(campos),
        });
        const d = await r.json();

        if (!r.ok) {
          // Outra aba criou um rascunho no meio do caminho: aproveita aquele
          // em vez de falhar, senão os dois textos competiriam pelo prontuário.
          if (d.codigo === "RASCUNHO_EXISTENTE" && d.registroId) {
            id = d.registroId;
          } else {
            throw new Error(d.erro ?? "Não foi possível criar o registro.");
          }
        } else {
          id = d.registroId;
        }
      }

      const resposta = await fetch(`/api/prontuario/${id}/assinar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relatorio: { ...campos, observacoes: campos.observacoes || null },
          ...(modo === "retificar" ? { motivoRetificacao: motivo.trim() } : {}),
        }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro ?? "Falha ao assinar.");

      router.push(`/pacientes/${pacienteId}`);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-6">
      {modo === "retificar" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Retificação de registro assinado
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-amber-900">
            O registro original não será alterado nem apagado — ele fica no
            prontuário marcado como superado, e esta correção entra como nova
            versão. Descreva o motivo: ele passa a fazer parte do documento.
          </p>
          <textarea
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: dose de losartana registrada como 50mg; o correto é 100mg."
            className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          {motivo.trim().length > 0 && motivo.trim().length < 10 && (
            <p className="mt-1 text-xs text-amber-800">
              Descreva um pouco melhor (mínimo 10 caracteres).
            </p>
          )}
        </div>
      )}

      {origemIA && modo === "rascunho" && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          <span aria-hidden>⚠</span>
          <span>
            Rascunho gerado automaticamente a partir da transcrição.{" "}
            <strong>Confira cada campo antes de assinar</strong> — a
            responsabilidade pelo conteúdo do prontuário é sua.
          </span>
        </p>
      )}

      {/* Oferece as anotações que a médica digitou na sala (só ao registrar do
          zero; não força — ela clica se quiser). */}
      {modo === "novo" && notaSessao && !notaUsada && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/60 px-4 py-3">
          <p className="text-sm text-teal-900">Você tem anotações desta consulta.</p>
          <button
            type="button"
            onClick={() => {
              editar(
                "observacoes",
                campos.observacoes ? `${campos.observacoes}\n\n${notaSessao}` : notaSessao,
              );
              setNotaUsada(true);
            }}
            className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Trazer para Observações
          </button>
        </div>
      )}

      {pontosParaRevisao.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-800">
            Pontos de atenção {pendentes > 0 && `— ${pendentes} pendente(s)`}
          </h2>
          <ul className="mt-2 space-y-1.5">
            {pontosParaRevisao.map((p, i) => (
              <li key={i}>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    checked={vistos.has(i)}
                    onChange={(e) =>
                      setVistos((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(i);
                        else n.delete(i);
                        return n;
                      })
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400 text-teal-700"
                  />
                  <span className={vistos.has(i) ? "line-through opacity-50" : ""}>
                    {p}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {CAMPOS.map(({ chave, rotulo, sigla, linhas }) => {
        const vazioObrigatorio =
          OBRIGATORIOS.includes(chave) && !campos[chave].trim();

        return (
          <div key={chave}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <label htmlFor={chave} className="text-sm font-semibold text-slate-800">
                {rotulo}
                {OBRIGATORIOS.includes(chave) && (
                  <span className="text-red-600"> *</span>
                )}
              </label>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                {sigla}
              </span>
              {origemIA && modo === "rascunho" && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    editados.has(chave)
                      ? "bg-teal-50 text-teal-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {editados.has(chave) ? "revisado" : "texto original da IA"}
                </span>
              )}
            </div>
            <textarea
              id={chave}
              rows={linhas}
              value={campos[chave]}
              onChange={(e) => editar(chave, e.target.value)}
              className={`w-full resize-y rounded-lg border px-3 py-2 text-sm leading-relaxed text-slate-800 focus:ring-1 ${
                vazioObrigatorio
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-slate-300 focus:border-teal-600 focus:ring-teal-600"
              }`}
            />
          </div>
        );
      })}

      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800">{erro}</p>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-b-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-slate-500">
            Será assinado por <strong>{crmMedica}</strong>. Depois de assinado, o
            registro torna-se imutável.
          </p>
          <button
            onClick={() => void assinar()}
            disabled={!podeAssinar}
            title={
              faltando.length > 0
                ? "Preencha os campos obrigatórios"
                : pendentes > 0
                  ? `Marque os ${pendentes} ponto(s) de atenção`
                  : modo === "retificar" && motivo.trim().length < 10
                    ? "Descreva o motivo da retificação"
                    : undefined
            }
            className="rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {salvando
              ? "Salvando…"
              : modo === "retificar"
                ? "Assinar retificação"
                : "Assinar e salvar no prontuário"}
          </button>
        </div>
      </div>
    </div>
  );
}
