/**
 * Versão para impressão / PDF do prontuário.
 *
 * Documento clínico formal, pensado para o navegador imprimir ou salvar como
 * PDF (Salvar como PDF no destino da impressão). Optou-se por isto em vez de
 * gerar o PDF no servidor: a paginação de texto clínico longo sai de graça e
 * bem-feita pelo navegador, sem Chromium na instância pequena.
 *
 * Só inclui registros ASSINADOS e RETIFICADOS — o documento oficial. Rascunho
 * não assinado não é prontuário e não deve sair num PDF entregável.
 *
 * A exportação é registrada na auditoria (EXPORTOU_DADOS): tirar cópia de
 * dado de saúde é ato que precisa de rastro.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { FUSO_MEDICA } from "@/lib/agenda";
import { BotaoImprimir } from "@/components/prontuario/BotaoImprimir";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Prontuário — impressão",
  robots: { index: false, follow: false },
};

const dataHora = (d: Date) =>
  format(toZonedTime(d, FUSO_MEDICA), "dd/MM/yyyy 'às' HH:mm", {
    locale: ptBR,
    timeZone: FUSO_MEDICA,
  });
const dataSo = (d: Date) =>
  format(toZonedTime(d, FUSO_MEDICA), "dd/MM/yyyy", {
    locale: ptBR,
    timeZone: FUSO_MEDICA,
  });

export default async function PaginaImprimir({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: pacienteId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/pacientes/${pacienteId}/imprimir`);
  }

  const paciente = await prisma.paciente.findUnique({
    where: { id: pacienteId },
    include: {
      usuario: {
        select: { nome: true, email: true, telefone: true, nascimento: true, cpf: true },
      },
      registros: {
        where: { status: { in: ["ASSINADO", "RETIFICADO"] } },
        orderBy: [{ consulta: { inicioEm: "asc" } }, { versao: "asc" }],
        include: { consulta: { select: { inicioEm: true, modalidade: true } } },
      },
    },
  });

  if (!paciente) notFound();

  await prisma.auditoria.create({
    data: {
      usuarioId: sessao.user.id,
      acao: "EXPORTOU_DADOS",
      recursoId: pacienteId,
      detalhe: { formato: "pdf-impressao", registros: paciente.registros.length },
    },
  });

  const u = paciente.usuario;
  const idade = u.nascimento
    ? Math.floor((Date.now() - u.nascimento.getTime()) / (365.25 * 86_400_000))
    : null;

  return (
    <>
      {/* Estilo de impressão: A4, tipografia sóbria, some a barra de ações. */}
      <style>{`
        @page { size: A4; margin: 18mm 16mm; }
        @media print {
          .no-print { display: none !important; }
          .registro { break-inside: avoid; }
        }
        .doc { color: #111; }
      `}</style>

      <BotaoImprimir voltarHref={`/pacientes/${pacienteId}`} />

      <main className="doc mx-auto max-w-3xl bg-white px-6 py-8 font-serif text-[15px] leading-relaxed">
        {/* Cabeçalho da profissional */}
        <header className="border-b-2 border-slate-800 pb-4">
          <h1 className="text-xl font-bold">{env.NOME_MEDICA}</h1>
          <p className="text-sm">{env.CRM_MEDICA} · Medicina</p>
          <p className="mt-3 text-lg font-semibold">Registro Clínico — Prontuário do Paciente</p>
        </header>

        {/* Identificação do paciente */}
        <section className="mt-5 text-sm">
          <table className="w-full">
            <tbody>
              <tr>
                <td className="py-0.5 pr-4 font-semibold">Paciente</td>
                <td className="py-0.5">{u.nome}</td>
              </tr>
              {u.nascimento && (
                <tr>
                  <td className="py-0.5 pr-4 font-semibold">Nascimento</td>
                  <td className="py-0.5">
                    {dataSo(u.nascimento)}
                    {idade !== null && ` (${idade} anos)`}
                  </td>
                </tr>
              )}
              {u.cpf && (
                <tr>
                  <td className="py-0.5 pr-4 font-semibold">CPF</td>
                  <td className="py-0.5">{u.cpf}</td>
                </tr>
              )}
              <tr>
                <td className="py-0.5 pr-4 font-semibold">Contato</td>
                <td className="py-0.5">
                  {[u.telefone, u.email].filter(Boolean).join(" · ")}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Antecedentes persistentes */}
        {(paciente.alergias || paciente.medicacoesUso || paciente.antecedentes) && (
          <section className="mt-5 border-t border-slate-300 pt-4 text-sm">
            <h2 className="font-bold">Informações permanentes</h2>
            {paciente.alergias && (
              <p className="mt-1">
                <strong>Alergias:</strong> {paciente.alergias}
              </p>
            )}
            {paciente.medicacoesUso && (
              <p className="mt-1">
                <strong>Medicações em uso:</strong> {paciente.medicacoesUso}
              </p>
            )}
            {paciente.antecedentes && (
              <p className="mt-1">
                <strong>Antecedentes:</strong> {paciente.antecedentes}
              </p>
            )}
          </section>
        )}

        {/* Registros */}
        <section className="mt-6">
          <h2 className="border-t border-slate-300 pt-4 text-base font-bold">
            Evolução ({paciente.registros.length}{" "}
            {paciente.registros.length === 1 ? "registro" : "registros"})
          </h2>

          {paciente.registros.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              Nenhum registro assinado neste prontuário.
            </p>
          ) : (
            paciente.registros.map((r) => (
              <article key={r.id} className="registro mt-5 border border-slate-300 p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
                  <strong>
                    {dataSo(r.consulta.inicioEm)} ·{" "}
                    {r.consulta.modalidade === "TELECONSULTA"
                      ? "Teleconsulta"
                      : "Consulta presencial"}
                  </strong>
                  <span className="text-xs text-slate-500">
                    versão {r.versao}
                    {r.status === "RETIFICADO" && " · retificado"}
                  </span>
                </div>

                <Campo titulo="Queixa principal" texto={r.queixaPrincipal} />
                <Campo titulo="História da moléstia atual" texto={r.historiaMoleastiaAtual} />
                <Campo titulo="Antecedentes" texto={r.antecedentes} />
                <Campo titulo="Hipóteses diagnósticas" texto={r.hipotesesDiagnosticas} />
                <Campo titulo="Conduta e plano terapêutico" texto={r.conduta} />
                {r.observacoes && <Campo titulo="Observações" texto={r.observacoes} />}

                {r.origemIA && (
                  <p className="mt-3 text-xs italic text-slate-500">
                    Rascunho apoiado por assistente de anotação (IA), revisado e
                    editado pela médica antes da assinatura.
                  </p>
                )}

                {r.assinadoEm && (
                  <p className="mt-3 border-t border-slate-200 pt-2 text-xs">
                    Assinado eletronicamente por{" "}
                    <strong>{r.assinadoPor ?? env.CRM_MEDICA}</strong> em{" "}
                    {dataHora(r.assinadoEm)}.
                  </p>
                )}
              </article>
            ))
          )}
        </section>

        {/* Rodapé */}
        <footer className="mt-8 border-t border-slate-300 pt-4 text-xs text-slate-500">
          <p>
            Documento emitido em {dataHora(new Date())} a partir do prontuário
            eletrônico. Conteúdo protegido por sigilo médico (art. 73 do Código
            de Ética Médica e art. 154 do Código Penal) — o acesso e a
            circulação são restritos.
          </p>
        </footer>
      </main>
    </>
  );
}

function Campo({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {titulo}
      </p>
      <p className="mt-0.5 whitespace-pre-line">{texto}</p>
    </div>
  );
}
