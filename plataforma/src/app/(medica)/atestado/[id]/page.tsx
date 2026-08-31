/**
 * Edição e assinatura de um atestado. Rascunho: a médica escolhe modelo, ajusta
 * e assina. Já assinado: oferece imprimir e, se preciso, retificar (nova versão).
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { format, toZonedTime } from "date-fns-tz";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_MEDICA } from "@/lib/agenda";
import { EditorAtestado } from "@/components/atestado/EditorAtestado";
import { EnviarDocumentoPaciente } from "@/components/documentos/EnviarDocumentoPaciente";
import type { TipoAtestado } from "@/lib/documentos/modelos-atestado";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Atestado",
  robots: { index: false, follow: false },
};

export default async function PaginaAtestado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/atestado/${id}`);
  }

  const atestado = await prisma.atestado.findUnique({
    where: { id },
    include: { paciente: { include: { usuario: { select: { nome: true } } } } },
  });

  if (!atestado) notFound();
  if (atestado.medicaId !== sessao.user.id) redirect("/agenda");

  if (atestado.status === "RETIFICADO") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-serif text-xl text-slate-900">Atestado substituído</h1>
        <p className="mt-2 text-sm text-slate-600">
          Esta versão foi retificada por uma posterior. Abra o prontuário para ver a vigente.
        </p>
        <Link
          href={`/pacientes/${atestado.pacienteId}`}
          className="mt-6 inline-block rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Ir ao prontuário
        </Link>
      </main>
    );
  }

  const jaAssinada = atestado.status === "ASSINADO";
  const dataInicioISO = format(toZonedTime(atestado.dataInicio, FUSO_MEDICA), "yyyy-MM-dd", {
    timeZone: FUSO_MEDICA,
  });

  return (
    <>
      {jaAssinada && (
        <div className="border-b border-teal-200 bg-teal-50 px-4 py-3">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-teal-900">
              Atestado assinado. Edite abaixo apenas para <strong>retificar</strong>.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <EnviarDocumentoPaciente tipo="atestado" id={atestado.id} />
              <Link
                href={`/atestado/${atestado.id}/imprimir`}
                className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
              >
                Imprimir / PDF
              </Link>
            </div>
          </div>
        </div>
      )}

      <EditorAtestado
        atestadoId={atestado.id}
        nomePaciente={atestado.paciente.usuario.nome}
        jaAssinada={jaAssinada}
        iniciais={{
          tipo: atestado.tipo as TipoAtestado,
          diasAfastamento: atestado.diasAfastamento,
          cid: atestado.cid ?? "",
          dataInicio: dataInicioISO,
          textoLivre: atestado.textoLivre,
        }}
      />
    </>
  );
}
