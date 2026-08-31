/**
 * POST /api/consultas/[id]/enviar-link
 * A médica dispara, na hora, o link de acesso à sala para o paciente.
 *
 * Complementa o cron (que envia ~15 min antes automaticamente): quando o
 * paciente diz que não recebeu, ou a médica quer adiantar, este é o botão.
 * Marca `lembreteEnviadoEm` — a agenda mostra o estado, e o cron não reenvia.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notificarLinkConsulta } from "@/lib/notificacoes";
import { consumir } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  // Evita cliques repetidos virarem enxurrada de e-mail para o paciente.
  const trava = consumir(`enviar-link:${consultaId}`, 3, 5 * 60_000);
  if (!trava.ok) {
    return NextResponse.json(
      { erro: "Link já enviado há pouco. Aguarde alguns minutos." },
      { status: 429 },
    );
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: {
      medicaId: true,
      status: true,
      modalidade: true,
      inicioEm: true,
      paciente: {
        select: { usuario: { select: { nome: true, email: true } } },
      },
    },
  });

  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }
  if (consulta.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }
  if (consulta.modalidade !== "TELECONSULTA") {
    return NextResponse.json(
      { erro: "Consulta presencial não tem sala virtual.", codigo: "SEM_SALA" },
      { status: 409 },
    );
  }
  if (consulta.status === "CANCELADA" || consulta.status === "CONCLUIDA") {
    return NextResponse.json(
      { erro: "Esta consulta não está ativa.", codigo: "INATIVA" },
      { status: 409 },
    );
  }

  const resultado = await notificarLinkConsulta({
    nome: consulta.paciente.usuario.nome,
    email: consulta.paciente.usuario.email,
    consultaId,
    inicioEm: consulta.inicioEm,
    modalidade: consulta.modalidade,
  });

  if (!resultado.email && !resultado.whatsapp) {
    return NextResponse.json(
      {
        erro:
          "Não foi possível enviar o link agora. Tente de novo em instantes.",
        codigo: "FALHA_ENVIO",
      },
      { status: 502 },
    );
  }

  const enviadoEm = new Date();
  await prisma.consulta.update({
    where: { id: consultaId },
    data: { lembreteEnviadoEm: enviadoEm },
  });

  return NextResponse.json({
    enviadoEm: enviadoEm.toISOString(),
    canais: resultado,
  });
}
