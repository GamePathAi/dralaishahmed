"use client";

/**
 * Editor de atestado. A médica escolhe um modelo (o texto vem preenchido),
 * ajusta dias/data e o texto, e assina. Assinatura é ato explícito e imutável —
 * corrigir depois retifica (nova versão). CID só se ela digitar (CFM).
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MODELOS_ATESTADO,
  textoDoModelo,
  type TipoAtestado,
} from "@/lib/documentos/modelos-atestado";

interface Props {
  atestadoId: string;
  nomePaciente: string;
  jaAssinada: boolean;
  iniciais: {
    tipo: TipoAtestado;
    diasAfastamento: number | null;
    cid: string;
    dataInicio: string; // yyyy-mm-dd
    textoLivre: string;
  };
}

const CAMPO =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700";

export function EditorAtestado({ atestadoId, nomePaciente, jaAssinada, iniciais }: Props) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoAtestado>(iniciais.tipo);
  const [dias, setDias] = useState<string>(iniciais.diasAfastamento ? String(iniciais.diasAfastamento) : "");
  const [cid, setCid] = useState(iniciais.cid);
  const [dataInicio, setDataInicio] = useState(iniciais.dataInicio);
  const [texto, setTexto] = useState(iniciais.textoLivre);
  const [textoTocado, setTextoTocado] = useState(iniciais.textoLivre.trim().length > 0);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const comDias = tipo === "AFASTAMENTO" || tipo === "REPOUSO";

  // Escolher um modelo preenche tipo + dias + texto (enquanto não foi editado à mão).
  const escolherModelo = (chave: string) => {
    const m = MODELOS_ATESTADO.find((x) => x.chave === chave);
    if (!m) return;
    setTipo(m.tipo);
    const d = m.diasPadrao ?? undefined;
    setDias(d ? String(d) : "");
    setTexto(textoDoModelo(m.tipo, { nome: nomePaciente, dias: d }));
    setTextoTocado(false);
  };

  // Mudar os dias regenera o texto SÓ se ela ainda não o editou à mão.
  const mudarDias = (v: string) => {
    setDias(v);
    if (!textoTocado) {
      const n = Number.parseInt(v, 10);
      setTexto(textoDoModelo(tipo, { nome: nomePaciente, dias: Number.isFinite(n) ? n : undefined }));
    }
  };

  const assinar = async () => {
    setErro(null);
    if (!texto.trim()) return setErro("Escreva o texto do atestado (ou escolha um modelo).");
    if (comDias && (!dias || Number.parseInt(dias, 10) < 1)) return setErro("Informe a quantidade de dias.");
    if (jaAssinada && motivo.trim().length < 10) return setErro("Descreva o motivo da retificação (mín. 10 caracteres).");

    setEnviando(true);
    try {
      const r = await fetch(`/api/atestado/${atestadoId}/assinar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          diasAfastamento: comDias ? Number.parseInt(dias, 10) : null,
          cid: cid.trim() || null,
          dataInicio,
          textoLivre: texto.trim(),
          ...(jaAssinada ? { motivoRetificacao: motivo.trim() } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(d.erro ?? "Não foi possível assinar o atestado.");
      router.push(`/atestado/${d.atestadoId}/imprimir`);
    } catch {
      setErro("Sem conexão para assinar. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-serif text-2xl text-slate-900">Atestado — {nomePaciente}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Escolha um modelo, ajuste e assine. Nada vale antes de você assinar.
      </p>

      {/* Modelos prontos */}
      <div className="mt-5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Modelo</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {MODELOS_ATESTADO.map((m) => (
            <button
              key={m.chave}
              type="button"
              onClick={() => escolherModelo(m.chave)}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                tipo === m.tipo
                  ? "border-teal-700 bg-teal-50 font-medium text-teal-900"
                  : "border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              {m.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          Data
          <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className={CAMPO} />
        </label>
        {comDias && (
          <label className="block text-sm font-medium text-slate-700">
            Dias
            <input
              type="number"
              min={1}
              max={365}
              value={dias}
              onChange={(e) => mudarDias(e.target.value)}
              className={CAMPO}
            />
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          CID <span className="font-normal text-slate-400">(opcional)</span>
          <input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="ex.: J06" className={CAMPO} />
        </label>
      </div>

      {cid.trim() && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Incluir o CID (diagnóstico) no atestado exige o <strong>consentimento do paciente</strong> (CFM).
          Só preencha se ele autorizou.
        </p>
      )}

      <div className="mt-5">
        <label htmlFor="texto" className="text-sm font-medium text-slate-700">Texto do atestado</label>
        <textarea
          id="texto"
          rows={6}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setTextoTocado(true);
          }}
          placeholder="Escolha um modelo acima ou escreva aqui."
          className={CAMPO}
        />
      </div>

      {jaAssinada && (
        <div className="mt-4">
          <label htmlFor="motivo" className="text-sm font-medium text-slate-700">Motivo da retificação</label>
          <input
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Este atestado já foi assinado — descreva o que muda e por quê."
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
          {enviando ? "Assinando…" : jaAssinada ? "Assinar retificação" : "Assinar atestado"}
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
        Ao assinar, o atestado fica imutável e recebe seu CRM. Uma correção posterior cria nova
        versão; a anterior permanece registrada.
      </p>
    </div>
  );
}
