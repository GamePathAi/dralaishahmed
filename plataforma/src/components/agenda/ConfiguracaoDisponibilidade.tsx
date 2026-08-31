"use client";

/**
 * Dashboard de disponibilidade da médica.
 *
 * Dois níveis, como nos apps profissionais de agenda:
 *
 *   1. Horário semanal (recorrente) — o padrão de toda semana. Ligue os dias
 *      que atende; cada janela mostra quantos encaixes gera ANTES de salvar,
 *      porque o intervalo entra na conta e ninguém faz essa aritmética de
 *      cabeça.
 *
 *   2. Calendário (por data) — o ajuste fino. Clique um dia para dar FOLGA
 *      (bloqueio de dia inteiro, com o mesmo tratamento de conflito/cancelamento
 *      dos bloqueios) ou abrir um HORÁRIO ESPECIAL que substitui o padrão só
 *      naquela data (um sábado extra, um plantão).
 *
 * O calendário resolve cada dia por uma chave "yyyy-MM-dd" no fuso da médica —
 * a MESMA chave que o servidor usa para casar disponibilidade especial e folga.
 */

import { useEffect, useMemo, useState } from "react";

type Modalidade = "TELECONSULTA" | "PRESENCIAL";

interface Janela {
  id: string;
  diaSemana: number;
  inicioMin: number;
  fimMin: number;
  modalidade: Modalidade;
  duracaoMin: number;
  intervaloMin: number;
}
interface Especial {
  id: string;
  data: string; // yyyy-MM-dd
  inicioMin: number;
  fimMin: number;
  modalidade: Modalidade;
  duracaoMin: number;
  intervaloMin: number;
}
interface Folga {
  id: string;
  data: string; // yyyy-MM-dd
}
interface Conflito {
  id: string;
  inicioEm: string;
  paciente: string;
}

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIAS_ABREV = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DOW_HEADER = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0]; // segunda → domingo
// Fuso da médica, repetido aqui porque o cliente não pode importar lib/agenda
// (puxa o Prisma). "Hoje" e o loop de 60 dias precisam ser no fuso da CLÍNICA,
// não no do navegador (a médica pode estar em MS ou SP), para casar as chaves
// de data com o servidor e não destacar o dia errado perto da meia-noite.
const FUSO_CLINICA = "America/Campo_Grande";
function hojeNaClinica(): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: FUSO_CLINICA }); // "yyyy-MM-dd"
  return new Date(`${s}T12:00:00`); // meio-dia local: os campos y/m/d são a data da clínica
}

// Espelha `ANTECEDENCIA_MINIMA_MIN` do servidor (lib/agenda.ts): o paciente só
// consegue agendar com pelo menos 2h de antecedência. Vagas dentro dessa janela
// são escondidas da grade — e a médica precisa saber disso ao abrir um especial.
const ANTECEDENCIA_MIN_MIN = 120;
// Campo Grande é UTC-4 e NÃO adota horário de verão, então o offset é fixo.
const OFFSET_CLINICA_MS = 4 * 60 * 60_000;
/** Instante (ms UTC) de um horário de parede da clínica numa data de calendário. */
function instanteDoSlot(dia: Date, minutos: number): number {
  return (
    Date.UTC(dia.getFullYear(), dia.getMonth(), dia.getDate(), Math.floor(minutos / 60), minutos % 60) +
    OFFSET_CLINICA_MS
  );
}
/** Quantos encaixes de uma janela caem DENTRO da antecedência (não agendáveis). */
function contarAgendaveis(
  dia: Date,
  j: { inicioMin: number; fimMin: number; duracaoMin: number; intervaloMin: number },
) {
  const passo = j.duracaoMin + j.intervaloMin;
  const limite = Date.now() + ANTECEDENCIA_MIN_MIN * 60_000;
  let total = 0,
    agendaveis = 0;
  for (let m = j.inicioMin; m + j.duracaoMin <= j.fimMin; m += passo) {
    total++;
    if (instanteDoSlot(dia, m) >= limite) agendaveis++;
  }
  return { total, agendaveis };
}

