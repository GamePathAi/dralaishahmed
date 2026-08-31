/**
 * Registro clínico da consulta, fora da sala.
 *
 * A página decide sozinha em que estado a médica chegou:
 *   • existe rascunho (da IA ou manual) → revisar e assinar
 *   • não existe registro                → redigir do zero
 *   • já existe assinado                 → retificar, criando nova versão
 *
 * Ela também mostra a transcrição, quando houver, ao lado do editor. Isso
 * importa: se a IA errou uma dose, a médica precisa poder conferir a fala
 * original sem sair da tela — caso contrário a correção vira adivinhação.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { FUSO_MEDICA } from "@/lib/agenda";
import {
  EditorRegistro,
  type ModoEditor,
  type CamposRegistro,
} from "@/components/prontuario/EditorRegistro";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Registro clínico",
  robots: { index: false, follow: false },
};

const VAZIO: CamposRegistro = {
  queixaPrincipal: "",
  historiaMoleastiaAtual: "",
  antecedentes: "",
  hipotesesDiagnosticas: "",
  conduta: "",
  observacoes: "",
};

export default async function PaginaRegistro({
  params,
}: {
  params: Promise<{ consultaId: string }>;
}) {
  const { consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/atendimento/${consultaId}/registro`);
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    include: {
      paciente: {
        select: {
          id: true,
          alergias: true,
          usuario: { select: { nome: true, nascimento: true } },
        },
      },
      transcricao: { select: { texto: true, duracaoSeg: true } },
      registros: { orderBy: [{ versao: "desc" }], take: 1 },
      receitas: {
        where: { status: { not: "RETIFICADO" } },
        orderBy: { criadoEm: "desc" },
        take: 1,
        select: { id: true, status: true, temControlado: true },
      },
    },
  });

  if (!consulta || consulta.medicaId !== sessao.user.id) notFound();

  const registro = consulta.registros[0];
  const receita = consulta.receitas[0];

  // ---- qual estado? -------------------------------------------------------
  let modo: ModoEditor = "novo";
  if (registro?.status === "RASCUNHO") modo = "rascunho";
  else if (registro?.status === "ASSINADO") modo = "retificar";

  const inicial: CamposRegistro = registro
    ? {
        queixaPrincipal: registro.queixaPrincipal,
        historiaMoleastiaAtual: registro.historiaMoleastiaAtual,
        antecedentes: registro.antecedentes,
        hipotesesDiagnosticas: registro.hipotesesDiagnosticas,
        conduta: registro.conduta,
        observacoes: registro.observacoes ?? "",
      }
    : VAZIO;

  // Os pontos de atenção ficam no JSON bruto da IA, não em coluna própria.
  const rascunhoIA = registro?.rascunhoIA as
    | { pontosParaRevisao?: string[] }
    | null
    | undefined;
  const pontos =
    modo === "rascunho" ? (rascunhoIA?.pontosParaRevisao ?? []) : [];

  const idade = consulta.paciente.usuario.nascimento
    ? Math.floor(
        (Date.now() - consulta.paciente.usuario.nascimento.getTime()) /
          (365.25 * 86_400_000),
      )
    : null;

  const TITULOS: Record<ModoEditor, string> = {
    novo: "Registrar atendimento",
    rascunho: "Revisar e assinar",
    retificar: "Retificar registro",
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link
        href={`/pacientes/${consulta.paciente.id}`}
        className="text-sm text-slate-500 hover:text-slate-800"
      >
        ← Prontuário de {consulta.paciente.usuario.nome}
      </Link>

      <header className="mt-4 mb-6">
        <h1 className="font-serif text-2xl text-slate-900">{TITULOS[modo]}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {consulta.paciente.usuario.nome}
          {idade !== null && `, ${idade} anos`} ·{" "}
          {format(
            toZonedTime(consulta.inicioEm, FUSO_MEDICA),
            "d 'de' MMMM 'de' yyyy, HH:mm",
            { locale: ptBR, timeZone: FUSO_MEDICA },
          )}{" "}
          · {consulta.modalidade === "TELECONSULTA" ? "Teleconsulta" : "Presencial"}
        </p>
      </header>

      {/* Receita rascunhada pela IA para esta consulta — atalho para revisar e
          assinar sem ter que caçar no prontuário. */}
      {receita && (
        <div
          className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
            receita.status === "RASCUNHO"
              ? "border-amber-300 bg-amber-50"
              : "border-teal-200 bg-teal-50"
          }`}
        >
          <p className="text-sm text-slate-800">
            {receita.status === "RASCUNHO"
              ? "A IA rascunhou uma receita para esta consulta."
              : "Receita desta consulta assinada."}
            {receita.temControlado && (
              <span className="ml-1 font-semibold text-red-700">
                Contém medicamento controlado.
              </span>
            )}
          </p>
          <Link
            href={
              receita.status === "RASCUNHO"
                ? `/receita/${receita.id}`
                : `/receita/${receita.id}/imprimir`
            }
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
              receita.status === "RASCUNHO"
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-teal-800 hover:bg-teal-900"
            }`}
          >
            {receita.status === "RASCUNHO" ? "Revisar receita" : "Imprimir receita"}
          </Link>
        </div>
      )}

      {/* Alergia sempre visível enquanto se escreve a conduta — é o momento em
          que a omissão custa caro. */}
      {consulta.paciente.alergias && (
        <p className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>Alergias:</strong> {consulta.paciente.alergias}
        </p>
      )}

      {modo === "novo" && !consulta.transcricao && !consulta.notaSessaoMedica && (
        <p className="mb-5 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          Não há transcrição para esta consulta — seja porque foi presencial,
          porque o paciente não autorizou a gravação, ou porque o processamento
          falhou. Redija o registro normalmente.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="order-2 lg:order-1">
          <EditorRegistro
            consultaId={consultaId}
            pacienteId={consulta.paciente.id}
            registroId={registro?.id}
            modo={modo}
            inicial={inicial}
            pontosParaRevisao={pontos}
            origemIA={registro?.origemIA ?? false}
            crmMedica={env.CRM_MEDICA}
            notaSessao={consulta.notaSessaoMedica ?? undefined}
          />
        </div>

        {/* ---- apoio: anotações da médica + transcrição ---- */}
        {(consulta.transcricao || consulta.notaSessaoMedica) && (
          <aside className="order-1 space-y-5 lg:order-2 lg:sticky lg:top-6 lg:self-start">
            {consulta.notaSessaoMedica && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Suas anotações da consulta
                </h2>
                <div className="mt-2 max-h-[35vh] overflow-y-auto whitespace-pre-line rounded-xl border border-teal-200 bg-teal-50/50 p-4 text-sm leading-relaxed text-slate-700">
                  {consulta.notaSessaoMedica}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  O que você digitou durante a consulta — apoio ao registro.
                </p>
              </div>
            )}

            {consulta.transcricao && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Transcrição da consulta
                  {consulta.transcricao.duracaoSeg && (
                    <span className="ml-1 font-normal normal-case text-slate-400">
                      ({Math.round(consulta.transcricao.duracaoSeg / 60)} min)
                    </span>
                  )}
                </h2>

                <div className="mt-2 max-h-[55vh] overflow-y-auto whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
                  {consulta.transcricao.texto}
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Transcrição automática — pode conter erros, sobretudo em nomes de
                  medicamento e doses. Confira aqui antes de corrigir o registro.
                  O áudio original já foi apagado.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
