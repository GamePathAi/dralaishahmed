/**
 * Via impressa do atestado. O navegador imprime/salva como PDF (sem Chromium no
 * servidor). Só imprime ASSINADO (rascunho não é atestado). A exportação é
 * registrada (EXPORTOU_DADOS).
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AtestadoImpresso } from "@/components/documentos/AtestadoImpresso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Atestado — impressão",
  robots: { index: false, follow: false },
};

export default async function PaginaAtestadoImprimir({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect(`/entrar?destino=/atestado/${id}/imprimir`);
  }

  const atestado = await prisma.atestado.findUnique({
    where: { id },
    include: { paciente: { include: { usuario: { select: { nome: true, cpf: true } } } } },
  });

  if (!atestado) notFound();
  if (atestado.medicaId !== sessao.user.id) redirect("/agenda");
  if (atestado.status === "RASCUNHO") redirect(`/atestado/${atestado.id}`);

  await prisma.auditoria.create({
    data: {
      usuarioId: sessao.user.id,
      acao: "EXPORTOU_DADOS",
      recursoId: atestado.id,
      detalhe: { tipo: "atestado", formato: "pdf-impressao" },
    },
  });

  const u = atestado.paciente.usuario;

  return (
    <AtestadoImpresso
      atestado={{
        textoLivre: atestado.textoLivre,
        tipo: atestado.tipo,
        diasAfastamento: atestado.diasAfastamento,
        dataInicio: atestado.dataInicio,
        cid: atestado.cid,
        assinadaEm: atestado.assinadaEm,
        assinadaPor: atestado.assinadaPor,
        versao: atestado.versao,
      }}
      paciente={{ nome: u.nome, cpf: u.cpf }}
      voltarHref={`/atestado/${id}`}
    />
  );
}
