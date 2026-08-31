/**
 * Sala da médica.
 *
 * Mesma `EntradaSala` do paciente — a rota de token decide o papel, então não
 * há duas telas de videochamada para manter em sincronia. A diferença fica
 * antes de entrar: aqui aparece um resumo do paciente, que é o que ela precisa
 * ter na cabeça nos segundos anteriores à consulta.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EntradaSala } from "@/components/sala/EntradaSala";
import { FUSO_MEDICA } from "@/lib/agenda";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atendimento",
  robots: { index: false, follow: false },
};

export default async function PaginaAtendimento({
  params,
  searchParams,
}: {
  params: Promise<{ consultaId: string }>;
  searchParams: Promise<{ entrar?: string }>;
}) {
  const { consultaId } = await params;
  const { entrar } = await searchParams;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/atendimento/${consultaId}`);
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: {
      id: true,
      medicaId: true,
      modalidade: true,
      status: true,
      inicioEm: true,
      duracaoMin: true,
      motivo: true,
      paciente: {
        select: {
          id: true,
          alergias: true,
          medicacoesUso: true,
          antecedentes: true,
          usuario: { select: { nome: true, nascimento: true, telefone: true } },
        },
      },
    },
  });

  if (!consulta || consulta.medicaId !== sessao.user.id) notFound();

  // Já confirmou que quer entrar: vai direto para o vídeo.
  if (entrar === "1" && consulta.modalidade === "TELECONSULTA") {
    return <EntradaSala consultaId={consultaId} />;
  }

  const p = consulta.paciente;
  const idade = p.usuario.nascimento
    ? Math.floor(
        (Date.now() - p.usuario.nascimento.getTime()) / (365.25 * 86_400_000),
      )
    : null;

  const consultasAnteriores = await prisma.consulta.count({
    where: {
      pacienteId: p.id,
      status: "CONCLUIDA",
      inicioEm: { lt: consulta.inicioEm },
    },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href="/agenda"
        className="text-sm text-slate-500 hover:text-slate-800"
      >
        ← Voltar à agenda
      </Link>

      <header className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-800">
          {consulta.modalidade === "TELECONSULTA" ? "Teleconsulta" : "Presencial"} ·{" "}
          {consulta.duracaoMin} min
        </p>
        <h1 className="mt-1 font-serif text-2xl text-slate-900">
          {p.usuario.nome}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {idade !== null && `${idade} anos · `}
          {format(toZonedTime(consulta.inicioEm, FUSO_MEDICA), "d 'de' MMMM 'às' HH:mm", {
            locale: ptBR,
            timeZone: FUSO_MEDICA,
          })}
          {" · "}
          {consultasAnteriores === 0
            ? "primeira consulta"
            : `${consultasAnteriores}ª consulta`}
        </p>
      </header>

      {consulta.motivo && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Motivo informado no agendamento
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-800">
            {consulta.motivo}
          </p>
        </section>
      )}

      {/* Alergia em destaque próprio, separada do resto. É a informação cuja
          omissão causa dano imediato numa prescrição. */}
      {p.alergias && (
        <section className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-red-800">
            Alergias
          </h2>
          <p className="mt-1.5 text-sm font-medium leading-relaxed text-red-900">
            {p.alergias}
          </p>
        </section>
      )}

      {(p.medicacoesUso || p.antecedentes) && (
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          {p.medicacoesUso && (
            <Bloco titulo="Medicações em uso" texto={p.medicacoesUso} />
          )}
          {p.antecedentes && (
            <Bloco titulo="Antecedentes" texto={p.antecedentes} />
          )}
        </section>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        {consulta.modalidade === "TELECONSULTA" ? (
          <Link
            href={`/atendimento/${consultaId}?entrar=1`}
            className="rounded-xl bg-teal-800 px-6 py-3.5 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Entrar na sala
          </Link>
        ) : (
          <Link
            href={`/atendimento/${consultaId}/registro`}
            className="rounded-xl bg-teal-800 px-6 py-3.5 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Registrar atendimento
          </Link>
        )}
        <Link
          href={`/pacientes/${p.id}`}
          className="rounded-xl border border-slate-300 px-6 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Ver prontuário
        </Link>
      </div>
    </main>
  );
}

function Bloco({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {titulo}
      </h2>
      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-800">
        {texto}
      </p>
    </div>
  );
}
