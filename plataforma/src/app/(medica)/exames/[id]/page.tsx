/**
 * Edição e assinatura de uma solicitação de exames. Rascunho: a médica marca e
 * assina. Já assinada: oferece imprimir e, se preciso, retificar (nova versão).
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EditorExames } from "@/components/exames/EditorExames";
import { EnviarDocumentoPaciente } from "@/components/documentos/EnviarDocumentoPaciente";
import type { ItemExame } from "@/lib/documentos/exames-comuns";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Solicitação de exames",
  robots: { index: false, follow: false },
};

export default async function PaginaExames({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/exames/${id}`);
  }

  const solicitacao = await prisma.solicitacaoExame.findUnique({
    where: { id },
    include: { paciente: { include: { usuario: { select: { nome: true } } } } },
  });

  if (!solicitacao) notFound();
  if (solicitacao.medicaId !== sessao.user.id) redirect("/agenda");

  if (solicitacao.status === "RETIFICADO") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-serif text-xl text-slate-900">Solicitação substituída</h1>
        <p className="mt-2 text-sm text-slate-600">
          Esta versão foi retificada por uma posterior. Abra o prontuário para ver a vigente.
        </p>
        <Link
          href={`/pacientes/${solicitacao.pacienteId}`}
          className="mt-6 inline-block rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Ir ao prontuário
        </Link>
      </main>
    );
  }

  const jaAssinada = solicitacao.status === "ASSINADO";
  const itens = (solicitacao.itens as unknown as ItemExame[]) ?? [];

  return (
    <>
      {jaAssinada && (
        <div className="border-b border-teal-200 bg-teal-50 px-4 py-3">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-teal-900">
              Solicitação assinada. Edite abaixo apenas para <strong>retificar</strong>.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <EnviarDocumentoPaciente tipo="exames" id={solicitacao.id} />
              <Link
                href={`/exames/${solicitacao.id}/imprimir`}
                className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
              >
                Imprimir / PDF
              </Link>
            </div>
          </div>
        </div>
      )}

      <EditorExames
        solicitacaoId={solicitacao.id}
        nomePaciente={solicitacao.paciente.usuario.nome}
        jaAssinada={jaAssinada}
        itensIniciais={itens}
        indicacaoInicial={solicitacao.indicacaoClinica ?? ""}
      />
    </>
  );
}
