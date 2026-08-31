"use client";

/**
 * Editor de receita — a médica revisa o que a IA rascunhou, corrige e assina.
 *
 * A IA nunca prescreve: ela organiza o que foi dito na consulta em itens
 * estruturados. Nada vira receita sem esta tela, onde a médica confere cada
 * dose e assina com o CRM dela. Por isso os itens são todos editáveis e a
 * assinatura é um ato explícito, nunca automático.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type ItemReceita, itemReceitaVazio } from "@/lib/receita-tipos";

interface Props {
  receitaId: string;
  itensIniciais: ItemReceita[];
  orientacoesIniciais: string;
  nomePaciente: string;
  /** Já assinada? Então editar é RETIFICAR — exige motivo e cria nova versão. */
  jaAssinada: boolean;
  /** Pontos de atenção que a IA marcou (dose incerta, controlado, nome duvidoso). */
  pontosParaRevisao: string[];
}

export function EditorReceita({
  receitaId,
  itensIniciais,
  orientacoesIniciais,
  nomePaciente,
  jaAssinada,
  pontosParaRevisao,
}: Props) {
  const router = useRouter();
  const [itens, setItens] = useState<ItemReceita[]>(
    itensIniciais.length ? itensIniciais : [itemReceitaVazio()],
  );
  const [orientacoes, setOrientacoes] = useState(orientacoesIniciais);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const temControlado = itens.some((i) => i.controlado);

  const atualizar = (i: number, campo: keyof ItemReceita, valor: string | boolean) =>
    setItens((atual) =>
      atual.map((item, idx) => (idx === i ? { ...item, [campo]: valor } : item)),
    );

  const remover = (i: number) =>
    setItens((atual) => atual.filter((_, idx) => idx !== i));

  const adicionar = () => setItens((atual) => [...atual, itemReceitaVazio()]);

  const assinar = async () => {
    setErro(null);

    // Guarda no cliente: assinatura é irreversível, e item sem nome ou sem
    // posologia é receita inválida. O servidor revalida, mas avisar aqui evita
    // um 400 depois de a médica clicar "assinar".
    const limpos = itens.filter((i) => i.medicamento.trim());
    if (limpos.length === 0) {
      setErro("Inclua ao menos um medicamento antes de assinar.");
      return;
    }
    const semPosologia = limpos.find((i) => !i.posologia.trim());
    if (semPosologia) {
      setErro(`Falta a posologia de "${semPosologia.medicamento}".`);
      return;
    }
    if (jaAssinada && motivo.trim().length < 10) {
      setErro("Descreva o motivo da retificação (mínimo 10 caracteres).");
      return;
    }

    setEnviando(true);
    try {
      const r = await fetch(`/api/receita/${receitaId}/assinar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: limpos,
          orientacoesGerais: orientacoes.trim() || null,
          ...(jaAssinada ? { motivoRetificacao: motivo.trim() } : {}),
        }),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(dados.erro ?? "Não foi possível assinar a receita.");
        return;
      }
      // Vai direto para a via impressa da versão assinada.
      router.push(`/receita/${dados.receitaId}/imprimir`);
    } catch {
      setErro(
        "Sem conexão para assinar. Verifique a internet e tente novamente.",
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-serif text-2xl text-slate-900">
        Receita — {nomePaciente}
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        Rascunho da IA. Confira cada medicamento e a posologia; nada vale antes de
        você assinar.
      </p>

      {pontosParaRevisao.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
            Confira antes de assinar
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {pontosParaRevisao.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {temControlado && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <strong>Há medicamento de controle especial nesta receita.</strong> A via
          impressa aqui serve como receita simples; medicamento controlado
          (tarja preta) exige <strong>receituário especial</strong> (Notificação de
          Receita / controle especial) e não é dispensável só com esta impressão.
          Use o receituário próprio para esses itens.
        </div>
      )}

      <div className="mt-6 space-y-4">
        {itens.map((item, i) => (
          <div
            key={i}
            className={`rounded-xl border p-4 ${
              item.controlado ? "border-red-300 bg-red-50/40" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Medicamento {i + 1}
              </span>
              {itens.length > 1 && (
                <button
                  type="button"
                  onClick={() => remover(i)}
                  className="text-xs font-medium text-red-600 hover:text-red-800"
                >
                  Remover
                </button>
              )}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-6">
              <CampoTexto
                className="sm:col-span-4"
                rotulo="Medicamento"
                valor={item.medicamento}
                aoMudar={(v) => atualizar(i, "medicamento", v)}
              />
              <CampoTexto
                className="sm:col-span-2"
                rotulo="Concentração"
                valor={item.concentracao}
                aoMudar={(v) => atualizar(i, "concentracao", v)}
              />
              <CampoTexto
                className="sm:col-span-2"
                rotulo="Forma"
                valor={item.formaFarmaceutica}
                aoMudar={(v) => atualizar(i, "formaFarmaceutica", v)}
              />
              <CampoTexto
                className="sm:col-span-2"
                rotulo="Via"
                valor={item.via}
                aoMudar={(v) => atualizar(i, "via", v)}
              />
              <CampoTexto
                className="sm:col-span-2"
                rotulo="Quantidade"
                valor={item.quantidade}
                aoMudar={(v) => atualizar(i, "quantidade", v)}
              />
              <CampoTexto
                className="sm:col-span-6"
                rotulo="Posologia (como usar)"
                valor={item.posologia}
                aoMudar={(v) => atualizar(i, "posologia", v)}
              />
              <CampoTexto
                className="sm:col-span-3"
                rotulo="Duração"
                valor={item.duracao}
                aoMudar={(v) => atualizar(i, "duracao", v)}
              />
              <CampoTexto
                className="sm:col-span-3"
                rotulo="Observação"
                valor={item.observacao}
                aoMudar={(v) => atualizar(i, "observacao", v)}
              />
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={item.controlado}
                onChange={(e) => atualizar(i, "controlado", e.target.checked)}
                className="h-4 w-4 rounded border-slate-400 text-red-700"
              />
              Medicamento de controle especial (tarja preta)
            </label>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={adicionar}
        className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-teal-600 hover:text-teal-800"
      >
        + Adicionar medicamento
      </button>

      <div className="mt-6">
        <label htmlFor="orientacoes" className="text-sm font-medium text-slate-700">
          Orientações gerais <span className="font-normal text-slate-400">(opcional)</span>
        </label>
        <textarea
          id="orientacoes"
          rows={3}
          value={orientacoes}
          onChange={(e) => setOrientacoes(e.target.value)}
          placeholder="Ex.: retornar em 15 dias; procurar pronto-atendimento se febre alta."
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
        />
      </div>

      {jaAssinada && (
        <div className="mt-4">
          <label htmlFor="motivo" className="text-sm font-medium text-slate-700">
            Motivo da retificação
          </label>
          <input
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Esta receita já foi assinada — descreva o que muda e por quê."
            className="mt-1 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm focus:border-amber-600 focus:ring-1 focus:ring-amber-600"
          />
        </div>
      )}

      {erro && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={assinar}
          disabled={enviando}
          className="rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
        >
          {enviando
            ? "Assinando…"
            : jaAssinada
              ? "Assinar retificação"
              : "Assinar receita"}
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
        Ao assinar, a receita fica imutável e recebe seu CRM. Uma correção
        posterior cria nova versão; a anterior permanece registrada.
      </p>
    </div>
  );
}

function CampoTexto({
  rotulo,
  valor,
  aoMudar,
  className = "",
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-slate-500">{rotulo}</span>
      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
      />
    </label>
  );
}
