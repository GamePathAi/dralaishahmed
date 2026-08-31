/**
 * Lista de pacientes.
 *
 * Existia um prontuário por paciente e nenhuma porta para ele: a única forma de
 * abrir `/pacientes/[id]` era a partir de um atendimento em curso. Concluída a
 * consulta, o botão "Atender" some — e com ele o caminho inteiro. O prontuário
 * ficava escrito, assinado e inalcançável.
 *
 * Esta tela é a porta. Busca por nome, e-mail ou telefone, porque a médica
 * lembra do paciente, não do id da consulta.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const FUSO_MEDICA = "America/Campo_Grande";

export const metadata = { title: "Pacientes" };
export const dynamic = "force-dynamic";

export default async function PaginaPacientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") redirect("/entrar");

  const { q } = await searchParams;
  const busca = q?.trim() ?? "";

  const pacientes = await prisma.paciente.findMany({
    where: {
      // Só quem já teve consulta com ela. Não é uma lista de todo mundo no
      // banco: sem vínculo assistencial, não há razão para acesso.
      consultas: { some: { medicaId: sessao.user.id } },
      ...(busca
        ? {
            usuario: {
              OR: [
                { nome: { contains: busca, mode: "insensitive" } },
                { email: { contains: busca, mode: "insensitive" } },
                { telefone: { contains: busca } },
              ],
            },
          }
        : {}),
    },
    select: {
      id: true,
      usuario: { select: { nome: true, email: true, telefone: true } },
      consultas: {
        where: { medicaId: sessao.user.id },
        orderBy: { inicioEm: "desc" },
        take: 1,
        select: { inicioEm: true, status: true },
      },
      _count: { select: { registros: true } },
    },
    orderBy: { usuario: { nome: "asc" } },
    take: 100,
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-slate-900">Pacientes</h1>
          <p className="mt-1 text-sm text-slate-600">
            {pacientes.length === 100
              ? "Mostrando os 100 primeiros — refine a busca."
              : `${pacientes.length} paciente${pacientes.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link
          href="/agenda"
          className="rounded-lg px-3 py-2 text-sm text-teal-800 hover:bg-teal-50"
        >
          ← Agenda
        </Link>
      </header>

      <form className="mt-5 flex gap-2">
        <input
          name="q"
          defaultValue={busca}
          placeholder="Nome, e-mail ou telefone"
          aria-label="Buscar paciente"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
        />
        <button
          type="submit"
          className="rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Buscar
        </button>
        {busca && (
          <Link
            href="/pacientes"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Limpar
          </Link>
        )}
      </form>

      {pacientes.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          {busca
            ? `Nenhum paciente encontrado para "${busca}".`
            : "Nenhum paciente ainda. Eles aparecem aqui após a primeira consulta."}
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {pacientes.map((p) => {
            const ultima = p.consultas[0];
            return (
              <li key={p.id}>
                <Link
                  href={`/pacientes/${p.id}`}
                  className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {p.usuario.nome}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {p.usuario.email}
                      {p.usuario.telefone && ` · ${p.usuario.telefone}`}
                    </p>
                  </div>

                  <div className="shrink-0 text-right text-sm">
                    {ultima && (
                      <p className="text-slate-600">
                        Última:{" "}
                        {format(ultima.inicioEm, "d 'de' MMM 'de' yyyy", {
                          locale: ptBR,
                          timeZone: FUSO_MEDICA,
                        })}
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      {p._count.registros === 0
                        ? "sem registro"
                        : `${p._count.registros} registro${p._count.registros === 1 ? "" : "s"}`}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
