"use client";

/**
 * Porta de entrada da teleconsulta — pede o token e trata cada resposta.
 *
 * Componente compartilhado entre paciente e médica. A rota de sala já decide o
 * papel de quem pediu, então não há duas telas para manter em sincronia.
 *
 * O trabalho real aqui é o tratamento de estados. Uma tela de videochamada que
 * mostra só "erro ao conectar" é inútil para quem está do outro lado: a pessoa
 * não sabe se chegou cedo, se errou o link, ou se deve ligar para a clínica.
 * Cada código da API vira uma mensagem que diz o que fazer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SalaTeleconsulta } from "./SalaTeleconsulta";

interface Acesso {
  salaUrl: string;
  token: string;
  papel: "MEDICA" | "PACIENTE";
  nomePaciente: string;
  crmMedica: string;
  modoAssistente: "SEMPRE" | "MANUAL" | "DESLIGADO";
}

type Estado =
  | { tipo: "carregando" }
  | { tipo: "pronto"; acesso: Acesso }
  | { tipo: "cedo"; abreEm: Date; inicioEm: Date }
  | { tipo: "erro"; mensagem: string; podeReTentar: boolean };

export function EntradaSala({ consultaId }: { consultaId: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const tentativas = useRef(0);

  const pedirAcesso = useCallback(async () => {
    try {
      const resposta = await fetch(`/api/consultas/${consultaId}/sala`, {
        method: "POST",
      });
      const dados = await resposta.json();

      if (resposta.ok) {
        tentativas.current = 0;
        setEstado({ tipo: "pronto", acesso: dados });
        return;
      }

      switch (dados.codigo) {
        case "SALA_AINDA_FECHADA":
          setEstado({
            tipo: "cedo",
            abreEm: new Date(dados.abreEm),
            inicioEm: new Date(dados.inicioEm),
          });
          return;

        case "SALA_EXPIRADA":
        case "CONSULTA_ENCERRADA":
        case "CONSULTA_CANCELADA":
        case "SEM_SALA":
          setEstado({ tipo: "erro", mensagem: dados.erro, podeReTentar: false });
          return;

        default:
          // Falha da Daily ou de rede: vale tentar de novo, mas com teto.
          // Repetir indefinidamente só queima bateria e API.
          tentativas.current += 1;
          setEstado({
            tipo: "erro",
            mensagem: dados.erro ?? "Não foi possível abrir a sala.",
            podeReTentar: tentativas.current < 3,
          });
      }
    } catch {
      tentativas.current += 1;
      setEstado({
        tipo: "erro",
        mensagem:
          "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
        podeReTentar: tentativas.current < 3,
      });
    }
  }, [consultaId]);

  useEffect(() => {
    void pedirAcesso();
  }, [pedirAcesso]);

  // Chegou cedo: quando a sala abrir, entra sozinho. Ninguém deveria precisar
  // ficar apertando F5 esperando a hora da consulta.
  useEffect(() => {
    if (estado.tipo !== "cedo") return;
    const faltam = estado.abreEm.getTime() - Date.now();
    if (faltam <= 0) {
      void pedirAcesso();
      return;
    }
    const t = setTimeout(() => void pedirAcesso(), faltam + 1000);
    return () => clearTimeout(t);
  }, [estado, pedirAcesso]);

  if (estado.tipo === "pronto") {
    return (
      <SalaTeleconsulta
        consultaId={consultaId}
        salaUrl={estado.acesso.salaUrl}
        token={estado.acesso.token}
        papel={estado.acesso.papel}
        nomePaciente={estado.acesso.nomePaciente}
        crmMedica={estado.acesso.crmMedica}
        modoAssistente={estado.acesso.modoAssistente ?? "SEMPRE"}
      />
    );
  }

  if (estado.tipo === "carregando") {
    return (
      <Painel>
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-teal-400" />
        <p className="text-sm text-slate-300">Preparando a sala…</p>
      </Painel>
    );
  }

  if (estado.tipo === "cedo") {
    return (
      <Painel>
        <ContagemRegressiva ate={estado.abreEm} />
        <h1 className="mt-5 font-serif text-xl text-white">
          A sala abre em instantes
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Sua consulta está marcada para{" "}
          <strong className="text-slate-200">
            {estado.inicioEm.toLocaleString("pt-BR", {
              day: "2-digit",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </strong>
          . A entrada libera 15 minutos antes — você será conectado
          automaticamente, sem precisar recarregar a página.
        </p>
      </Painel>
    );
  }

  return (
    <Painel>
      <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-red-900/40 text-xl">
        ⚠
      </div>
      <h1 className="font-serif text-xl text-white">Não foi possível entrar</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        {estado.mensagem}
      </p>

      {estado.podeReTentar && (
        <button
          onClick={() => {
            setEstado({ tipo: "carregando" });
            void pedirAcesso();
          }}
          className="mt-5 rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Tentar novamente
        </button>
      )}

      {/* Saída sempre disponível. Uma teleconsulta que não abre não pode virar
          um beco sem saída — a pessoa precisa de um caminho para ser atendida. */}
      <p className="mt-6 border-t border-slate-800 pt-5 text-xs leading-relaxed text-slate-500">
        Se o problema continuar, entre em contato pelo WhatsApp{" "}
        <a
          href="https://wa.me/5567991873948"
          target="_blank"
          rel="noopener"
          className="text-teal-400 underline underline-offset-2"
        >
          (67) 99187-3948
        </a>
        .<br />
        Em urgência, procure o serviço de saúde mais próximo ou ligue 192.
      </p>
    </Painel>
  );
}

// ------------------------------------------------------------- auxiliares

function Painel({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-950 px-6">
      <div className="max-w-sm text-center">{children}</div>
    </div>
  );
}

function ContagemRegressiva({ ate }: { ate: Date }) {
  const [restante, setRestante] = useState(() => ate.getTime() - Date.now());

  useEffect(() => {
    const i = setInterval(() => setRestante(ate.getTime() - Date.now()), 1000);
    return () => clearInterval(i);
  }, [ate]);

  const total = Math.max(0, Math.floor(restante / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return (
    <p className="font-mono text-3xl tabular-nums text-teal-300">
      {h > 0 && `${String(h).padStart(2, "0")}:`}
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </p>
  );
}