const paraHora = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const paraMin = (h: string) => {
  const [a = 0, b = 0] = h.split(":").map(Number);
  return a * 60 + b;
};
function contarEncaixes(j: { inicioMin: number; fimMin: number; duracaoMin: number; intervaloMin: number }) {
  const passo = j.duracaoMin + j.intervaloMin;
  let n = 0;
  for (let m = j.inicioMin; m + j.duracaoMin <= j.fimMin; m += passo) n++;
  return n;
}
const chaveDeData = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mesmaData = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const rotuloMod = (m: Modalidade) => (m === "TELECONSULTA" ? "Teleconsulta" : "Presencial");
/** Horas legíveis: 1 casa, sem `.0`, vírgula decimal. Evita float cru (4,1999…). */
const formatarHoras = (h: number) => {
  const r = Math.round(h * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
};

const CAMPO =
  "w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700";

export function ConfiguracaoDisponibilidade() {
  const [janelas, setJanelas] = useState<Janela[]>([]);
  const [datas, setDatas] = useState<Especial[]>([]);
  const [folgas, setFolgas] = useState<Folga[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const hoje = useMemo(() => hojeNaClinica(), []);
  const [view, setView] = useState(() => new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const [selDia, setSelDia] = useState<Date | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const r = await fetch("/api/agenda/disponibilidade").then((x) => x.json());
      setJanelas(r.janelas ?? []);
      setDatas(r.datas ?? []);
      setFolgas(r.folgas ?? []);
      setErro(null); // um erro transitório anterior não deve ficar preso na tela
    } catch {
      setErro("Não foi possível carregar sua disponibilidade.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    void carregar();
  }, []);

  // ---- resolução de um dia (mesma regra do servidor) --------------------
  function resolver(data: string, dow: number) {
    if (folgas.some((f) => f.data === data)) return { tipo: "off" as const, janelas: [] as Especial[] };
    const esp = datas.filter((d) => d.data === data);
    if (esp.length) return { tipo: "sp" as const, janelas: esp };
    const wk = janelas.filter((j) => j.diaSemana === dow);
    if (wk.length) return { tipo: "work" as const, janelas: wk };
    return { tipo: "off" as const, janelas: [] as Especial[] };
  }

  // ---- estatísticas ------------------------------------------------------
  const stats = useMemo(() => {
    let horas = 0, tele = 0, pres = 0;
    for (const j of janelas) {
      horas += (j.fimMin - j.inicioMin) / 60;
      const n = contarEncaixes(j);
      if (j.modalidade === "TELECONSULTA") tele += n;
      else pres += n;
    }
    let diasComAtendimento = 0;
    const d = new Date(hoje);
    for (let i = 0; i < 60; i++) {
      const r = resolver(chaveDeData(d), d.getDay());
      if (r.tipo !== "off") diasComAtendimento++;
      d.setDate(d.getDate() + 1);
    }
    return { horas, tele, pres, diasComAtendimento };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [janelas, datas, folgas, hoje]);

  // ---- HTTP helper: NÃO lança (erro de rede vira {ok:false}), para o
  //      `finally` de quem chama sempre soltar o `ocupado`. -----------------
  async function pedir(url: string, init?: RequestInit) {
    try {
      const r = await fetch(url, init);
      const dados = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, dados };
    } catch {
      return { ok: false, status: 0, dados: { erro: "Sem conexão. Tente de novo." } };
    }
  }
  function postDia(body: unknown) {
    return pedir("/api/agenda/dia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ---- grade semanal ----------------------------------------------------
  async function addJanela(campos: Omit<Janela, "id">) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await pedir("/api/agenda/disponibilidade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
      if (!r.ok) {
        setErro(r.dados.erro ?? "Não foi possível adicionar.");
        return false;
      }
      await carregar();
      return true;
    } finally {
      setOcupado(false);
    }
  }
  async function removerJanela(id: string) {
    setOcupado(true);
    try {
      await pedir(`/api/agenda/disponibilidade?id=${id}`, { method: "DELETE" });
      await carregar();
    } finally {
      setOcupado(false);
    }
  }
  // Desliga o dia inteiro numa chamada só — o servidor remove todas as janelas.
  async function desligarDia(dow: number) {
    setOcupado(true);
    try {
      await pedir(`/api/agenda/disponibilidade?diaSemana=${dow}`, { method: "DELETE" });
      await carregar();
    } finally {
      setOcupado(false);
    }
  }

  // ---- por data: UMA rota transacional; o cliente não orquestra nada -----
  async function salvarPadrao(data: string) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await postDia({ data, acao: "padrao" });
      if (!r.ok) setErro(r.dados.erro ?? "Não foi possível salvar.");
      else await carregar();
    } finally {
      setOcupado(false);
    }
  }
  async function salvarEspecial(data: string, campos: Omit<Especial, "id" | "data">) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await postDia({ data, acao: "especial", janela: campos });
      if (!r.ok) {
        setErro(r.dados.erro ?? "Não foi possível salvar o horário especial.");
        return false;
      }
      await carregar();
      return true;
    } finally {
      setOcupado(false);
    }
  }
  async function salvarFolga(data: string, cancelarConflitos: boolean) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await postDia({ data, acao: "folga", cancelarConflitos });
      if (r.ok) {
        await carregar();
        return { ok: true };
      }
      if (r.status === 409 && r.dados.codigo === "CONFLITO_CONSULTAS") {
        return { conflito: r.dados.conflitos as Conflito[] };
      }
      setErro(r.dados.erro ?? "Não foi possível marcar a folga.");
      return { erro: true };
    } finally {
      setOcupado(false);
    }
  }

  // ---- render ------------------------------------------------------------
  return (
    <div className="space-y-6">
      {erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>
      )}

      <ResumoStats stats={stats} carregando={carregando} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <GradeSemanal
          janelas={janelas}
          carregando={carregando}
          ocupado={ocupado}
          onAdd={addJanela}
          onRemover={removerJanela}
          onDesligar={desligarDia}
        />
        <Calendario
          view={view}
          setView={setView}
          hoje={hoje}
          selDia={selDia}
          onSelDia={setSelDia}
          resolver={resolver}
        />
      </div>

      <PainelDia
        dia={selDia}
        resolver={resolver}
        janelas={janelas}
        ocupado={ocupado}
        onPadrao={salvarPadrao}
        onEspecial={salvarEspecial}
        onFolga={salvarFolga}
      />

      <p className="border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <b className="text-slate-600">Como funciona.</b> O horário semanal é a base recorrente —
        configure uma vez e vale toda semana. No calendário você ajusta datas específicas: tirar
        uma <b className="text-slate-600">folga</b> ou abrir um <b className="text-slate-600">horário
        especial</b> só naquela data, sem mexer no padrão. Cada encaixe já desconta o intervalo entre
        consultas. Marcar folga num dia com consulta marcada pede sua confirmação e avisa o paciente
        por e-mail.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ stats
