"use client";

/**
 * Selo de "assistente registrando".
 *
 * Precisa ser renderizado na tela dos DOIS participantes, não só na da médica.
 * Gravação sem sinalização visível ao gravado é o tipo de coisa que transforma
 * um recurso útil em problema ético — e a regra do CFM sobre gravação de
 * teleconsulta pressupõe ciência contínua, não um aceite no início esquecido
 * quarenta minutos depois.
 *
 * Por isso o componente é discreto mas nunca some, e nunca é condicionado a
 * `papel === "MEDICA"`.
 */

import type { EstadoGravacao } from "./useGravadorConsulta";

interface Props {
  estado: EstadoGravacao;
  duracaoSeg: number;
  /** Volume instantâneo (0–1). Só a médica vê — é ferramenta dela. */
  nivel?: number;
  /** Bytes já capturados. Zero com o cronômetro andando = áudio mudo. */
  bytes?: number;
  /** O selo é para os dois; o medidor, só para quem opera. */
  detalhado?: boolean;
}

function formatarDuracao(s: number) {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function IndicadorEscuta({
  estado,
  duracaoSeg,
  nivel = 0,
  bytes = 0,
  detalhado = false,
}: Props) {
  if (estado === "ocioso") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-slate-800/70 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
        <span className="h-2 w-2 rounded-full bg-slate-500" />
        Assistente de anotação inativo
      </div>
    );
  }

  if (estado === "erro") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-red-900/80 px-3 py-1.5 text-xs text-red-100 backdrop-blur">
        <span className="h-2 w-2 rounded-full bg-red-400" />
        Falha no assistente — a consulta segue normalmente
      </div>
    );
  }

  if (estado === "finalizando") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-teal-900/80 px-3 py-1.5 text-xs text-teal-100 backdrop-blur">
        <span className="h-2 w-2 animate-pulse rounded-full bg-teal-300" />
        Finalizando registro…
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-full bg-teal-900/85 px-3 py-1.5 text-xs text-teal-50 backdrop-blur"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-300 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-300" />
      </span>
      <span>Assistente registrando</span>
      <span className="font-mono tabular-nums opacity-70">
        {formatarDuracao(duracaoSeg)}
      </span>

      {/* Medidor de voz. Um rótulo estático não distingue "gravando" de
          "gravando silêncio" — e a diferença só apareceria no fim, quando a
          consulta já acabou. Barra que se mexe é prova de captura. */}
      {detalhado && (
        <>
          <span
            className="ml-1 flex h-3 items-end gap-0.5"
            aria-hidden="true"
            title="Volume captado"
          >
            {[0.15, 0.4, 0.65, 0.9].map((limite) => (
              <span
                key={limite}
                className={`w-1 rounded-sm transition-all duration-100 ${
                  nivel >= limite ? "bg-teal-200" : "bg-teal-100/25"
                }`}
                style={{ height: `${4 + limite * 8}px` }}
              />
            ))}
          </span>

          {/* Depois de 15s sem um único byte, não é timidez do paciente: é
              microfone mudo. Melhor avisar durante do que no fim. */}
          {duracaoSeg > 15 && bytes === 0 && (
            <span className="rounded-full bg-amber-300 px-2 py-0.5 font-medium text-amber-950">
              sem áudio
            </span>
          )}
        </>
      )}
    </div>
  );
}
