"use client";

/**
 * Preferências de custo da médica: modelo da nota e modo do assistente.
 *
 * As duas escolhas são apresentadas com o efeito no custo explícito — o ponto
 * da tela é ela decidir o gasto por consulta com clareza, não escondê-lo.
 */

import { useState } from "react";
import {
  MODELOS_NOTA,
  MODOS_ASSISTENTE,
  ROTULO_MODELO,
  ROTULO_MODO,
  type ModeloNota,
  type ModoAssistente,
} from "@/lib/config-medica";

interface Props {
  inicial: {
    modeloNota: string;
    modoAssistente: string;
    valorTeleconsultaCent: number;
    valorPresencialCent: number;
  };
}

/** Centavos → string de reais para o input (ex.: 30000 → "300.00"). */
function centParaReais(cent: number): string {
  return (cent / 100).toFixed(2);
}

/** String de reais do input → centavos inteiros. Vírgula ou ponto; NaN → 0. */
function reaisParaCent(valor: string): number {
  const n = Number.parseFloat(valor.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

export function FormularioConfiguracoes({ inicial }: Props) {
  const [modeloNota, setModeloNota] = useState<ModeloNota>(
    (inicial.modeloNota as ModeloNota) ?? "OPUS",
  );
  const [modoAssistente, setModoAssistente] = useState<ModoAssistente>(
    (inicial.modoAssistente as ModoAssistente) ?? "SEMPRE",
  );
  const [valorTele, setValorTele] = useState(centParaReais(inicial.valorTeleconsultaCent));
  const [valorPres, setValorPres] = useState(centParaReais(inicial.valorPresencialCent));
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      const r = await fetch("/api/medica/configuracoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modeloNota,
          modoAssistente,
          valorTeleconsultaCent: reaisParaCent(valorTele),
          valorPresencialCent: reaisParaCent(valorPres),
        }),
      });
      if (!r.ok) {
        setErro("Não foi possível salvar.");
        return;
      }
      // Normaliza o que a tela mostra pelo que o servidor guardou (centavos).
      const salvoDados = await r.json().catch(() => null);
      if (salvoDados) {
        setValorTele(centParaReais(salvoDados.valorTeleconsultaCent));
        setValorPres(centParaReais(salvoDados.valorPresencialCent));
      }
      setSalvo(true);
    } catch {
      setErro("Falha de conexão.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-serif text-lg text-slate-900">
          Assistente de anotação
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          A transcrição do áudio é o item mais caro por consulta (cobrada por
          minuto). Este é o ajuste que mais mexe no custo.
        </p>
        <div className="mt-4 space-y-2">
          {MODOS_ASSISTENTE.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${
                modoAssistente === m
                  ? "border-teal-500 bg-teal-50/50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="modo"
                checked={modoAssistente === m}
                onChange={() => {
                  setModoAssistente(m);
                  setSalvo(false);
                }}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-slate-900">
                  {ROTULO_MODO[m].nome}
                </span>
                <span className="mt-0.5 block text-slate-600">
                  {ROTULO_MODO[m].descricao}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-lg text-slate-900">
          Modelo que redige o rascunho
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Só se aplica quando o assistente gera o rascunho. A revisão e a
          assinatura são sempre suas — o modelo apenas organiza o que foi dito.
        </p>
        <div className="mt-4 space-y-2">
          {MODELOS_NOTA.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${
                modeloNota === m
                  ? "border-teal-500 bg-teal-50/50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="modelo"
                checked={modeloNota === m}
                onChange={() => {
                  setModeloNota(m);
                  setSalvo(false);
                }}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-slate-900">
                  {ROTULO_MODELO[m].nome}
                </span>
                <span className="mt-0.5 block text-slate-600">
                  {ROTULO_MODELO[m].descricao}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-lg text-slate-900">Valor da consulta</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          É o valor cobrado por Pix no agendamento. A consulta só é confirmada
          após o pagamento. Deixe zero para não cobrar naquela modalidade.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <CampoPreco
            rotulo="Teleconsulta"
            valor={valorTele}
            onChange={(v) => {
              setValorTele(v);
              setSalvo(false);
            }}
          />
          <CampoPreco
            rotulo="Presencial"
            valor={valorPres}
            onChange={(v) => {
              setValorPres(v);
              setSalvo(false);
            }}
          />
        </div>
      </section>

      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar preferências"}
        </button>
        {salvo && <span className="text-sm text-teal-700">Salvo ✓</span>}
      </div>
    </div>
  );
}

function CampoPreco({
  rotulo,
  valor,
  onChange,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{rotulo}</span>
      <div className="mt-1 flex items-center rounded-lg border border-slate-300 focus-within:border-teal-700 focus-within:ring-1 focus-within:ring-teal-700">
        <span className="pl-3 text-sm text-slate-500">R$</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg bg-transparent px-2 py-2 text-sm focus:outline-none"
        />
      </div>
    </label>
  );
}
