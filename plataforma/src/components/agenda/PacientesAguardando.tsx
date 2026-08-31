"use client";

/**
 * Aviso de paciente esperando na sala.
 *
 * Fica no topo da agenda, e não como selo dentro da linha da consulta, porque
 * é a informação mais urgente da tela: alguém está do outro lado, agora,
 * olhando para "aguardando a médica". Um indicador discreto no meio de uma
 * lista é fácil de não ver — e o custo de não ver é um paciente desistindo.
 *
 * Atualiza sozinho a cada 15s. Não é tempo real, e não precisa ser: a diferença
 * entre saber na hora e saber em 15 segundos não muda nada, e um WebSocket
 * aberto o dia inteiro na agenda seria peso sem retorno.
 */

import { useEffect, useState } from "react";

interface Aguardando {
  consultaId: string;
  paciente: string;
  inicioEm: string;
  desde: string | null;
  medicaPresente: boolean;
}

const INTERVALO_MS = 15_000;

export function PacientesAguardando() {
  const [lista, setLista] = useState<Aguardando[]>([]);

  useEffect(() => {
    let ativo = true;

    const buscar = async () => {
      try {
        const r = await fetch("/api/agenda/presenca", { cache: "no-store" });
        if (!r.ok) return;
        const dados = await r.json();
        if (ativo) setLista(dados.aguardando ?? []);
      } catch {
        // Rede oscilou. Mantém o que já estava na tela e tenta de novo.
      }
    };

    void buscar();
    const t = setInterval(buscar, INTERVALO_MS);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, []);

  // Quem a médica já está atendendo não é "esperando".
  const esperando = lista.filter((a) => !a.medicaPresente);
  if (esperando.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      {esperando.map((a) => (
        <div
          key={a.consultaId}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-600 opacity-70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-700" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-medium text-teal-950">
              {a.paciente} está na sala
            </p>
            <p className="text-sm text-teal-800">{esperaDesde(a.desde)}</p>
          </div>

          <a
            href={`/atendimento/${a.consultaId}`}
            className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Entrar na sala
          </a>
        </div>
      ))}
    </div>
  );
}

/**
 * Tempo de espera em texto.
 *
 * Calculado no cliente de propósito: o relógio do servidor e o do navegador
 * podem divergir, e "aguardando há -2 minutos" numa tela clínica destrói a
 * confiança no resto dos números.
 */
function esperaDesde(desde: string | null): string {
  if (!desde) return "Aguardando você";

  const minutos = Math.floor((Date.now() - new Date(desde).getTime()) / 60_000);
  if (minutos < 1) return "Entrou agora";
  if (minutos === 1) return "Aguardando há 1 minuto";
  if (minutos < 60) return `Aguardando há ${minutos} minutos`;

  const horas = Math.floor(minutos / 60);
  return `Aguardando há ${horas}h${String(minutos % 60).padStart(2, "0")}`;
}
