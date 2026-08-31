"use client";

/**
 * Tela de consentimento — a primeira barreira do sistema.
 *
 * Três coisas que parecem detalhe de UI e são exigência legal:
 *
 *   1. Nenhum botão vem pré-selecionado. Consentimento LGPD para dado sensível
 *      precisa ser inequívoco (art. 11, I) — um "aceitar" default não é aceite.
 *   2. Recusar é tão fácil quanto aceitar, e não custa nada ao paciente. Se
 *      recusar significasse "não pode consultar", o consentimento seria coagido
 *      e portanto inválido.
 *   3. O texto exato exibido é enviado ao servidor junto do aceite. Se o texto
 *      mudar no futuro, a prova continua sendo o que este paciente leu.
 */

import { useEffect, useState } from "react";
import {
  TEXTO_CONSENTIMENTO,
  VERSAO_TEXTO_CONSENTIMENTO,
} from "@/lib/consentimento-texto";

interface Props {
  consultaId: string;
  papel: "MEDICA" | "PACIENTE";
  aoResponder: (aceito: boolean) => void;
}

export function ConsentimentoGravacao({ consultaId, papel, aoResponder }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * A médica aguarda — mas precisa ser avisada quando a resposta chegar.
   *
   * Antes esta tela era um spinner permanente: o paciente autorizava e ela
   * continuava esperando, sem nenhum sinal. A única saída visível era
   * "prosseguir sem o assistente", que descartava o aceite recém-dado.
   */
  useEffect(() => {
    if (papel !== "MEDICA") return;
    let ativo = true;

    const conferir = async () => {
      try {
        const r = await fetch(`/api/consultas/${consultaId}/consentimento`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const d = await r.json();
        if (ativo && d.respondido) aoResponder(d.aceito === true);
      } catch {
        // Oscilação de rede: tenta de novo no próximo ciclo.
      }
    };

    void conferir();
    const t = setInterval(conferir, 3000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [papel, consultaId, aoResponder]);

  // A médica não decide pelo paciente. Ela apenas aguarda a resposta dele.
  if (papel === "MEDICA") {
    return (
      <div className="grid h-dvh place-items-center bg-slate-950 px-6">
        <div className="max-w-md text-center text-slate-300">
          <div className="mx-auto mb-5 h-12 w-12 animate-pulse rounded-full bg-slate-800" />
          <h1 className="font-serif text-xl text-white">
            Aguardando o paciente
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            O paciente está decidindo sobre o uso do assistente de anotação.
            A consulta pode ocorrer normalmente em qualquer um dos casos.
          </p>
          <button
            onClick={() => aoResponder(false)}
            className="mt-6 text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200"
          >
            Prosseguir sem o assistente
          </button>
        </div>
      </div>
    );
  }

  const responder = async (aceito: boolean) => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/consultas/${consultaId}/consentimento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aceito,
          textoApresentado: TEXTO_CONSENTIMENTO,
          versaoTexto: VERSAO_TEXTO_CONSENTIMENTO,
        }),
      });
      if (!r.ok) throw new Error();
      aoResponder(aceito);
    } catch {
      // Falha ao registrar o aceite não pode virar "assume que aceitou".
      setErro(
        "Não foi possível registrar sua resposta. A consulta seguirá sem o assistente.",
      );
      setTimeout(() => aoResponder(false), 2500);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-lg sm:p-8">
        <h1 className="font-serif text-2xl text-slate-900">
          Antes de começarmos
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Uma escolha sua, que leva um minuto.
        </p>

        <div className="mt-5 max-h-72 overflow-y-auto whitespace-pre-line rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          {TEXTO_CONSENTIMENTO}
        </div>

        {erro && <p className="mt-4 text-sm text-red-700">{erro}</p>}

        {/* Sem opção pré-marcada, e os dois caminhos têm o mesmo peso visual. */}
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row-reverse">
          <button
            onClick={() => responder(true)}
            disabled={enviando}
            className="flex-1 rounded-xl bg-teal-800 px-5 py-3.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
          >
            Autorizo o assistente de anotação
          </button>
          <button
            onClick={() => responder(false)}
            disabled={enviando}
            className="flex-1 rounded-xl border border-slate-300 px-5 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Prefiro não autorizar
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Sua consulta acontece normalmente nos dois casos.
        </p>
      </div>
    </div>
  );
}
