"use client";

/**
 * Bloqueios de agenda.
 *
 * O fluxo de conflito é o coração desta tela. Quando o período escolhido tem
 * paciente marcado, a API recusa e devolve a lista. A tela mostra **nome,
 * horário e telefone de cada um** antes de pedir confirmação — a médica precisa
 * ver de quem está falando para decidir se remarca ou se escolhe outra data.
 *
 * Um "isso vai cancelar 4 consultas, confirma?" sem os nomes empurra para o
 * clique automático. Com os nomes na tela, a decisão é informada.
 */

import { useEffect, useState } from "react";

interface Bloqueio {
  id: string;
  inicioEm: string;
  fimEm: string;
  motivo: string | null;
}

interface Conflito {
  id: string;
  inicioEm: string;
  modalidade: "TELECONSULTA" | "PRESENCIAL";
  paciente: string;
  telefone: string | null;
}

const formatar = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function GestaoBloqueios() {
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[] | null>(null);

  const [novo, setNovo] = useState({ inicio: "", fim: "", motivo: "" });

  const carregar = async () => {
    setCarregando(true);
    const r = await fetch("/api/agenda/bloqueios").then((x) => x.json());
    setBloqueios(r.bloqueios ?? []);
    setCarregando(false);
  };

  useEffect(() => {
    void carregar();
  }, []);

  const enviar = async (cancelarConflitos: boolean) => {
    setSalvando(true);
    setErro(null);

    const resposta = await fetch("/api/agenda/bloqueios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...novo, cancelarConflitos }),
    });
    const dados = await resposta.json();
    setSalvando(false);

    if (resposta.status === 409 && dados.codigo === "CONFLITO_CONSULTAS") {
      setConflitos(dados.conflitos);
      setErro(dados.erro);
      return;
    }
    if (!resposta.ok) {
      setErro(dados.erro ?? "Não foi possível criar o bloqueio.");
      return;
    }

    setConflitos(null);
    setErro(null);
    setAviso(dados.aviso ?? null);
    setNovo({ inicio: "", fim: "", motivo: "" });
    await carregar();
  };

  const remover = async (id: string) => {
    const dados = await fetch(`/api/agenda/bloqueios?id=${id}`, {
      method: "DELETE",
    }).then((r) => r.json());
    setAviso(dados.aviso ?? null);
    await carregar();
  };

  return (
    <div className="space-y-8">
      {/* ---- bloqueios ativos ---- */}
      <section>
        <h2 className="font-serif text-lg text-slate-900">Bloqueios ativos</h2>

        {aviso && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
            {aviso}
          </p>
        )}

        {carregando ? (
          <div className="mt-4 space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : bloqueios.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
            Nenhum bloqueio. A agenda segue a disponibilidade normal.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {bloqueios.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {formatar(b.inicioEm)} → {formatar(b.fimEm)}
                  </p>
                  {b.motivo && (
                    <p className="mt-0.5 text-sm text-slate-500">{b.motivo}</p>
                  )}
                </div>
                <button
                  onClick={() => void remover(b.id)}
                  className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- novo bloqueio ---- */}
      <section className="border-t border-slate-200 pt-8">
        <h2 className="font-serif text-lg text-slate-900">Novo bloqueio</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Início</span>
            <input
              type="datetime-local"
              value={novo.inicio}
              onChange={(e) => {
                setNovo({ ...novo, inicio: e.target.value });
                setConflitos(null);
              }}
              className={CAMPO}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Fim</span>
            <input
              type="datetime-local"
              value={novo.fim}
              onChange={(e) => {
                setNovo({ ...novo, fim: e.target.value });
                setConflitos(null);
              }}
              className={CAMPO}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">
              Motivo{" "}
              <span className="font-normal text-slate-400">(opcional, interno)</span>
            </span>
            <input
              type="text"
              maxLength={200}
              placeholder="Férias, congresso, plantão…"
              value={novo.motivo}
              onChange={(e) => setNovo({ ...novo, motivo: e.target.value })}
              className={CAMPO}
            />
          </label>
        </div>

        {erro && !conflitos && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {erro}
          </p>
        )}

        {/* ---- confirmação informada ---- */}
        {conflitos && (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <h3 className="text-sm font-semibold text-amber-900">
              {erro} Avise antes de confirmar.
            </h3>

            <ul className="mt-3 divide-y divide-amber-200 border-y border-amber-200">
              {conflitos.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-3 py-2 text-sm">
                  <span className="font-mono tabular-nums text-amber-900">
                    {formatar(c.inicioEm)}
                  </span>
                  <span className="font-medium text-amber-950">{c.paciente}</span>
                  {c.telefone && (
                    <a
                      href={`https://wa.me/55${c.telefone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener"
                      className="text-amber-800 underline underline-offset-2"
                    >
                      {c.telefone}
                    </a>
                  )}
                  <span className="text-amber-700">
                    {c.modalidade === "TELECONSULTA" ? "vídeo" : "presencial"}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-xs leading-relaxed text-amber-800">
              Confirmar cancela essas consultas e envia o aviso por e-mail a
              cada paciente. Quem não puder ser avisado aparece aqui depois,
              pelo nome, para você ligar. O motivo do bloqueio não vai no
              e-mail.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => void enviar(true)}
                disabled={salvando}
                className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {salvando
                  ? "Cancelando…"
                  : `Cancelar ${conflitos.length} e bloquear`}
              </button>
              <button
                onClick={() => {
                  setConflitos(null);
                  setErro(null);
                }}
                className="rounded-lg border border-amber-300 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
              >
                Escolher outra data
              </button>
            </div>
          </div>
        )}

        {!conflitos && (
          <button
            onClick={() => void enviar(false)}
            disabled={salvando || !novo.inicio || !novo.fim}
            className="mt-5 rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
          >
            {salvando ? "Verificando…" : "Criar bloqueio"}
          </button>
        )}
      </section>
    </div>
  );
}

const CAMPO =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700";