function ResumoStats({
  stats,
  carregando,
}: {
  stats: { horas: number; tele: number; pres: number; diasComAtendimento: number };
  carregando: boolean;
}) {
  const itens = [
    { k: "Horas por semana", v: carregando ? "—" : formatarHoras(stats.horas), e: "h", f: "no padrão atual" },
    { k: "Teleconsultas / semana", v: carregando ? "—" : stats.tele, e: "vagas", f: "encaixes oferecidos" },
    { k: "Presenciais / semana", v: carregando ? "—" : stats.pres, e: "vagas", f: "encaixes oferecidos" },
    { k: "Próximos 60 dias", v: carregando ? "—" : stats.diasComAtendimento, e: "dias", f: "com atendimento" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {itens.map((s) => (
        <div key={s.k} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.k}</div>
          <div className="mt-2 font-serif text-2xl text-slate-900">
            {s.v} <span className="text-sm font-sans text-slate-500">{s.e}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{s.f}</div>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------- grade semanal
function GradeSemanal({
  janelas,
  carregando,
  ocupado,
  onAdd,
  onRemover,
  onDesligar,
}: {
  janelas: Janela[];
  carregando: boolean;
  ocupado: boolean;
  onAdd: (c: Omit<Janela, "id">) => Promise<boolean>;
  onRemover: (id: string) => Promise<void>;
  onDesligar: (dow: number) => Promise<void>;
}) {
  const [abrindo, setAbrindo] = useState<number | null>(null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="font-serif text-lg text-slate-900">Horário semanal</h2>
        <p className="mt-1 text-sm text-slate-600">
          Seu padrão de toda semana. Ligue os dias que atende — o calendário é preenchido por ele.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {ORDEM_SEMANA.map((dow) => {
          const doDia = janelas.filter((j) => j.diaSemana === dow);
          const on = doDia.length > 0;
          return (
            <div key={dow} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Atender ${DIAS[dow]}`}
                  disabled={ocupado || carregando}
                  onClick={() => {
                    if (on) void onDesligar(dow);
                    else setAbrindo(abrindo === dow ? null : dow);
                  }}
                  className={`relative h-6 w-11 flex-none rounded-full transition ${
                    on ? "bg-teal-800" : "bg-slate-300"
                  } disabled:opacity-50`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      on ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
                <span className="w-9 flex-none text-sm font-semibold text-slate-800">
                  {DIAS_ABREV[dow]}
                </span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  {on ? (
                    doDia.map((j) => (
                      <span
                        key={j.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-teal-100 bg-teal-50 px-2 py-1 text-xs text-teal-900"
                      >
                        <span className="font-mono tabular-nums">
                          {paraHora(j.inicioMin)}–{paraHora(j.fimMin)}
                        </span>
                        <span className="text-teal-700/70">
                          {j.modalidade === "TELECONSULTA" ? "tele" : "pres"} · {contarEncaixes(j)}
                        </span>
                        <button
                          type="button"
                          aria-label="Remover janela"
                          disabled={ocupado}
                          onClick={() => void onRemover(j.id)}
                          className="ml-0.5 rounded text-teal-700/60 hover:text-red-700"
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-sm italic text-slate-400">Folga</span>
                  )}
                  {on && (
                    <button
                      type="button"
                      onClick={() => setAbrindo(abrindo === dow ? null : dow)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
                    >
                      + horário
                    </button>
                  )}
                </div>
              </div>

              {abrindo === dow && (
                <FormJanela
                  dow={dow}
                  ocupado={ocupado}
                  onCancelar={() => setAbrindo(null)}
                  onAdd={async (c) => {
                    const ok = await onAdd(c);
                    if (ok) setAbrindo(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FormJanela({
  dow,
  ocupado,
  onAdd,
  onCancelar,
}: {
  dow: number;
  ocupado: boolean;
  onAdd: (c: Omit<Janela, "id">) => Promise<void>;
  onCancelar: () => void;
}) {
  const [f, setF] = useState({
    inicio: "14:00",
    fim: "18:00",
    modalidade: "TELECONSULTA" as Modalidade,
    duracaoMin: 30,
    intervaloMin: 10,
  });
  const previsao = contarEncaixes({
    inicioMin: paraMin(f.inicio),
    fimMin: paraMin(f.fim),
    duracaoMin: f.duracaoMin,
    intervaloMin: f.intervaloMin,
  });

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <label className="block text-xs font-medium text-slate-600">
          Início
          <input type="time" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} className={`mt-1 ${CAMPO}`} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Fim
          <input type="time" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} className={`mt-1 ${CAMPO}`} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Modalidade
          <select value={f.modalidade} onChange={(e) => setF({ ...f, modalidade: e.target.value as Modalidade })} className={`mt-1 ${CAMPO}`}>
            <option value="TELECONSULTA">Teleconsulta</option>
            <option value="PRESENCIAL">Presencial</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Duração
          <select value={f.duracaoMin} onChange={(e) => setF({ ...f, duracaoMin: +e.target.value })} className={`mt-1 ${CAMPO}`}>
            {[15, 20, 30, 40, 45, 60].map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Intervalo
          <select value={f.intervaloMin} onChange={(e) => setF({ ...f, intervaloMin: +e.target.value })} className={`mt-1 ${CAMPO}`}>
            {[0, 5, 10, 15, 20].map((m) => (
              <option key={m} value={m}>{m === 0 ? "sem" : `${m} min`}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-600">
          {previsao > 0 ? (
            <>Gera <b className="text-teal-800">{previsao} encaixe{previsao > 1 ? "s" : ""}</b> toda {(DIAS[dow] ?? "").toLowerCase()}.</>
          ) : (
            <span className="text-amber-700">Janela curta demais para {f.duracaoMin} min.</span>
          )}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onCancelar} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-200">
            Cancelar
          </button>
          <button
            type="button"
            disabled={ocupado || previsao === 0}
            onClick={() =>
              void onAdd({
                diaSemana: dow,
                inicioMin: paraMin(f.inicio),
                fimMin: paraMin(f.fim),
                modalidade: f.modalidade,
                duracaoMin: f.duracaoMin,
                intervaloMin: f.intervaloMin,
              })
            }
            className="rounded-lg bg-teal-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
          >
            Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- calendário
function Calendario({
  view,
  setView,
  hoje,
  selDia,
  onSelDia,
  resolver,
}: {
  view: Date;
  setView: (d: Date) => void;
  hoje: Date;
  selDia: Date | null;
  onSelDia: (d: Date) => void;
  resolver: (data: string, dow: number) => { tipo: "work" | "sp" | "off"; janelas: (Janela | Especial)[] };
}) {
  const ano = view.getFullYear();
  const mes = view.getMonth();
  const primeiroDow = new Date(ano, mes, 1).getDay();
  const numDias = new Date(ano, mes + 1, 0).getDate();
  const celulas: (Date | null)[] = [];
  for (let i = 0; i < primeiroDow; i++) celulas.push(null);
  for (let d = 1; d <= numDias; d++) celulas.push(new Date(ano, mes, d));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl capitalize text-slate-900">
          {MESES[mes]} {ano}
        </h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => setView(new Date(ano, mes - 1, 1))}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => setView(new Date(ano, mes + 1, 1))}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <Legenda cor="bg-teal-50 border-teal-200" texto="Atende" />
        <Legenda cor="bg-amber-50 border-amber-200" texto="Horário especial" />
        <Legenda cor="bg-white border-slate-200" texto="Folga" />
        <Legenda cor="ring-2 ring-teal-700 bg-white border-transparent" texto="Hoje" />
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {DOW_HEADER.map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {d}
          </div>
        ))}
        {celulas.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="aspect-square" />;
          const chave = chaveDeData(d);
          const r = resolver(chave, d.getDay());
          const isHoje = mesmaData(d, hoje);
          const isSel = selDia && mesmaData(d, selDia);
          const n = r.janelas.reduce((s, j) => s + contarEncaixes(j), 0);
          const base =
            r.tipo === "work"
              ? "bg-teal-50 border-teal-200 hover:border-teal-400"
              : r.tipo === "sp"
                ? "bg-amber-50 border-amber-200 hover:border-amber-400"
                : "bg-white border-slate-200 hover:border-slate-300";
          return (
            <button
              key={chave}
              type="button"
              onClick={() => onSelDia(d)}
              className={`relative flex aspect-square flex-col rounded-xl border p-1.5 text-left transition ${base} ${
                isHoje ? "ring-2 ring-teal-700 ring-offset-1" : ""
              } ${isSel ? "outline outline-2 outline-teal-800 outline-offset-1" : ""}`}
            >
              <span
                className={`text-[13px] font-medium tabular-nums ${
                  r.tipo === "work" ? "text-teal-900" : r.tipo === "sp" ? "text-amber-800" : "text-slate-400"
                }`}
              >
                {d.getDate()}
              </span>
              {r.tipo === "sp" && <span className="absolute right-1.5 top-1.5 text-[10px] text-amber-500">★</span>}
              {n > 0 && (
                <span
                  className={`mt-auto text-[10px] font-medium ${
                    r.tipo === "sp" ? "text-amber-700" : "text-teal-700"
                  }`}
                >
                  <span className="font-mono">{n}×</span> {r.janelas[0]!.modalidade === "TELECONSULTA" ? "tele" : "pres"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded border ${cor}`} />
      {texto}
    </span>
  );
}

// ------------------------------------------------------------- painel do dia
function PainelDia({
  dia,
  resolver,
  janelas,
  ocupado,
  onPadrao,
  onEspecial,
  onFolga,
}: {
  dia: Date | null;
  resolver: (data: string, dow: number) => { tipo: "work" | "sp" | "off"; janelas: (Janela | Especial)[] };
  janelas: Janela[];
  ocupado: boolean;
  onPadrao: (data: string) => Promise<void>;
  onEspecial: (data: string, c: Omit<Especial, "id" | "data">) => Promise<boolean>;
  onFolga: (data: string, cancelar: boolean) => Promise<{ ok?: boolean; conflito?: Conflito[]; erro?: boolean }>;
}) {
  const [modo, setModo] = useState<"padrao" | "folga" | "sp">("padrao");
  const [sp, setSp] = useState({ inicio: "09:00", fim: "12:00", modalidade: "PRESENCIAL" as Modalidade, duracaoMin: 30, intervaloMin: 10 });
  // Editar o horário especial invalida o "Salvo ✓" anterior.
  const mudarSp = (patch: Partial<typeof sp>) => { setSp((s) => ({ ...s, ...patch })); setSalvo(false); };
  const [conflitos, setConflitos] = useState<Conflito[] | null>(null);
  const [salvo, setSalvo] = useState(false);

  const data = dia ? chaveDeData(dia) : null;
  const dow = dia ? dia.getDay() : 0;
  const r = data ? resolver(data, dow) : null;
  const base = janelas.filter((j) => j.diaSemana === dow);

  useEffect(() => {
    setConflitos(null);
    setSalvo(false);
    if (r) {
      setModo(r.tipo === "sp" ? "sp" : r.tipo === "off" ? "folga" : "padrao");
      if (r.tipo === "sp") {
        const e = r.janelas[0] as Especial;
        setSp({ inicio: paraHora(e.inicioMin), fim: paraHora(e.fimMin), modalidade: e.modalidade, duracaoMin: e.duracaoMin, intervaloMin: e.intervaloMin });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!dia || !data || !r) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500">
        Clique em um dia no calendário para dar folga ou abrir um horário especial.
      </section>
    );
  }

  const statusChip =
    r.tipo === "work"
      ? { txt: "Atende (padrão)", cls: "bg-teal-50 text-teal-800 border-teal-200" }
      : r.tipo === "sp"
        ? { txt: "Horário especial", cls: "bg-amber-50 text-amber-800 border-amber-200" }
        : { txt: "Folga", cls: "bg-slate-100 text-slate-600 border-slate-200" };

  async function salvar() {
    if (!data) return;
    setSalvo(false);
    if (modo === "padrao") {
      await onPadrao(data);
    } else if (modo === "sp") {
      const ok = await onEspecial(data, {
        inicioMin: paraMin(sp.inicio),
        fimMin: paraMin(sp.fim),
        modalidade: sp.modalidade,
        duracaoMin: sp.duracaoMin,
        intervaloMin: sp.intervaloMin,
      });
      if (!ok) return;
    } else {
      const res = await onFolga(data, false);
      if (res.conflito) {
        setConflitos(res.conflito);
        return;
      }
      if (res.erro) return;
    }
    setSalvo(true);
  }

  async function confirmarFolga() {
    if (!data) return;
    const res = await onFolga(data, true);
    setConflitos(null);
    if (res.ok) setSalvo(true);
  }

  const previsaoSp = contarEncaixes({ inicioMin: paraMin(sp.inicio), fimMin: paraMin(sp.fim), duracaoMin: sp.duracaoMin, intervaloMin: sp.intervaloMin });
  // Quantas dessas vagas o paciente conseguiria agendar (fora da antecedência de 2h).
  const spAgenda = contarAgendaveis(dia, { inicioMin: paraMin(sp.inicio), fimMin: paraMin(sp.fim), duracaoMin: sp.duracaoMin, intervaloMin: sp.intervaloMin });

  const opcoes: { id: "padrao" | "folga" | "sp"; t: string; d: string; disabled?: boolean }[] = [
    {
      id: "padrao",
      t: "☀ Atender como sempre",
      d: base.length
        ? `Padrão de ${(DIAS[dow] ?? "").toLowerCase()}: ${base.map((b) => `${paraHora(b.inicioMin)}–${paraHora(b.fimMin)}`).join(", ")}.`
        : `Não há padrão para ${(DIAS[dow] ?? "").toLowerCase()} — este dia é folga por padrão.`,
      disabled: base.length === 0,
    },
    { id: "folga", t: "✕ Folga neste dia", d: "Some da agenda só nesta data. O padrão da semana continua." },
    { id: "sp", t: "★ Horário especial", d: "Abre um horário diferente só hoje — um sábado extra, um plantão." },
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-serif text-xl capitalize text-slate-900">
          {(DIAS[dow] ?? "").toLowerCase()}, {dia.getDate()} de {MESES[dia.getMonth()]}
        </h3>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChip.cls}`}>
          {statusChip.txt}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={o.disabled}
            onClick={() => { setModo(o.id); setSalvo(false); setConflitos(null); }}
            className={`rounded-xl border p-3.5 text-left transition disabled:opacity-40 ${
              modo === o.id ? "border-teal-700 bg-teal-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className={`h-4 w-4 flex-none rounded-full border-2 ${modo === o.id ? "border-teal-700" : "border-slate-300"} grid place-items-center`}>
                {modo === o.id && <span className="h-2 w-2 rounded-full bg-teal-700" />}
              </span>
              {o.t}
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-slate-500">{o.d}</div>
          </button>
        ))}
      </div>

      {modo === "sp" && (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-dashed border-slate-200 pt-4 sm:grid-cols-4">
          <label className="block text-xs font-medium text-slate-600">
            Início
            <input type="time" value={sp.inicio} onChange={(e) => mudarSp({ inicio: e.target.value })} className={`mt-1 ${CAMPO}`} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Fim
            <input type="time" value={sp.fim} onChange={(e) => mudarSp({ fim: e.target.value })} className={`mt-1 ${CAMPO}`} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Modalidade
            <select value={sp.modalidade} onChange={(e) => mudarSp({ modalidade: e.target.value as Modalidade })} className={`mt-1 ${CAMPO}`}>
              <option value="TELECONSULTA">Teleconsulta</option>
              <option value="PRESENCIAL">Presencial</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Duração
            <select value={sp.duracaoMin} onChange={(e) => mudarSp({ duracaoMin: +e.target.value })} className={`mt-1 ${CAMPO}`}>
              {[20, 30, 40, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <p className="col-span-2 text-xs text-slate-500 sm:col-span-4">
            {previsaoSp > 0 ? <>Gera <b className="text-amber-700">{previsaoSp} encaixe{previsaoSp > 1 ? "s" : ""}</b> nesta data.</> : <span className="text-amber-700">Janela curta demais.</span>}
          </p>

          {/* Aviso de antecedência: vagas a menos de 2h de agora não aparecem
              para o paciente. É o que confunde ao abrir um horário "pra já". */}
          {previsaoSp > 0 && spAgenda.agendaveis < spAgenda.total && (
            <p
              className={`col-span-2 rounded-lg px-3 py-2 text-xs sm:col-span-4 ${
                spAgenda.agendaveis === 0
                  ? "bg-red-50 text-red-800"
                  : "bg-amber-50 text-amber-900"
              }`}
            >
              {spAgenda.agendaveis === 0 ? (
                <>
                  ⚠ O paciente precisa de <b>2h de antecedência</b> para agendar, e todas essas
                  vagas estão dentro desse limite — então <b>nenhuma aparecerá</b> para ele. Escolha
                  um horário mais tarde ou outra data.
                </>
              ) : (
                <>
                  ⚠ {spAgenda.total - spAgenda.agendaveis} vaga
                  {spAgenda.total - spAgenda.agendaveis > 1 ? "s" : ""} está dentro das{" "}
                  <b>2h de antecedência</b> e não aparecerá para o paciente; {spAgenda.agendaveis}{" "}
                  aparecerá{spAgenda.agendaveis > 1 ? "ão" : ""}.
                </>
              )}
            </p>
          )}
        </div>
      )}

      {conflitos && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Há {conflitos.length} consulta{conflitos.length > 1 ? "s" : ""} marcada{conflitos.length > 1 ? "s" : ""} neste dia:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {conflitos.map((c) => (
              <li key={c.id}>• {c.paciente}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">
            Marcar folga vai cancelar {conflitos.length > 1 ? "essas consultas" : "essa consulta"} e avisar o paciente por e-mail.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConflitos(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-amber-100">
              Voltar
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void confirmarFolga()}
              className="rounded-lg bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Confirmar folga e avisar
            </button>
          </div>
        </div>
      )}

      {!conflitos && (
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            disabled={ocupado || (modo === "sp" && previsaoSp === 0)}
            onClick={() => void salvar()}
            className="rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
          >
            {ocupado ? "Salvando…" : "Salvar este dia"}
          </button>
          {salvo && <span className="text-sm font-semibold text-teal-700">Salvo ✓</span>}
        </div>
      )}
    </section>
  );
}
