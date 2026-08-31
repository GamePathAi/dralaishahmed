"use client";

/**
 * Encaixe manual da médica: um botão na agenda que abre um formulário para ela
 * agendar um paciente direto, no horário que quiser. Chama
 * `POST /api/consultas/manual` (só médica; horário livre; nasce CONFIRMADA).
 *
 * Dois modos de cobrança:
 *   - isento: pago por fora (dinheiro/cortesia), com nota de como foi pago;
 *   - Pix: cobra um valor à escolha via provedor — a rota devolve o copia-e-cola
 *     + QR para a médica enviar ao paciente. Só aparece quando o pagamento está
 *     ligado (`podeCobrarPix`).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/config-medica";
import { cpfValido } from "@/lib/cpf";

const FUSO_CLINICA = "America/Campo_Grande";
const hojeClinica = () => new Date().toLocaleDateString("en-CA", { timeZone: FUSO_CLINICA });
const reaisParaCent = (v: string) => {
  // Aceita o jeito natural BR ("1.234,56"), US ("1234.56") e simples ("45").
  let s = v.trim().replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // vírgula=decimal, ponto=milhar
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

const CAMPO =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700";

interface PixGerado {
  copiaCola: string;
  qrBase64: string;
  valorCent: number;
  nome: string;
  linkPagamento?: string;
}

export function NovaConsultaMedica({ podeCobrarPix = false }: { podeCobrarPix?: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
      >
        + Nova consulta
      </button>
      {aberto && (
        <Modal
          podeCobrarPix={podeCobrarPix}
          onFechar={() => setAberto(false)}
          onConcluir={(dia) => {
            setAberto(false);
            router.push(`/agenda?dia=${dia}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function Modal({
  podeCobrarPix,
  onFechar,
  onConcluir,
}: {
  podeCobrarPix: boolean;
  onFechar: () => void;
  onConcluir: (dia: string) => void;
}) {
  const [f, setF] = useState({
    email: "",
    nome: "",
    telefone: "",
    cpf: "",
    data: hojeClinica(),
    hora: "14:00",
    duracaoMin: 30,
    modalidade: "TELECONSULTA" as "TELECONSULTA" | "PRESENCIAL",
    motivo: "",
    cobranca: "isento" as "isento" | "pix",
    valorReais: "",
    pagamentoNota: "",
    valorRecebido: "",
    avisarPaciente: true,
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pix, setPix] = useState<PixGerado | null>(null);
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  const cobrarPix = podeCobrarPix && f.cobranca === "pix";

  const criar = async () => {
    setErro(null);
    if (cobrarPix) {
      if (reaisParaCent(f.valorReais) < 100) {
        setErro("Informe o valor a cobrar.");
        return;
      }
      if (!cpfValido(f.cpf)) {
        setErro("Informe um CPF válido do paciente para a cobrança.");
        return;
      }
    }
    setEnviando(true);
    try {
      const r = await fetch("/api/consultas/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: f.email.trim(),
          nome: f.nome.trim() || undefined,
          telefone: f.telefone.trim() || undefined,
          cpf: f.cpf.trim() || undefined,
          inicioEm: `${f.data}T${f.hora}`,
          duracaoMin: f.duracaoMin,
          modalidade: f.modalidade,
          motivo: f.motivo.trim() || undefined,
          cobranca: cobrarPix ? "pix" : "isento",
          valorCent: cobrarPix ? reaisParaCent(f.valorReais) : undefined,
          pagamentoNota: !cobrarPix ? f.pagamentoNota.trim() || undefined : undefined,
          valorRecebidoCent: !cobrarPix ? reaisParaCent(f.valorRecebido) : undefined,
          avisarPaciente: f.avisarPaciente,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.erro ?? "Não foi possível criar a consulta.");
        return;
      }
      if (d.pix) {
        // Mostra o Pix para a médica copiar/enviar; só fecha quando ela concluir.
        setPix({
          copiaCola: d.pix.copiaCola,
          qrBase64: d.pix.qrBase64,
          valorCent: d.valorCent,
          nome: d.nome,
          linkPagamento: d.pix.linkPagamento,
        });
        return;
      }
      onConcluir(f.data);
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {pix ? (
          <ResultadoPix pix={pix} onConcluir={() => onConcluir(f.data)} />
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-serif text-xl text-slate-900">Nova consulta</h2>
                <p className="mt-1 text-sm text-slate-600">Encaixe direto — horário livre.</p>
              </div>
              <button
                type="button"
                onClick={onFechar}
                aria-label="Fechar"
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                E-mail do paciente
                <input
                  type="email"
                  value={f.email}
                  onChange={(e) => set({ email: e.target.value })}
                  placeholder="paciente@email.com"
                  className={CAMPO}
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Se já for paciente, usamos o cadastro. Se for novo, preencha o nome abaixo.
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Nome <span className="font-normal text-slate-400">(paciente novo)</span>
                  <input value={f.nome} onChange={(e) => set({ nome: e.target.value })} className={CAMPO} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Telefone <span className="font-normal text-slate-400">(opcional)</span>
                  <input value={f.telefone} onChange={(e) => set({ telefone: e.target.value })} className={CAMPO} />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm font-medium text-slate-700">
                  Data
                  <input type="date" value={f.data} onChange={(e) => set({ data: e.target.value })} className={CAMPO} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Hora
                  <input type="time" value={f.hora} onChange={(e) => set({ hora: e.target.value })} className={CAMPO} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Duração
                  <select value={f.duracaoMin} onChange={(e) => set({ duracaoMin: +e.target.value })} className={CAMPO}>
                    {[15, 20, 30, 40, 45, 60].map((m) => (
                      <option key={m} value={m}>{m} min</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Modalidade
                <select
                  value={f.modalidade}
                  onChange={(e) => set({ modalidade: e.target.value as "TELECONSULTA" | "PRESENCIAL" })}
                  className={CAMPO}
                >
                  <option value="TELECONSULTA">Teleconsulta</option>
                  <option value="PRESENCIAL">Presencial</option>
                </select>
              </label>

              {/* --- cobrança: só aparece quando o pagamento está ligado --- */}
              {podeCobrarPix && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <span className="text-sm font-medium text-slate-700">Cobrança</span>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <OpcaoCobranca
                      ativa={f.cobranca === "isento"}
                      titulo="Pago por fora"
                      descricao="Dinheiro, cortesia — sem cobrar na plataforma."
                      onClick={() => set({ cobranca: "isento" })}
                    />
                    <OpcaoCobranca
                      ativa={f.cobranca === "pix"}
                      titulo="Cobrar do paciente"
                      descricao="Gera um link (Pix, cartão ou boleto) + QR para enviar."
                      onClick={() => set({ cobranca: "pix" })}
                    />
                  </div>
                </div>
              )}

              {cobrarPix ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Valor a cobrar (R$)
                    <input
                      type="text"
                      inputMode="decimal"
                      value={f.valorReais}
                      onChange={(e) => set({ valorReais: e.target.value })}
                      placeholder="0,00"
                      className={CAMPO}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    CPF do paciente
                    <input
                      value={f.cpf}
                      onChange={(e) => set({ cpf: e.target.value })}
                      placeholder="obrigatório para a cobrança"
                      className={CAMPO}
                    />
                  </label>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Como foi pago <span className="font-normal text-slate-400">(opcional)</span>
                    <input
                      value={f.pagamentoNota}
                      onChange={(e) => set({ pagamentoNota: e.target.value })}
                      placeholder="dinheiro, Pix, cortesia…"
                      className={CAMPO}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Valor recebido <span className="font-normal text-slate-400">(R$, opcional)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={f.valorRecebido}
                      onChange={(e) => set({ valorRecebido: e.target.value })}
                      placeholder="0,00 = cortesia"
                      className={CAMPO}
                    />
                    <span className="mt-1 block text-xs text-slate-500">Entra como receita no Financeiro.</span>
                  </label>
                </div>
              )}

              <label className="block text-sm font-medium text-slate-700">
                Motivo <span className="font-normal text-slate-400">(opcional)</span>
                <input value={f.motivo} onChange={(e) => set({ motivo: e.target.value })} className={CAMPO} />
              </label>

              {!cobrarPix && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={f.avisarPaciente}
                    onChange={(e) => set({ avisarPaciente: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-400 text-teal-800"
                  />
                  Avisar o paciente por e-mail (envia a confirmação com data e hora)
                </label>
              )}

              {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onFechar}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={enviando || !f.email.trim()}
                onClick={() => void criar()}
                className="rounded-lg bg-teal-800 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-40"
              >
                {enviando ? "Agendando…" : cobrarPix ? "Agendar e gerar cobrança" : "Agendar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OpcaoCobranca({
  ativa,
  titulo,
  descricao,
  onClick,
}: {
  ativa: boolean;
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition ${
        ativa ? "border-teal-700 bg-teal-50" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className={`h-3.5 w-3.5 flex-none rounded-full border-2 ${ativa ? "border-teal-700" : "border-slate-300"} grid place-items-center`}>
          {ativa && <span className="h-1.5 w-1.5 rounded-full bg-teal-700" />}
        </span>
        {titulo}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-slate-500">{descricao}</div>
    </button>
  );
}

function ResultadoPix({ pix, onConcluir }: { pix: PixGerado; onConcluir: () => void }) {
  const [copiado, setCopiado] = useState<"" | "link" | "codigo">("");
  const copiar = async (texto: string, qual: "link" | "codigo") => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      setTimeout(() => setCopiado(""), 2000);
    } catch {
      /* clipboard indisponível */
    }
  };
  return (
    <div className="text-center">
      <h2 className="font-serif text-xl text-slate-900">Cobrança gerada</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
        Consulta criada para <b>{pix.nome}</b>. Envie ao paciente{" "}
        {pix.linkPagamento && pix.copiaCola ? "o link ou o Pix" : pix.linkPagamento ? "o link" : "o Pix"} de{" "}
        <b className="text-slate-900">{formatarBRL(pix.valorCent)}</b> — quando ele pagar, a
        consulta é confirmada automaticamente.
      </p>

      {/* Link de pagamento (recomendado): mais fácil de enviar e aceita mais formas. */}
      {pix.linkPagamento && (
        <div className="mx-auto mt-4 max-w-sm rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-left">
          <p className="text-sm font-semibold text-teal-900">Link de pagamento</p>
          <p className="mt-0.5 text-xs text-slate-500">
            O paciente abre e paga por Pix, cartão ou boleto.
          </p>
          <div className="mt-2 flex items-stretch gap-2">
            <input
              readOnly
              value={pix.linkPagamento}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={() => copiar(pix.linkPagamento!, "link")}
              className="shrink-0 rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
            >
              {copiado === "link" ? "Copiado ✓" : "Copiar link"}
            </button>
          </div>
        </div>
      )}

      {/* Pix direto: QR + copia-e-cola (some se o provedor não devolver o QR). */}
      {pix.copiaCola && (
        <>
          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-400">
            {pix.linkPagamento ? "Ou por Pix" : "Pix"}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pix.qrBase64}
            alt="QR Code do Pix"
            width={160}
            height={160}
            className="mx-auto mt-2 h-40 w-40 rounded-lg border border-slate-200"
          />
          <div className="mx-auto mt-3 flex max-w-sm items-stretch gap-2">
            <input
              readOnly
              value={pix.copiaCola}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={() => copiar(pix.copiaCola, "codigo")}
              className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {copiado === "codigo" ? "Copiado ✓" : "Copiar código"}
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onConcluir}
        className="mt-6 rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Concluir
      </button>
    </div>
  );
}
