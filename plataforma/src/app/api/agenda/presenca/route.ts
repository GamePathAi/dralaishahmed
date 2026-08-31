/**
 * GET /api/agenda/presenca — quem está esperando numa sala agora.
 *
 * A agenda mostrava a consulta e nada mais. Um paciente podia entrar 15 minutos
 * antes, esperar, e a médica não tinha como saber — a menos que abrisse cada
 * consulta uma a uma para conferir. Numa teleconsulta, "o paciente chegou" é a
 * informação mais urgente da tela, e ela simplesmente não existia.
 *
 * A fonte é a presença ao vivo da Daily, não a nossa auditoria: `ENTROU_NA_SALA`
 * registra que alguém pediu acesso em algum momento, o que não é a mesma coisa
 * que estar lá agora. Um paciente que entrou e desistiu apareceria como
 * presente para sempre.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

interface ParticipanteDaily {
  userId?: string;
  userName?: string;
  joinTime?: string;
  duration?: number;
}

export async function GET() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  let presenca: Record<string, ParticipanteDaily[]> = {};
  try {
    const r = await fetch("https://api.daily.co/v1/presence", {
      headers: { Authorization: `Bearer ${env.DAILY_API_KEY}` },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`Daily ${r.status}`);
    presenca = (await r.json()) as Record<string, ParticipanteDaily[]>;
  } catch (erro) {
    // A agenda não pode quebrar porque a Daily oscilou. Sem presença, a tela
    // apenas deixa de mostrar o aviso — o resto continua funcionando.
    console.error("[presenca] Daily indisponível", erro);
    return NextResponse.json({ aguardando: [], indisponivel: true });
  }

  // Só salas nossas, e só as que têm alguém dentro.
  const ocupadas = Object.entries(presenca)
    .filter(([sala, gente]) => sala.startsWith("consulta-") && gente?.length)
    .map(([sala, gente]) => ({
      consultaId: sala.replace(/^consulta-/, ""),
      gente,
    }));

  if (ocupadas.length === 0) {
    return NextResponse.json({ aguardando: [] });
  }

  const consultas = await prisma.consulta.findMany({
    where: {
      id: { in: ocupadas.map((o) => o.consultaId) },
      medicaId: sessao.user.id, // nunca expõe sala de outra agenda
      status: { notIn: ["CANCELADA", "FALTOU", "CONCLUIDA"] },
    },
    select: {
      id: true,
      inicioEm: true,
      duracaoMin: true,
      paciente: { select: { usuario: { select: { nome: true } } } },
    },
  });

  const aguardando = consultas
    .map((c) => {
      const sala = ocupadas.find((o) => o.consultaId === c.id)!;

      // Qualquer participante que não seja a médica é o paciente. Comparar
      // pelo id evita depender do nome exibido, que a Daily pode truncar.
      const doPaciente = sala.gente.filter(
        (p) => p.userId && p.userId !== sessao.user.id,
      );
      if (doPaciente.length === 0) return null;

      const medicaPresente = sala.gente.some((p) => p.userId === sessao.user.id);
      const entradas = doPaciente
        .map((p) => p.joinTime)
        .filter((t): t is string => !!t)
        .sort();

      return {
        consultaId: c.id,
        paciente: c.paciente.usuario.nome,
        inicioEm: c.inicioEm.toISOString(),
        desde: entradas[0] ?? null,
        // Se a médica já está lá, não é "aguardando" — é consulta em curso.
        medicaPresente,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ aguardando });
}
