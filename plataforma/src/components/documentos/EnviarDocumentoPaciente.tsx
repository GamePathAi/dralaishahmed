"use client";

/**
 * Botão "Enviar ao paciente" — disponibiliza o documento assinado por e-mail,
 * com link para a área do paciente. Aparece na tela do documento já assinado
 * (receita/atestado/exames), ao lado de "Imprimir".
 *
 * Sem estado persistido de "enviado" (não há coluna para isso, e o rastro fica
 * na auditoria): o selo de sucesso é só da sessão atual.
 */

import { useState } from "react";

interface Props {
  tipo: "receita" | "atestado" | "exames";
  id: string;
}

function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Campo_Grande",
  });
}

export function EnviarDocumentoPaciente({ tipo, id }: Props) {
  const [enviadoEm, setEnviadoEm] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/documentos/${tipo}/${id}/enviar`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.erro ?? "Não foi possível enviar.");
        return;
      }
      setEnviadoEm(d.enviadoEm);
    } catch {
      setErro("Falha de conexão.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => void enviar()}
        disabled={enviando}
        title="Enviar ao paciente por e-mail, com link para ver o documento"
        className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
          enviadoEm
            ? "border border-slate-300 text-slate-700 hover:bg-slate-50"
            : "border border-teal-700 text-teal-800 hover:bg-teal-50"
        }`}
      >
        {enviando ? "Enviando…" : enviadoEm ? "Reenviar ao paciente" : "Enviar ao paciente"}
      </button>
      {erro ? (
        <span className="text-xs text-red-700">{erro}</span>
      ) : enviadoEm ? (
        <span className="text-xs text-teal-700">enviado {horaCurta(enviadoEm)}</span>
      ) : null}
    </span>
  );
}
