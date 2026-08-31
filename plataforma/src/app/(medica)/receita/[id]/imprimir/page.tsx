/**
 * Via impressa da receita (branca).
 *
 * Documento entregável: o navegador imprime ou salva como PDF. Segue o modelo do
 * prontuário imprimível — sem Chromium no servidor, a paginação sai do navegador.
 *
 * Só imprime receita ASSINADA: rascunho não é receita. Medicamento controlado é
 * marcado e vem com aviso — esta via vale como receita simples, e controlado
 * exige receituário especial (será resolvido pela integração Memed/CFM na Fase 2).
 *
 * A exportação é registrada (EXPORTOU_DADOS): tirar cópia de prescrição é ato
 * que precisa de rastro.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ItemReceita } from "@/lib/receita-tipos";
import { ReceitaImpressa } from "@/components/documentos/ReceitaImpressa";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Receita — impressão",
  robots: { index: false, follow: false },
};

export default async function PaginaReceitaImprimir({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/receita/${id}/imprimir`);
  }

  const receita = await prisma.receita.findUnique({
    where: { id },
    include: {
      paciente: {
        include: { usuario: { select: { nome: true, cpf: true } } },
      },
    },
  });

  if (!receita) notFound();
  if (receita.medicaId !== sessao.user.id) redirect("/agenda");
  // Rascunho não é receita — manda revisar/assinar antes de imprimir.
  if (receita.status === "RASCUNHO") redirect(`/receita/${receita.id}`);

  await prisma.auditoria.create({
    data: {
      usuarioId: sessao.user.id,
      acao: "EXPORTOU_DADOS",
      recursoId: receita.id,
      detalhe: { tipo: "receita", formato: "pdf-impressao" },
    },
  });

  const u = receita.paciente.usuario;

  return (
    <ReceitaImpressa
      receita={{
        itens: (receita.itens as unknown as ItemReceita[]) ?? [],
        orientacoesGerais: receita.orientacoesGerais,
        temControlado: receita.temControlado,
        assinadaEm: receita.assinadaEm,
        assinadaPor: receita.assinadaPor,
        versao: receita.versao,
      }}
      paciente={{ nome: u.nome, cpf: u.cpf }}
      voltarHref={`/receita/${id}`}
    />
  );
}
