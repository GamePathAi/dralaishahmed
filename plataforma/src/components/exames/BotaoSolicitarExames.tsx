"use client";

/**
 * Atalho "Solicitar exames" na tela de registro. Cria (ou reusa) um rascunho de
 * solicitação para a consulta e leva a médica ao editor.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BotaoSolicitarExames({ consultaId }: { consultaId: string }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);

  const gerar = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/exames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consultaId }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.id) {
        router.push(`/exames/${d.id}`);
        return;
      }
    } catch {
      /* mostra o botão de novo abaixo */
    }
    setCarregando(false);
  };

  return (
    <button
      type="button"
      onClick={() => void gerar()}
      disabled={carregando}
      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-800 disabled:opacity-50"
    >
      {carregando ? "Abrindo…" : "Solicitar exames"}
    </button>
  );
}
