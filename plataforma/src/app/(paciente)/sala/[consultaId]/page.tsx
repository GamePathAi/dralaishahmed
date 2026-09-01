/**
 * Sala do paciente.
 *
 * A checagem de autorização acontece DUAS vezes: aqui, para não renderizar a
 * tela de quem não deveria vê-la, e de novo na rota que emite o token. Esta
 * primeira é conveniência (mensagem melhor, sem tela piscando); a segunda é a
 * que vale — quem chamasse a API direto passaria por cima desta.
 */

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EntradaSala } from "@/components/sala/EntradaSala";
import { BotaoTrocarConta } from "@/components/paciente/BotaoTrocarConta";

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

  // Consulta que não é desta conta (ou não existe): a MESMA resposta para os
  // dois casos não confirma a existência do id a estranho. Mas, em vez de um 404
  // seco, orienta o paciente legítimo que abriu o link já logado em OUTRA conta
  // (sessão antiga, dois e-mails, aparelho compartilhado) — o caso real que
  // deixava a pessoa travada sem entender. A NavPaciente some em /sala, então o
  // botão de trocar de conta vem aqui.
  if (!consulta || consulta.paciente.usuarioId !== sessao.user.id) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-950 px-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-slate-800 text-xl">
            🔒
          </div>
          <h1 className="font-serif text-xl text-white">
            Consulta não encontrada nesta conta
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Você está conectado como{" "}
            <strong className="text-slate-200">
              {sessao.user.email ?? "este e-mail"}
            </strong>
            , e não há uma consulta sua neste endereço.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Se agendou com outro e-mail, saia e entre com o mesmo que recebeu a
            mensagem de confirmação.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <BotaoTrocarConta destino={`/sala/${consultaId}`} />
            <Link
              href="/minhas-consultas"
              className="rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-900"
            >
              Ver minhas consultas
            </Link>
          </div>
        </div>
      </div>
    );
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
