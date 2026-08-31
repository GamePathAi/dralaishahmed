/**
 * POST /api/consultas/[id]/consentimento
 * Registra o aceite (ou a recusa) do PACIENTE para gravação e processamento por IA.
 *
 * Regras que este arquivo protege:
 *
 *  • Só o próprio paciente da consulta registra. A médica não pode consentir
 *    em nome dele — seria consentimento de terceiro, sem validade (LGPD art. 11).
 *  • O texto exibido é gravado na íntegra. Se o texto mudar depois, a prova do
 *    que este paciente leu continua sendo esta linha.
 *  • Revogar é permitido a qualquer momento; aceitar de novo depois de revogar,
 *    não. Uma recusa registrada encerra o assunto para esta consulta — reabrir
 *    a porta abriria espaço para insistência sobre o paciente.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ipDoPedido } from "@/lib/pedido";
import { textoOficialDaVersao } from "@/lib/consentimento-texto";

// O cliente envia só a VERSÃO — o servidor resolve o texto oficial dela. O
// texto NÃO vem do cliente: era ele a "prova do que o paciente leu", e aceitá-lo
// do navegador permitia gravar qualquer coisa como consentimento.
const Corpo = z.object({
  aceito: z.boolean(),
  versaoTexto: z.string().min(1).max(40),
});

/**
 * GET — estado atual do consentimento desta consulta.
 *
 * Existe porque a médica ficava presa numa tela de "aguardando o paciente" que
 * nunca se atualizava: o paciente podia autorizar e ela não tinha como saber.
 * A única saída era "prosseguir sem o assistente", que jogava fora o aceite
 * que ele acabara de dar.
 *
 * Devolve só o veredito e o instante — nunca o texto apresentado. Quem lê aqui
 * está decidindo se liga a gravação, não auditando o consentimento.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: {
      medicaId: true,
      paciente: { select: { usuarioId: true } },
      consentimento: { select: { aceito: true, registradoEm: true } },
    },
  });

  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }

  // Só as duas pessoas desta consulta.
  const ehMedica =
    sessao.user.papel === "MEDICA" && consulta.medicaId === sessao.user.id;
  const ehPaciente = consulta.paciente.usuarioId === sessao.user.id;
  if (!ehMedica && !ehPaciente) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  return NextResponse.json({
    respondido: consulta.consentimento !== null,
    aceito: consulta.consentimento?.aceito ?? null,
    registradoEm: consulta.consentimento?.registradoEm ?? null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: consultaId } = await params;

  const sessao = await auth();
  if (!sessao?.user) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const analise = Corpo.safeParse(await req.json());
  if (!analise.success) {
    return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  }
  const { aceito, versaoTexto } = analise.data;

  // Versão desconhecida = cliente adulterado ou desatualizado. Não grava.
  const textoApresentado = textoOficialDaVersao(versaoTexto);
  if (!textoApresentado) {
    return NextResponse.json(
      { erro: "Versão de consentimento inválida.", codigo: "VERSAO_INVALIDA" },
      { status: 400 },
    );
  }

  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: {
      id: true,
      paciente: { select: { usuarioId: true } },
      consentimento: true,
    },
  });

  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }

  // Somente o paciente da consulta. Nem a médica, nem outro paciente.
  if (consulta.paciente.usuarioId !== sessao.user.id) {
    return NextResponse.json(
      { erro: "Apenas o paciente pode registrar este consentimento." },
      { status: 403 },
    );
  }

  // Recusa anterior é definitiva para esta consulta.
  if (consulta.consentimento && !consulta.consentimento.aceito && aceito) {
    return NextResponse.json(
      {
        erro:
          "Já houve recusa registrada nesta consulta. O assistente permanece desativado.",
        codigo: "RECUSA_DEFINITIVA",
      },
      { status: 409 },
    );
  }

  const ip = ipDoPedido(req);
  const userAgent = req.headers.get("user-agent") ?? undefined;

  const consentimento = await prisma.consentimento.upsert({
    where: { consultaId },
    create: {
      consultaId,
      aceito,
      textoApresentado,
      versaoTexto,
      ip,
      userAgent,
    },
    // Revogação: aceito passa a false, e o texto original é preservado.
    update: { aceito, registradoEm: new Date(), ip, userAgent },
  });

  if (aceito) {
    await prisma.auditoria.create({
      data: {
        usuarioId: sessao.user.id,
        acao: "REGISTROU_CONSENTIMENTO",
        recursoId: consultaId,
        detalhe: { versaoTexto },
        ip,
      },
    });
  }

  return NextResponse.json({ aceito: consentimento.aceito });
}
