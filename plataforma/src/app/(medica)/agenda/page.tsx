/**
 * Agenda da médica — visão do dia.
 *
 * Server Component: a consulta ao banco acontece no servidor e o HTML já chega
 * pronto. Dado de paciente nunca transita como JSON para o cliente aqui, o que
 * elimina a chance de vazar por um endpoint de API mal protegido.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { addDays, startOfDay, endOfDay } from "date-fns";
import { toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PacientesAguardando } from "@/components/agenda/PacientesAguardando";
import { EnviarLinkPaciente } from "@/components/agenda/EnviarLinkPaciente";
import { NovaConsultaMedica } from "@/components/agenda/NovaConsultaMedica";
import { FUSO_MEDICA, FOLGA_ENCERRAMENTO_MIN } from "@/lib/agenda";
import { env } from "@/lib/env";
import type { StatusConsulta } from "@prisma/client";

export const dynamic = "force-dynamic";

const CORES: Record<StatusConsulta, string> = {
  AGUARDANDO_PAGAMENTO: "bg-amber-50 text-amber-800",
  AGENDADA: "bg-slate-100 text-slate-700",
  CONFIRMADA: "bg-teal-50 text-teal-800",
  EM_ANDAMENTO: "bg-amber-100 text-amber-900",
  CONCLUIDA: "bg-slate-50 text-slate-500",
  CANCELADA: "bg-red-50 text-red-700",
  FALTOU: "bg-red-50 text-red-700",
};

const ROTULOS: Record<StatusConsulta, string> = {
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  AGENDADA: "Agendada",
  CONFIRMADA: "Confirmada",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
  FALTOU: "Faltou",
};

export default async function PaginaAgenda({
  searchParams,
}: {
  searchParams: Promise<{ dia?: string }>;
}) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") redirect("/entrar");

  const { dia } = await searchParams;
  const referencia = dia ? new Date(`${dia}T12:00:00`) : new Date();

  const consultas = await prisma.consulta.findMany({
    where: {
      medicaId: sessao.user.id,
      inicioEm: { gte: startOfDay(referencia), lte: endOfDay(referencia) },
    },
    orderBy: { inicioEm: "asc" },
    include: {
      paciente: { include: { usuario: { select: { nome: true, telefone: true } } } },
      // Sinaliza se o registro da consulta já foi assinado.
      registros: { select: { status: true }, orderBy: { versao: "desc" }, take: 1 },
    },
  });

  const chave = (d: Date) => format(d, "yyyy-MM-dd", { timeZone: FUSO_MEDICA });
  const ativas = consultas.filter(
    (c) => c.status !== "CANCELADA" && c.status !== "FALTOU",
  );
  const naoAvisados = ativas.filter((c) => !c.confirmacaoEnviadaEm);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-slate-900">Agenda</h1>
          <p className="mt-1 text-sm capitalize text-slate-600">
            {format(toZonedTime(referencia, FUSO_MEDICA), "EEEE, d 'de' MMMM 'de' yyyy", {
              locale: ptBR,
              timeZone: FUSO_MEDICA,
            })}
          </p>
        </div>

        <nav className="flex items-center gap-1">
          <Link
            href={`/agenda?dia=${chave(addDays(referencia, -1))}`}
            className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            ← Anterior
          </Link>
          <Link
            href="/agenda"
            className="rounded-lg px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50"
          >
            Hoje
          </Link>
          <Link
            href={`/agenda?dia=${chave(addDays(referencia, 1))}`}
            className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Próximo →
          </Link>
          {/* Pacientes, Disponibilidade, Configurações e Segurança vivem na barra
              do painel (NavMedica). Aqui ficam só os controles de data. */}
        </nav>
      </header>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {ativas.length === 0
            ? "Nenhuma consulta neste dia."
            : `${ativas.length} consulta${ativas.length > 1 ? "s" : ""} — ${
                ativas.filter((c) => c.modalidade === "TELECONSULTA").length
              } por vídeo.`}
        </p>
        <NovaConsultaMedica podeCobrarPix={env.PAGAMENTO_ATIVO} />
      </div>

      {/* Paciente na sala vem antes de tudo: é a única coisa aqui que tem
          alguém do outro lado esperando resposta agora. */}
      <PacientesAguardando />

      {/* Acima da lista, não dentro dela: se o e-mail caiu, quem precisa de
          telefonema tem que aparecer antes de a médica começar a rolar a tela. */}
      {naoAvisados.length > 0 && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>
            {naoAvisados.length} paciente{naoAvisados.length > 1 ? "s" : ""} sem
            confirmação enviada
          </strong>{" "}
          — {naoAvisados.length > 1 ? "eles não sabem" : "ele não sabe"} que
          tem consulta marcada. Estão destacados abaixo, com telefone.
        </p>
      )}

      <ul className="mt-5 space-y-2.5">
        {consultas.map((c) => {
          const cancelada = c.status === "CANCELADA" || c.status === "FALTOU";
          const registro = c.registros[0];
          const pendente =
            c.status === "CONCLUIDA" && registro?.status !== "ASSINADO";
          // Agendou, mas a confirmação não saiu. Esta pessoa não sabe que tem
          // consulta marcada — a menos que alguém ligue.
          const naoAvisado = !cancelada && !c.confirmacaoEnviadaEm;

          // `EM_ANDAMENTO` é grudento: a consulta entra nesse estado quando a
          // médica abre a sala e só sai dele ao assinar o registro. Fechar a
          // aba, cair a conexão ou só espiar a sala deixa a consulta "em
          // andamento" para sempre — com um botão "Atender" apontando para uma
          // sala que já expirou.
          //
          // A janela da sala é a fonte da verdade: passou dela, aquilo não está
          // acontecendo, independentemente do que diz a coluna `status`.
          const fimDaJanela =
            c.inicioEm.getTime() + (c.duracaoMin + FOLGA_ENCERRAMENTO_MIN) * 60_000;
          const naoEncerrada =
            c.status === "EM_ANDAMENTO" && Date.now() > fimDaJanela;
          const emCurso = c.status === "EM_ANDAMENTO" && !naoEncerrada;

          return (
            <li
              key={c.id}
              className={`flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 ${
                cancelada ? "opacity-55" : ""
              }`}
            >
              <time className="w-16 shrink-0 font-mono text-lg tabular-nums text-slate-900">
                {format(toZonedTime(c.inicioEm, FUSO_MEDICA), "HH:mm", {
                  timeZone: FUSO_MEDICA,
                })}
              </time>

              <div className="min-w-0 flex-1">
                {/* O nome é a porta do prontuário. Antes desta linha, uma
                    consulta concluída não tinha nenhum caminho de volta ao
                    registro que a médica acabara de assinar. */}
                <Link
                  href={`/pacientes/${c.pacienteId}`}
                  className="truncate font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-teal-700"
                >
                  {c.paciente.usuario.nome}
                </Link>
                <p className="truncate text-sm text-slate-500">
                  {c.modalidade === "TELECONSULTA" ? "Teleconsulta" : "Presencial"} ·{" "}
                  {c.duracaoMin} min
                  {c.motivo && ` · ${c.motivo}`}
                </p>
                {naoEncerrada && (
                  <p className="mt-1 text-sm text-amber-800">
                    A sala foi aberta mas a consulta não foi encerrada. Registre
                    o atendimento para concluí-la.
                  </p>
                )}
                {naoAvisado && (
                  <p className="mt-1 text-sm text-red-700">
                    Confirmação não enviada — este paciente não foi avisado.
                    {c.paciente.usuario.telefone && (
                      <>
                        {" "}
                        <a
                          href={`tel:${c.paciente.usuario.telefone.replace(/\D/g, "")}`}
                          className="font-medium underline underline-offset-2"
                        >
                          {c.paciente.usuario.telefone}
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {naoAvisado && (
                  <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
                    não avisado
                  </span>
                )}
                {pendente && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                    registro pendente
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    naoEncerrada
                      ? "bg-amber-100 text-amber-900"
                      : CORES[c.status]
                  }`}
                >
                  {naoEncerrada ? "não encerrada" : ROTULOS[c.status]}
                </span>

                {/* Enviar/reenviar o link da sala ao paciente. Só teleconsulta
                    ativa — presencial não tem sala; encerrada não precisa. */}
                {c.modalidade === "TELECONSULTA" &&
                  !cancelada &&
                  c.status !== "CONCLUIDA" &&
                  !naoEncerrada && (
                    <EnviarLinkPaciente
                      consultaId={c.id}
                      enviadoEmInicial={c.lembreteEnviadoEm?.toISOString() ?? null}
                    />
                  )}

                {/* "Atender" só quando há sala de verdade para entrar. Depois
                    da janela, o que resta é registrar o que aconteceu. */}
                {!cancelada && c.status !== "CONCLUIDA" && !naoEncerrada && (
                  <Link
                    href={`/atendimento/${c.id}`}
                    className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
                  >
                    {emCurso ? "Voltar à sala" : "Atender"}
                  </Link>
                )}
                {(pendente || naoEncerrada) && (
                  <Link
                    href={`/atendimento/${c.id}/registro`}
                    className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-50"
                  >
                    Concluir registro
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {consultas.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
          Dia livre.
        </div>
      )}
    </main>
  );
}
