/**
 * Via impressa da solicitação de exames. Navegador imprime/salva PDF (sem
 * Chromium no servidor). Só imprime ASSINADA. Exportação registrada (EXPORTOU_DADOS).
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ExamesImpresso } from "@/components/documentos/ExamesImpresso";
import { type ItemExame } from "@/lib/documentos/exames-comuns";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Exames — impressão",
  robots: { index: false, follow: false },
};

export default async function PaginaExamesImprimir({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/exames/${id}/imprimir`);
  }

  const solicitacao = await prisma.solicitacaoExame.findUnique({
    where: { id },
    include: { paciente: { include: { usuario: { select: { nome: true, cpf: true } } } } },
  });

  if (!solicitacao) notFound();
  if (solicitacao.medicaId !== sessao.user.id) redirect("/agenda");
  if (solicitacao.status === "RASCUNHO") redirect(`/exames/${solicitacao.id}`);

  await prisma.auditoria.create({
    data: {
      usuarioId: sessao.user.id,
      acao: "EXPORTOU_DADOS",
      recursoId: solicitacao.id,
      detalhe: { tipo: "exames", formato: "pdf-impressao" },
    },
  });

  const u = solicitacao.paciente.usuario;

  return (
    <ExamesImpresso
      solicitacao={{
        itens: (solicitacao.itens as unknown as ItemExame[]) ?? [],
        indicacaoClinica: solicitacao.indicacaoClinica,
        assinadaEm: solicitacao.assinadaEm,
        assinadaPor: solicitacao.assinadaPor,
        versao: solicitacao.versao,
      }}
      paciente={{ nome: u.nome, cpf: u.cpf }}
      voltarHref={`/exames/${id}`}
    />
  );
}
