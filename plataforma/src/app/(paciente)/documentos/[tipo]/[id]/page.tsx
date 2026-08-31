/**
 * Documento clínico visto pelo paciente (entrega por link — Fase D).
 *
 * O paciente abre receita/atestado/solicitação de exames da própria consulta,
 * lê e salva em PDF (mesmo layout A4 que a médica imprime — os componentes de
 * `@/components/documentos` são a fonte única). A médica dispara o link por
 * e-mail; sem sessão o paciente cai em /entrar e volta pelo magic link.
 *
 * Posse: o documento só aparece se `paciente.usuarioId === sessao.user.id`.
 * Como nas outras telas do paciente, id inexistente ou de outra pessoa devolve
 * `notFound()` (404) — nunca 403 — para não confirmar a existência do id a um
 * estranho. Rascunho nunca é servido ao paciente. Toda abertura é auditada
 * (EXPORTOU_DADOS): entregar documento clínico precisa de rastro.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ItemReceita } from "@/lib/receita-tipos";
import type { ItemExame } from "@/lib/documentos/exames-comuns";
import { ReceitaImpressa } from "@/components/documentos/ReceitaImpressa";
import { AtestadoImpresso } from "@/components/documentos/AtestadoImpresso";
import { ExamesImpresso } from "@/components/documentos/ExamesImpresso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Documento",
  robots: { index: false, follow: false },
};

const TIPOS = ["receita", "atestado", "exames"] as const;
type Tipo = (typeof TIPOS)[number];

const VOLTAR = "/minhas-consultas";

const incluirPaciente = {
  paciente: { select: { usuarioId: true, usuario: { select: { nome: true, cpf: true } } } },
} as const;

async function registrarExport(usuarioId: string, tipo: Tipo, id: string) {
  await prisma.auditoria.create({
    data: {
      usuarioId,
      acao: "EXPORTOU_DADOS",
      recursoId: id,
      detalhe: { tipo, formato: "visualizacao-paciente" },
    },
  });
}

/** Faixa (só na tela) quando o documento aberto foi substituído por outra versão. */
function AvisoRetificado() {
  return (
    <div className="no-print mx-auto max-w-3xl px-6 pt-4">
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        Este documento foi <strong>substituído por uma versão mais recente</strong>.
        Peça à Dra. Laís a versão atual se precisar apresentá-lo.
      </p>
    </div>
  );
}

export default async function PaginaDocumentoPaciente({
  params,
}: {
  params: Promise<{ tipo: string; id: string }>;
}) {
  const { tipo, id } = await params;

  const sessao = await auth();
  if (!sessao?.user) {
    redirect(`/entrar?destino=/documentos/${tipo}/${id}`);
  }
  if (!TIPOS.includes(tipo as Tipo)) notFound();
  const usuarioId = sessao.user.id;

  if (tipo === "receita") {
    const receita = await prisma.receita.findUnique({ where: { id }, include: incluirPaciente });
    if (
      !receita ||
      receita.paciente.usuarioId !== usuarioId ||
      receita.status === "RASCUNHO"
    ) {
      notFound();
    }
    await registrarExport(usuarioId, "receita", receita.id);
    const u = receita.paciente.usuario;
    return (
      <>
        {receita.status === "RETIFICADO" && <AvisoRetificado />}
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
          voltarHref={VOLTAR}
        />
      </>
    );
  }

  if (tipo === "atestado") {
    const atestado = await prisma.atestado.findUnique({ where: { id }, include: incluirPaciente });
    if (
      !atestado ||
      atestado.paciente.usuarioId !== usuarioId ||
      atestado.status === "RASCUNHO"
    ) {
      notFound();
    }
    await registrarExport(usuarioId, "atestado", atestado.id);
    const u = atestado.paciente.usuario;
    return (
      <>
        {atestado.status === "RETIFICADO" && <AvisoRetificado />}
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
          voltarHref={VOLTAR}
        />
      </>
    );
  }

  // tipo === "exames"
  const solicitacao = await prisma.solicitacaoExame.findUnique({
    where: { id },
    include: incluirPaciente,
  });
  if (
    !solicitacao ||
    solicitacao.paciente.usuarioId !== usuarioId ||
    solicitacao.status === "RASCUNHO"
  ) {
    notFound();
  }
  await registrarExport(usuarioId, "exames", solicitacao.id);
  const u = solicitacao.paciente.usuario;
  return (
    <>
      {solicitacao.status === "RETIFICADO" && <AvisoRetificado />}
      <ExamesImpresso
        solicitacao={{
          itens: (solicitacao.itens as unknown as ItemExame[]) ?? [],
          indicacaoClinica: solicitacao.indicacaoClinica,
          assinadaEm: solicitacao.assinadaEm,
          assinadaPor: solicitacao.assinadaPor,
          versao: solicitacao.versao,
        }}
        paciente={{ nome: u.nome, cpf: u.cpf }}
        voltarHref={VOLTAR}
      />
    </>
  );
}
