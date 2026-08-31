/**
 * Revisão e assinatura de uma receita.
 *
 * Rascunho da IA: a médica edita e assina aqui. Já assinada: a tela oferece
 * imprimir e, se preciso, retificar (que cria nova versão — a receita assinada
 * nunca é editada no lugar).
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ItemReceita } from "@/lib/receita-tipos";
import { EditorReceita } from "@/components/receita/EditorReceita";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Receita",
  robots: { index: false, follow: false },
};

export default async function PaginaReceita({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/receita/${id}`);
  }

  const receita = await prisma.receita.findUnique({
    where: { id },
    include: {
      paciente: { include: { usuario: { select: { nome: true } } } },
    },
  });

  if (!receita) notFound();
  if (receita.medicaId !== sessao.user.id) redirect("/agenda");

  const itens = (receita.itens as unknown as ItemReceita[]) ?? [];
  const rascunho = receita.rascunhoIA as { pontosParaRevisao?: string[] } | null;
  const pontos = Array.isArray(rascunho?.pontosParaRevisao)
    ? rascunho!.pontosParaRevisao!
    : [];

  // Versão superada: não se edita uma retificada; manda para o prontuário.
  if (receita.status === "RETIFICADO") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-serif text-xl text-slate-900">Receita substituída</h1>
        <p className="mt-2 text-sm text-slate-600">
          Esta versão foi retificada por uma posterior. Abra o prontuário do
          paciente para ver a receita vigente.
        </p>
        <Link
          href={`/pacientes/${receita.pacienteId}`}
          className="mt-6 inline-block rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Ir ao prontuário
        </Link>
      </main>
    );
  }

  const jaAssinada = receita.status === "ASSINADO";

  return (
    <>
      {jaAssinada && (
        <div className="border-b border-teal-200 bg-teal-50 px-4 py-3">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-teal-900">
              Receita assinada. Edite abaixo apenas para <strong>retificar</strong>.
            </p>
            <Link
              href={`/receita/${receita.id}/imprimir`}
              className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
            >
              Imprimir / PDF
            </Link>
          </div>
        </div>
      )}

      <EditorReceita
        receitaId={receita.id}
        itensIniciais={itens}
        orientacoesIniciais={receita.orientacoesGerais ?? ""}
        nomePaciente={receita.paciente.usuario.nome}
        jaAssinada={jaAssinada}
        pontosParaRevisao={pontos}
      />
    </>
  );
}
