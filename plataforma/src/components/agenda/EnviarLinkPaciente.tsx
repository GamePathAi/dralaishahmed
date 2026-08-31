"use client";

/**
 * Botão "Enviar link" na linha da agenda (só teleconsulta).
 *
 * O cron manda o link automaticamente ~15 min antes; este botão é o controle
 * na mão da médica — reenviar quando o paciente não recebeu, ou adiantar. O
 * selo mostra se e quando o link já saiu, para ela não ficar na dúvida.
 */

import { useState } from "react";

interface Props {
  consultaId: string;
  /** ISO do último envio, ou null se nunca enviado. */
  enviadoEmInicial: string | null;
}

function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Campo_Grande",
  });
}

export function EnviarLinkPaciente({ consultaId, enviadoEmInicial }: Props) {
  const [enviadoEm, setEnviadoEm] = useState<string | null>(enviadoEmInicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/consultas/${consultaId}/enviar-link`, {
        method: "POST",
      });
      const d = await r.json();
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
        onClick={enviar}
        disabled={enviando}
        title="Enviar ao paciente o link de acesso à sala"
        className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
          enviadoEm
            ? "border border-slate-300 text-slate-700 hover:bg-slate-50"
            : "bg-teal-700 text-white hover:bg-teal-800"
        }`}
      >
        {enviando
          ? "Enviando…"
          : enviadoEm
            ? "Reenviar link"
            : "Enviar link"}
      </button>
      {erro ? (
        <span className="text-xs text-red-700">{erro}</span>
      ) : enviadoEm ? (
        <span className="text-xs text-teal-700">
          link enviado {horaCurta(enviadoEm)}
        </span>
      ) : null}
    </span>
  );
}
