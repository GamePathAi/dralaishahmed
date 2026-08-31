/**
 * Sala do paciente.
 *
 * A checagem de autorização acontece DUAS vezes: aqui, para não renderizar a
 * tela de quem não deveria vê-la, e de novo na rota que emite o token. Esta
 * primeira é conveniência (mensagem melhor, sem tela piscando); a segunda é a
 * que vale — quem chamasse a API direto passaria por cima desta.
 */

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EntradaSala } from "@/components/sala/EntradaSala";

export const dynamic = "force-dynamic";

// Sala de consulta não entra em índice de busca nem em preview de link.
export const metadata: Metadata = {
  title: "Sala de teleconsulta",
  robots: { index: false, follow: false },
};

export default async function PaginaSalaPaciente({
  params,
}: {
  params: Promise<{ consultaId: string }>;
}) {
  const { consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user) {
    redirect(`/entrar?destino=/sala/${consultaId}`);
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: {
      modalidade: true,
      paciente: { select: { usuarioId: true } },
    },
  });

  // 404 em vez de 403 para consulta de outra pessoa: um 403 confirmaria que
  // aquele id existe, o que já é informação a mais.
  if (!consulta || consulta.paciente.usuarioId !== sessao.user.id) {
    notFound();
  }

  if (consulta.modalidade === "PRESENCIAL") {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-950 px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-serif text-xl text-white">Consulta presencial</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Esta consulta não acontece por vídeo. Compareça ao endereço informado
            na confirmação.
          </p>
        </div>
      </div>
    );
  }

  return <EntradaSala consultaId={consultaId} />;
}
