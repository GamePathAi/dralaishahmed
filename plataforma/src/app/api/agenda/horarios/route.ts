/**
 * GET /api/agenda/horarios?de=&ate=&modalidade=&fuso=
 * Horários livres para o formulário de agendamento.
 *
 * Rota pública: quem ainda não tem conta precisa ver a agenda antes de decidir
 * se cria uma. Por isso ela devolve APENAS instantes livres — nunca nome de
 * paciente, motivo de consulta ou o que ocupa os horários indisponíveis.
 * Um horário ausente da lista não diz por que está ausente.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  horariosDisponiveis,
  agruparPorDia,
  FUSO_MEDICA,
  HORIZONTE_DIAS,
} from "@/lib/agenda";
import { consumir } from "@/lib/rate-limit";
import { ipDoPedido } from "@/lib/pedido";

const Consulta = z.object({
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  modalidade: z.enum(["TELECONSULTA", "PRESENCIAL"]).optional(),
  fuso: z.string().max(64).optional(),
});

const JANELA_MAX_MS = 62 * 86_400_000; // teto de ~2 meses por consulta

/**
 * O fuso chega do navegador do paciente e é usado para formatar rótulos e
 * agrupar por dia. Um valor que não seja uma zona IANA real (ex.: "undefined",
 * "Foo/Bar") faz `Intl`/date-fns-tz lançarem RangeError lá dentro — e a grade
 * inteira vira 500 em vez de cair no fuso da clínica. Validar aqui transforma
 * lixo em fallback silencioso.
 */
function fusoValido(tz: string): boolean {
  try {
    // Constrói um formatador com a zona: zona inválida lança aqui.
    new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  // Rota pública e cara (varre disponibilidade + consultas). Sem limite, é
  // scraping/DoS de CPU e banco. 30 req/min por IP cobre navegação real.
  const limite = consumir(`horarios:${ipDoPedido(req) ?? "sem-ip"}`, 30, 60_000);
  if (!limite.ok) {
    return NextResponse.json(
      { erro: "Muitas requisições. Aguarde um instante." },
      { status: 429, headers: { "Retry-After": String(limite.esperaSeg) } },
    );
  }

  const analise = Consulta.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!analise.success) {
    return NextResponse.json({ erro: "Parâmetros inválidos." }, { status: 400 });
  }
  const { modalidade } = analise.data;
  // Zona inválida cai no fuso da clínica em vez de derrubar a grade com 500.
  const fusoPaciente =
    analise.data.fuso && fusoValido(analise.data.fuso)
      ? analise.data.fuso
      : FUSO_MEDICA;

  // PRESENCIAL é sempre exibido no fuso DA CLÍNICA: o paciente vai ao local
  // físico, então "14:00" tem que ser 14:00 lá, não no fuso do celular dele.
  // TELECONSULTA fica no fuso do paciente, que entra de onde estiver.
  const fusoExibicao = modalidade === "PRESENCIAL" ? FUSO_MEDICA : fusoPaciente;
  const fusoDaClinica = fusoExibicao === FUSO_MEDICA;

  const medica = await prisma.usuario.findFirst({
    where: { papel: "MEDICA" },
    select: { id: true },
  });
  if (!medica) {
    return NextResponse.json({ erro: "Agenda indisponível." }, { status: 503 });
  }

  const de = analise.data.de ?? new Date();
  // Janela padrão = horizonte de agendamento inteiro (60 dias). Antes eram 30,
  // e vagas entre 30 e 60 dias existiam na agenda mas nunca apareciam para o
  // paciente. A lib ainda corta em HORIZONTE_DIAS, então isto não expande nada
  // além do que já é agendável.
  let ate =
    analise.data.ate ?? new Date(de.getTime() + HORIZONTE_DIAS * 86_400_000);
  // Teto na janela: um `ate` remoto forçaria uma varredura enorme.
  if (ate.getTime() - de.getTime() > JANELA_MAX_MS) {
    ate = new Date(de.getTime() + JANELA_MAX_MS);
  }

  const horarios = await horariosDisponiveis({
    medicaId: medica.id,
    de,
    ate,
    modalidade,
    fusoPaciente: fusoExibicao,
  });

  return NextResponse.json({
    fuso: fusoExibicao,
    // Diz ao cliente se os horários estão no fuso da clínica (presencial) para
    // ele rotular corretamente ("horário da clínica" vs "seu horário").
    fusoDaClinica,
    dias: agruparPorDia(horarios, fusoExibicao),
    total: horarios.length,
  });
}
