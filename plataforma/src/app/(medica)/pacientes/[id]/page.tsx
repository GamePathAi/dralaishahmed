/**
 * Prontuário do paciente.
 *
 * Duas coisas que este arquivo faz e que não são detalhe de tela:
 *
 * 1. **Registra a visualização na auditoria.** Abrir prontuário é acesso a dado
 *    sensível. Sem trilha, não há como responder "quem viu este prontuário e
 *    quando" — pergunta que aparece em qualquer apuração séria.
 *
 * 2. **Mostra o histórico de versões, não só a versão vigente.** Um registro
 *    retificado continua visível, marcado como superado. É o que diferencia
 *    prontuário de documento editável: a correção aparece, o apagamento não
 *    existe.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_MEDICA } from "@/lib/agenda";
import type { StatusRegistro } from "@prisma/client";
import type { ItemReceita } from "@/lib/receita-tipos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prontuário",
  robots: { index: false, follow: false },
};

const SELO: Record<StatusRegistro, { texto: string; classe: string }> = {
  RASCUNHO: {
    texto: "rascunho — não assinado",
    classe: "bg-amber-100 text-amber-900",
  },
  ASSINADO: { texto: "assinado", classe: "bg-teal-50 text-teal-800" },
  RETIFICADO: {
    texto: "superado por versão posterior",
    classe: "bg-slate-100 text-slate-500",
  },
};

export default async function PaginaProntuario({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: pacienteId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/pacientes/${pacienteId}`);
  }

  const paciente = await prisma.paciente.findUnique({
    where: { id: pacienteId },
    include: {
      usuario: {
        select: { nome: true, email: true, telefone: true, nascimento: true, cpf: true },
      },
      registros: {
        orderBy: [{ criadoEm: "desc" }, { versao: "desc" }],
        include: {
          consulta: { select: { inicioEm: true, modalidade: true } },
        },
      },
      // Receitas em qualquer estado — o rascunho precisa aparecer para a médica
      // revisar, a assinada para reimprimir. A retificada some (superada).
      receitas: {
        where: { status: { not: "RETIFICADO" } },
        orderBy: [{ criadoEm: "desc" }],
        include: { consulta: { select: { inicioEm: true } } },
      },
    },
  });

  if (!paciente) notFound();

  // Trilha de auditoria. Fica antes da renderização de propósito: o acesso é
  // registrado mesmo que a página falhe em pintar depois.
  await prisma.auditoria.create({
    data: {
      usuarioId: sessao.user.id,
      acao: "VISUALIZOU_PRONTUARIO",
      recursoId: pacienteId,
    },
  });

  const u = paciente.usuario;
  const idade = u.nascimento
    ? Math.floor((Date.now() - u.nascimento.getTime()) / (365.25 * 86_400_000))
    : null;

  const pendentes = paciente.registros.filter((r) => r.status === "RASCUNHO");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/agenda" className="text-sm text-slate-500 hover:text-slate-800">
          ← Voltar à agenda
        </Link>
        <Link
          href={`/pacientes/${pacienteId}/imprimir`}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Imprimir / PDF
        </Link>
      </div>

      <header className="mt-4 border-b border-slate-200 pb-6">
        <h1 className="font-serif text-2xl text-slate-900">{u.nome}</h1>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
          {idade !== null && <span>{idade} anos</span>}
          {u.cpf && <span>CPF {u.cpf}</span>}
          {u.telefone && <span>{u.telefone}</span>}
          <span>{u.email}</span>
        </dl>
      </header>

      {/* Alergias primeiro, sempre. */}
      {paciente.alergias && (
        <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-red-800">
            Alergias
          </h2>
          <p className="mt-1.5 text-sm font-medium text-red-900">
            {paciente.alergias}
          </p>
        </section>
      )}

      {(paciente.medicacoesUso || paciente.antecedentes) && (
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          {paciente.medicacoesUso && (
            <Cartao titulo="Medicações em uso" texto={paciente.medicacoesUso} />
          )}
          {paciente.antecedentes && (
            <Cartao titulo="Antecedentes" texto={paciente.antecedentes} />
          )}
        </section>
      )}

      {pendentes.length > 0 && (
        <p className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>
            {pendentes.length} registro{pendentes.length > 1 ? "s" : ""} sem assinatura.
          </strong>{" "}
          Rascunho não vale como prontuário — conclua a revisão.
        </p>
      )}

      {/* ---- evolução ---- */}
      <section className="mt-8">
        <h2 className="font-serif text-lg text-slate-900">
          Evolução{" "}
          <span className="font-sans text-sm font-normal text-slate-500">
            ({paciente.registros.length} registro
            {paciente.registros.length === 1 ? "" : "s"})
          </span>
        </h2>

        {paciente.registros.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
            Nenhum registro ainda.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {paciente.registros.map((r) => {
              const selo = SELO[r.status];
              const superado = r.status === "RETIFICADO";

              return (
                <li
                  key={r.id}
                  className={`rounded-xl border bg-white p-5 ${
                    superado
                      ? "border-slate-200 opacity-60"
                      : r.status === "RASCUNHO"
                        ? "border-amber-300"
                        : "border-slate-200"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">
                        {format(
                          toZonedTime(r.consulta.inicioEm, FUSO_MEDICA),
                          "d 'de' MMMM 'de' yyyy",
                          { locale: ptBR, timeZone: FUSO_MEDICA },
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.consulta.modalidade === "TELECONSULTA"
                          ? "Teleconsulta"
                          : "Presencial"}
                        {r.versao > 1 && ` · versão ${r.versao}`}
                        {r.assinadoEm &&
                          ` · assinado em ${format(
                            toZonedTime(r.assinadoEm, FUSO_MEDICA),
                            "dd/MM/yyyy HH:mm",
                            { timeZone: FUSO_MEDICA },
                          )} por ${r.assinadoPor}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Origem da IA fica visível para sempre — inclusive
                          depois de a médica editar o texto. */}
                      {r.origemIA && (
                        <span
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600"
                          title={
                            r.editadoPelaMedica
                              ? "Rascunho gerado por IA e editado pela médica"
                              : "Rascunho gerado por IA, aceito sem edição"
                          }
                        >
                          IA{r.editadoPelaMedica ? " · editado" : ""}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${selo.classe}`}
                      >
                        {selo.texto}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 text-sm">
                    <Campo rotulo="QP" texto={r.queixaPrincipal} />
                    <Campo rotulo="HMA" texto={r.historiaMoleastiaAtual} />
                    <Campo rotulo="Antecedentes" texto={r.antecedentes} />
                    <Campo rotulo="HD" texto={r.hipotesesDiagnosticas} />
                    <Campo rotulo="Conduta" texto={r.conduta} />
                    {r.observacoes && (
                      <Campo rotulo="Obs." texto={r.observacoes} />
                    )}
                  </div>

                  {r.status === "RASCUNHO" && (
                    <Link
                      href={`/atendimento/${r.consultaId}/registro`}
                      className="mt-4 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                    >
                      Revisar e assinar
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ---- receitas ---- */}
      {paciente.receitas.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-lg text-slate-900">Receitas</h2>
          <ol className="mt-4 space-y-3">
            {paciente.receitas.map((r) => {
              const itens = (r.itens as unknown as ItemReceita[]) ?? [];
              const rascunho = r.status === "RASCUNHO";
              return (
                <li
                  key={r.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 ${
                    rascunho ? "border-amber-300" : "border-slate-200"
                  }`}
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {format(
                        toZonedTime(r.consulta.inicioEm, FUSO_MEDICA),
                        "d 'de' MMMM 'de' yyyy",
                        { locale: ptBR, timeZone: FUSO_MEDICA },
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {itens.length} medicamento{itens.length === 1 ? "" : "s"}
                      {r.temControlado && " · contém controlado"}
                      {r.origemIA && " · rascunho IA"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        rascunho
                          ? "bg-amber-100 text-amber-900"
                          : "bg-teal-50 text-teal-800"
                      }`}
                    >
                      {rascunho ? "rascunho — não assinada" : "assinada"}
                    </span>
                    <Link
                      href={
                        rascunho
                          ? `/receita/${r.id}`
                          : `/receita/${r.id}/imprimir`
                      }
                      className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white ${
                        rascunho
                          ? "bg-amber-600 hover:bg-amber-700"
                          : "bg-teal-800 hover:bg-teal-900"
                      }`}
                    >
                      {rascunho ? "Revisar e assinar" : "Imprimir"}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <p className="mt-10 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">
        Prontuário protegido por sigilo médico (art. 73 do Código de Ética
        Médica). Todo acesso a esta página é registrado. Guarda mínima de 20 anos
        a contar do último registro (Res. CFM 1.821/2007 e Lei 13.787/2018).
      </p>
    </main>
  );
}

// ------------------------------------------------------------- auxiliares

function Cartao({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {titulo}
      </h3>
      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-800">
        {texto}
      </p>
    </div>
  );
}

function Campo({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[80px_1fr] sm:gap-3">
      <span className="pt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {rotulo}
      </span>
      <p className="whitespace-pre-line leading-relaxed text-slate-800">
        {texto}
      </p>
    </div>
  );
}
