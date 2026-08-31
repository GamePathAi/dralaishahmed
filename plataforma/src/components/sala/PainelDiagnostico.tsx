"use client";

/**
 * Diagnóstico da sala, visível só para a médica.
 *
 * Existe porque "não estou ouvindo" e "ele não me vê" são sintomas que apontam
 * para meia dúzia de causas diferentes — faixa não publicada, faixa não
 * assinada, dispositivo bloqueado, câmera desligada por engano no botão — e
 * nenhuma delas aparece na tela. Sem isto, cada problema custava uma rodada de
 * tentativa e erro com o console do navegador de outra pessoa.
 *
 * Mostra o estado de cada faixa, dos dois lados, em tempo real. Fica recolhido
 * por padrão: numa consulta de verdade a médica não quer isso na frente.
 */

import { useState } from "react";
import type { DailyTrackState } from "@daily-co/daily-js";

interface Props {
  participantes: number;
  videoLocal: DailyTrackState;
  audioLocal: DailyTrackState;
  videoRemoto: DailyTrackState;
  audioRemoto: DailyTrackState;
  micLigado: boolean;
  camLigada: boolean;
  estadoGravacao: string;
  bytesGravados: number;
}

/** `state` do daily-react: playable, loading, off, interrupted, blocked, sendable */
function Faixa({ rotulo, faixa }: { rotulo: string; faixa: DailyTrackState }) {
  const estado = faixa?.state ?? "—";
  const bom = estado === "playable" || estado === "sendable";
  const explicacao: Record<string, string> = {
    playable: "funcionando",
    sendable: "enviando",
    loading: "negociando…",
    off: "desligada",
    blocked: "bloqueada pelo navegador",
    interrupted: "conexão interrompida",
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{rotulo}</span>
      <span className={bom ? "text-teal-300" : "text-amber-300"}>
        {estado}
        <span className="ml-1 text-slate-500">
          {explicacao[estado] ? `(${explicacao[estado]})` : ""}
        </span>
      </span>
    </div>
  );
}

export function PainelDiagnostico(p: Props) {
  const [aberto, setAberto] = useState(false);

  // Um problema que a médica precisa ver sem abrir nada.
  const alerta =
    p.participantes === 0
      ? "o outro participante ainda não entrou"
      : p.audioRemoto?.state === "blocked"
        ? "o navegador bloqueou o áudio — clique na página"
        : p.videoLocal?.state === "off"
          ? "sua câmera está desligada"
          : null;

  return (
    <div className="rounded-lg bg-slate-900/85 text-xs backdrop-blur">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-slate-300 hover:text-white"
      >
        <span className={alerta ? "text-amber-300" : "text-teal-300"}>
          {alerta ? "▲" : "●"}
        </span>
        <span>{alerta ?? "Conexão normal"}</span>
        <span className="ml-auto text-slate-500">{aberto ? "fechar" : "detalhes"}</span>
      </button>

      {aberto && (
        <div className="space-y-1 border-t border-white/10 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-400">participantes remotos</span>
            <span className={p.participantes > 0 ? "text-teal-300" : "text-amber-300"}>
              {p.participantes}
            </span>
          </div>

          <Faixa rotulo="minha câmera" faixa={p.videoLocal} />
          <Faixa rotulo="meu microfone" faixa={p.audioLocal} />
          <Faixa rotulo="câmera do outro" faixa={p.videoRemoto} />
          <Faixa rotulo="áudio do outro" faixa={p.audioRemoto} />

          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-1">
            <span className="text-slate-400">botões</span>
            <span className="text-slate-300">
              mic {p.micLigado ? "ligado" : "MUDO"} · cam{" "}
              {p.camLigada ? "ligada" : "DESLIGADA"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-400">gravação</span>
            <span className="text-slate-300">
              {p.estadoGravacao} · {(p.bytesGravados / 1024).toFixed(0)} KB
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
