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
import { toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { FUSO_MEDICA } from "@/lib/agenda";
import type { ItemReceita } from "@/lib/receita-tipos";
import { BotaoImprimir } from "@/components/prontuario/BotaoImprimir";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Receita — impressão",
  robots: { index: false, follow: false },
};

const dataHora = (d: Date) =>
  format(toZonedTime(d, FUSO_MEDICA), "dd/MM/yyyy 'às' HH:mm", {
    locale: ptBR,
    timeZone: FUSO_MEDICA,
  });

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

  const itens = (receita.itens as unknown as ItemReceita[]) ?? [];
  const u = receita.paciente.usuario;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 20mm 18mm; }
        @media print {
          .no-print { display: none !important; }
          .item { break-inside: avoid; }
        }
        .doc { color: #111; }
      `}</style>

      <BotaoImprimir voltarHref={`/receita/${id}`} />

      <main className="doc mx-auto max-w-3xl bg-white px-6 py-8 font-serif text-[15px] leading-relaxed">
        {/* Cabeçalho da profissional */}
        <header className="border-b-2 border-slate-800 pb-4 text-center">
          <h1 className="text-xl font-bold">{env.NOME_MEDICA}</h1>
          <p className="text-sm">{env.CRM_MEDICA} · Medicina</p>
          {env.ENDERECO_MEDICA ? (
            <p className="mt-1 text-xs">{env.ENDERECO_MEDICA}</p>
          ) : (
            <p className="no-print mt-1 text-xs italic text-amber-700">
              Endereço profissional não configurado (ENDERECO_MEDICA) — exigido no
              receituário.
            </p>
          )}
          <p className="mt-3 text-lg font-semibold">Receituário</p>
        </header>

        {/* Paciente */}
        <section className="mt-5 text-sm">
          <p>
            <strong>Paciente:</strong> {u.nome}
            {u.cpf && <> · CPF {u.cpf}</>}
          </p>
        </section>

        {/* Itens */}
        <section className="mt-6 space-y-4">
          {itens.map((item, i) => (
            <article key={i} className="item border-b border-slate-200 pb-3">
              <p className="font-semibold">
                {i + 1}. {item.medicamento}
                {item.concentracao ? ` ${item.concentracao}` : ""}
                {item.formaFarmaceutica ? ` — ${item.formaFarmaceutica}` : ""}
                {item.quantidade ? `  (${item.quantidade})` : ""}
                {item.controlado && (
                  <span className="ml-2 text-xs font-bold text-red-700">
                    [CONTROLE ESPECIAL]
                  </span>
                )}
              </p>
              <p className="mt-0.5 pl-4 text-sm">
                {[item.via, item.posologia].filter(Boolean).join(" — ")}
                {item.duracao ? ` · ${item.duracao}` : ""}
              </p>
              {item.observacao && (
                <p className="mt-0.5 pl-4 text-xs italic text-slate-600">
                  {item.observacao}
                </p>
              )}
            </article>
          ))}
        </section>

        {receita.orientacoesGerais && (
          <section className="mt-5 text-sm">
            <p className="font-semibold">Orientações</p>
            <p className="mt-0.5 whitespace-pre-line">{receita.orientacoesGerais}</p>
          </section>
        )}

        {receita.temControlado && (
          <p className="mt-5 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
            Esta via contém item(ns) de <strong>controle especial</strong>. Receita
            simples não é suficiente para dispensá-los — emita-os em receituário
            especial (Notificação de Receita / controle especial) conforme a
            Portaria SVS/MS 344/98.
          </p>
        )}

        {/* Data + assinatura */}
        <section className="mt-10 text-sm">
          <p>
            {receita.assinadaEm
              ? `Emitida em ${dataHora(receita.assinadaEm)}`
              : `Emitida em ${dataHora(new Date())}`}
            {receita.versao > 1 && ` · versão ${receita.versao}`}
          </p>
          <div className="mt-10 text-center">
            <div className="mx-auto w-64 border-t border-slate-800 pt-1">
              <p className="text-sm font-semibold">{env.NOME_MEDICA}</p>
              <p className="text-xs">
                {receita.assinadaPor ?? env.CRM_MEDICA}
              </p>
            </div>
          </div>
        </section>

        <footer className="mt-8 border-t border-slate-300 pt-4 text-xs text-slate-500">
          <p>
            Documento gerado a partir do prontuário eletrônico. A assinatura digital
            com validade jurídica (ICP-Brasil) e a dispensação de controlados são
            tratadas na integração de prescrição eletrônica.
          </p>
        </footer>
      </main>
    </>
  );
}
