"use client";

/**
 * Painel de anotações da médica DURANTE a consulta (só ela vê). Colapsável, com
 * AUTOSAVE debounced (~1,5s) em `PUT /api/consultas/[id]/nota-sessao`. Vira fonte
 * de apoio ao registro pós-consulta. Fecha a sala → dá um flush do que faltou.
 */

import { useEffect, useRef, useState } from "react";

export function NotaSessaoMedica({ consultaId }: { consultaId: string }) {
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState("");
  const [estado, setEstado] = useState<"" | "salvando" | "salvo" | "erro">("");
  const carregou = useRef(false);
  const notaRef = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendente = useRef(false);

  // Carrega a nota existente na 1ª abertura (não sobrescreve com vazio).
  useEffect(() => {
    if (!aberto || carregou.current) return;
    carregou.current = true;
    fetch(`/api/consultas/${consultaId}/nota-sessao`)
      .then((r) => (r.ok ? r.json() : { nota: "" }))
      .then((d) => {
        setNota(d.nota ?? "");
        notaRef.current = d.nota ?? "";
      })
      .catch(() => {});
  }, [aberto, consultaId]);

  const salvar = (texto: string, keepalive = false) => {
    pendente.current = false;
    setEstado("salvando");
    fetch(`/api/consultas/${consultaId}/nota-sessao`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nota: texto }),
      keepalive,
    })
      .then((r) => setEstado(r.ok ? "salvo" : "erro"))
      .catch(() => setEstado("erro"));
  };

  const aoDigitar = (texto: string) => {
    setNota(texto);
    notaRef.current = texto;
    pendente.current = true;
    setEstado("salvando");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => salvar(texto), 1500);
  };

  // Ao desmontar (fechar a sala), garante o último trecho não salvo.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pendente.current) salvar(notaRef.current, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg bg-slate-900/80 px-3 py-2 text-sm font-medium text-white shadow-lg backdrop-blur hover:bg-slate-900"
      >
        📝 Anotações
      </button>
    );
  }

  const rotuloEstado =
    estado === "salvando" ? "salvando…" : estado === "salvo" ? "salvo ✓" : estado === "erro" ? "erro ao salvar" : "";

  return (
    <div className="w-72 rounded-xl border border-white/15 bg-slate-900/85 p-3 text-white shadow-lg backdrop-blur sm:w-80">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Minhas anotações</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-300">{rotuloEstado}</span>
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Fechar anotações"
            className="rounded px-1.5 text-slate-300 hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      </div>
      <textarea
        value={nota}
        onChange={(e) => aoDigitar(e.target.value)}
        placeholder="Anote durante a consulta… (salva sozinho)"
        rows={6}
        className="mt-2 w-full resize-none rounded-lg border border-white/15 bg-slate-950/50 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-teal-500 focus:outline-none"
      />
      <p className="mt-1 text-[11px] text-slate-400">Só você vê — vira apoio ao registro depois.</p>
    </div>
  );
}
