/**
 * Consultas do paciente.
 *
 * O botão de entrar na sala só aparece na janela em que ele funciona — abrir a
 * sala 3 dias antes devolveria 425 e uma tela de contagem regressiva sem
 * contexto. Fora da janela, o cartão mostra quando a entrada libera.
 */

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Minhas consultas" };

/** Mesma antecedência usada na rota de sala e no token da Daily. */
const MIN_ANTES = 15;
const MIN_DEPOIS = 30;

/** Documentos assinados de uma consulta, achatados numa lista de links. */
function docsDaConsulta(c: {
  receitas: { id: string }[];
  atestados: { id: string }[];
  solicitacoesExame: { id: string }[];
}) {
  return [
    ...c.receitas.map((d) => ({ tipo: "receita", id: d.id, rotulo: "Receita" })),
    ...c.atestados.map((d) => ({ tipo: "atestado", id: d.id, rotulo: "Atestado" })),
    ...c.solicitacoesExame.map((d) => ({
      tipo: "exames",
      id: d.id,
      rotulo: "Solicitação de exames",
    })),
  ];
}

/** Chips de link para os documentos de uma consulta (ou nada, se não houver). */
function LinksDocumentos({
  docs,
}: {
  docs: { tipo: string; id: string; rotulo: string }[];
}) {
  if (docs.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Documentos:</span>
      {docs.map((d) => (
        <Link
          key={`${d.tipo}-${d.id}`}
          href={`/documentos/${d.tipo}/${d.id}`}
          className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 hover:border-teal-400"
        >
          {d.rotulo}
        </Link>
      ))}
    </div>
  );
}

export default async function PaginaMinhasConsultas() {
  const sessao = await auth();
  if (!sessao?.user) redirect("/entrar?destino=/minhas-consultas");

  const paciente = await prisma.paciente.findUnique({
    where: { usuarioId: sessao.user.id },
    select: { id: true },
  });

  const consultas = paciente
    ? await prisma.consulta.findMany({
        where: { pacienteId: paciente.id },
        orderBy: { inicioEm: "desc" },
        take: 40,
        select: {
          id: true,
          inicioEm: true,
          duracaoMin: true,
          modalidade: true,
          status: true,
          motivo: true,
          // Só o documento vigente (assinado) — rascunho e versão retificada
          // não vão para o paciente.
          receitas: { where: { status: "ASSINADO" }, select: { id: true } },
          atestados: { where: { status: "ASSINADO" }, select: { id: true } },
          solicitacoesExame: { where: { status: "ASSINADO" }, select: { id: true } },
        },
      })
    : [];

  const agora = Date.now();
  const futuras = consultas.filter(
    (c) =>
      c.inicioEm.getTime() + c.duracaoMin * 60_000 > agora &&
      c.status !== "CANCELADA",
  );
  const passadas = consultas.filter((c) => !futuras.includes(c));

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-slate-900">Minhas consultas</h1>
          <p className="mt-1 text-sm text-slate-600">{sessao.user.name}</p>
        </div>
        <Link
          href="/agendar"
          className="rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Marcar consulta
        </Link>
      </header>

      {futuras.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Próximas
          </h2>
          <ul className="mt-3 space-y-3">
            {futuras.map((c) => {
              const inicio = c.inicioEm.getTime();
              const abre = inicio - MIN_ANTES * 60_000;
              const fecha = inicio + (c.duracaoMin + MIN_DEPOIS) * 60_000;
              const aberta = agora >= abre && agora <= fecha;

              return (
                <li
                  key={c.id}
                  className="rounded-xl border border-slate-200 bg-white p-5"
                >
                  <p className="font-medium capitalize text-slate-900">
                    {c.inicioEm.toLocaleString("pt-BR", {
                      weekday: "long",
                      day: "2-digit",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {c.modalidade === "TELECONSULTA"
                      ? "Teleconsulta por vídeo"
                      : "Consulta presencial"}{" "}
                    · {c.duracaoMin} min
                    {c.motivo && ` · ${c.motivo}`}
                  </p>

                  {c.modalidade === "TELECONSULTA" && (
                    <div className="mt-4">
                      {aberta ? (
                        <Link
                          href={`/sala/${c.id}`}
                          className="inline-block rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
                        >
                          Entrar na sala
                        </Link>
                      ) : (
                        <p className="text-sm text-slate-500">
                          A entrada libera {MIN_ANTES} minutos antes, às{" "}
                          <strong className="text-slate-700">
                            {new Date(abre).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </strong>
                          .
                        </p>
                      )}
                    </div>
                  )}

                  {c.modalidade === "PRESENCIAL" && (
                    <p className="mt-3 text-sm text-slate-600">
                      Rua Alfredo Justino, 76 — Três Lagoas/MS
                    </p>
                  )}

                  <LinksDocumentos docs={docsDaConsulta(c)} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {futuras.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
          <p className="text-sm text-slate-600">
            Você não tem consultas marcadas.
          </p>
          <Link
            href="/agendar"
            className="mt-4 inline-block rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Marcar consulta
          </Link>
        </div>
      )}

      {passadas.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Anteriores
          </h2>
          <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {passadas.map((c) => (
              <li key={c.id} className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-slate-700">
                    {c.inicioEm.toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                  <span className="text-xs text-slate-400">
                    {c.modalidade === "TELECONSULTA" ? "vídeo" : "presencial"}
                  </span>
                  {c.status === "CANCELADA" && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                      cancelada
                    </span>
                  )}
                </div>
                <LinksDocumentos docs={docsDaConsulta(c)} />
              </li>
            ))}
          </ul>

          {/* Direito do art. 18 da LGPD e do Código de Ética Médica: o
              prontuário é do paciente. Ele não fica visível aqui porque
              relatório clínico fora de contexto costuma assustar mais do que
              informar — mas o caminho para pedir é explícito. */}
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Para receber cópia do seu prontuário, solicite por{" "}
            <a
              href="mailto:contato@dralaishahmed.com.br?subject=Solicita%C3%A7%C3%A3o%20de%20c%C3%B3pia%20do%20prontu%C3%A1rio"
              className="text-teal-800 underline underline-offset-2"
            >
              e-mail
            </a>
            . A resposta é dada em até 15 dias.
          </p>
        </section>
      )}
    </main>
  );
}
