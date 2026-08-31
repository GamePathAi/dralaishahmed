/**
 * Bloqueios de agenda — férias, plantão, congresso, feriado.
 *
 * GET    lista os bloqueios futuros
 * POST   cria um bloqueio
 * DELETE remove (?id=)
 *
 * A decisão de projeto que importa: **um bloqueio nunca cancela consulta
 * sozinho.** Se houver paciente marcado dentro do período, o POST devolve 409
 * com a lista de quem é — nome e horário — e a médica decide. Cancelar em massa
 * silenciosamente significaria pacientes descobrindo o cancelamento ao chegar na
 * sala vazia.
 *
 * Para confirmar o cancelamento junto, o cliente reenvia com
 * `cancelarConflitos: true`. Aí é escolha explícita, registrada em auditoria.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enviarCancelamentoConsulta } from "@/lib/email";
import { FUSO_MEDICA } from "@/lib/agenda";

const Corpo = z
  .object({
    // Naive local ("2026-09-01T08:00") no fuso da médica — convertido no
    // servidor. Aceitar ISO com offset abriria espaço para o navegador mandar
    // o fuso dele e o bloqueio cair nas horas erradas.
    inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    fim: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    motivo: z.string().max(200).optional(),
    cancelarConflitos: z.boolean().default(false),
  })
  // O regex casa "2026-13-40T25:99" — dígitos certos, data inexistente, que
  // vira `Invalid Date` mais adiante. Aqui rejeita antes de qualquer escrita.
  .refine((b) => !isNaN(new Date(`${b.inicio}:00-04:00`).getTime()), {
    message: "Data de início inválida.",
    path: ["inicio"],
  })
  .refine((b) => !isNaN(new Date(`${b.fim}:00-04:00`).getTime()), {
    message: "Data de fim inválida.",
    path: ["fim"],
  })
  .refine((b) => b.fim > b.inicio, {
    message: "O fim do bloqueio precisa vir depois do início.",
    path: ["fim"],
  });

async function exigirMedica() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") return null;
  return sessao.user;
}

// ------------------------------------------------------------------- GET

export async function GET() {
  const medica = await exigirMedica();
  if (!medica) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  const bloqueios = await prisma.bloqueio.findMany({
    where: { medicaId: medica.id, fimEm: { gte: new Date() } },
    orderBy: { inicioEm: "asc" },
  });

  return NextResponse.json({ bloqueios });
}

// ------------------------------------------------------------------ POST

export async function POST(req: NextRequest) {
  const medica = await exigirMedica();
  if (!medica) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  const analise = Corpo.safeParse(await req.json());
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const { inicio, fim, motivo, cancelarConflitos } = analise.data;

  const inicioEm = fromZonedTime(inicio, FUSO_MEDICA);
  const fimEm = fromZonedTime(fim, FUSO_MEDICA);

  // Quem já está marcado dentro da janela.
  const conflitos = await prisma.consulta.findMany({
    where: {
      medicaId: medica.id,
      status: { in: ["AGENDADA", "CONFIRMADA"] },
      inicioEm: { gte: inicioEm, lt: fimEm },
    },
    orderBy: { inicioEm: "asc" },
    select: {
      id: true,
      inicioEm: true,
      modalidade: true,
      paciente: {
        select: { usuario: { select: { nome: true, telefone: true, email: true } } },
      },
    },
  });

  if (conflitos.length > 0 && !cancelarConflitos) {
    return NextResponse.json(
      {
        erro: `Há ${conflitos.length} consulta${
          conflitos.length > 1 ? "s" : ""
        } marcada${conflitos.length > 1 ? "s" : ""} neste período.`,
        codigo: "CONFLITO_CONSULTAS",
        conflitos: conflitos.map((c) => ({
          id: c.id,
          inicioEm: c.inicioEm,
          modalidade: c.modalidade,
          paciente: c.paciente.usuario.nome,
          telefone: c.paciente.usuario.telefone,
        })),
      },
      { status: 409 },
    );
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const bloqueio = await tx.bloqueio.create({
      data: { medicaId: medica.id, inicioEm, fimEm, motivo: motivo?.trim() || null },
    });

    if (conflitos.length > 0) {
      await tx.consulta.updateMany({
        where: { id: { in: conflitos.map((c) => c.id) } },
        data: { status: "CANCELADA" },
      });

      // Cancelar consulta de paciente é ato relevante — fica na trilha, com
      // quem foi afetado, para que a origem do cancelamento seja rastreável.
      await tx.auditoria.create({
        data: {
          usuarioId: medica.id,
          acao: "CANCELOU_POR_BLOQUEIO",
          recursoId: bloqueio.id,
          detalhe: {
            motivo: motivo ?? null,
            consultasCanceladas: conflitos.map((c) => ({
              id: c.id,
              paciente: c.paciente.usuario.nome,
              inicioEm: c.inicioEm,
            })),
          },
        },
      });
    }

    return bloqueio;
  });

  // ---- aviso aos pacientes ------------------------------------------------
  // Fora da transação de propósito: o cancelamento já está gravado, e SMTP fora
  // do ar não pode desfazer o bloqueio que a médica acabou de confirmar.
  //
  // O `motivo` do bloqueio NÃO vai no e-mail. É anotação da agenda dela
  // ("plantão", "consulta com advogado"), escrita para ela mesma e não para o
  // paciente. Encaminhar texto livre de uso interno é vazamento à espera de
  // acontecer.
  const naoAvisados: string[] = [];

  for (const c of conflitos) {
    try {
      await enviarCancelamentoConsulta({
        nome: c.paciente.usuario.nome,
        email: c.paciente.usuario.email,
        inicioEm: c.inicioEm,
        modalidade: c.modalidade,
      });
    } catch (erroEmail) {
      naoAvisados.push(c.paciente.usuario.nome);
      console.error("[bloqueios] falha ao avisar cancelamento", c.id, erroEmail);
    }
  }

  const avisados = conflitos.length - naoAvisados.length;

  return NextResponse.json(
    {
      bloqueio: resultado,
      canceladas: conflitos.length,
      avisados,
      naoAvisados,
      // Só existe aviso quando algo exige ação da médica. Confirmar o que
      // funcionou não precisa de alerta; o que falhou, precisa — com o nome,
      // porque ela vai ter que ligar para essa pessoa.
      aviso:
        naoAvisados.length > 0
          ? `Não foi possível avisar por e-mail: ${naoAvisados.join(", ")}. ` +
            "Entre em contato diretamente."
          : undefined,
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------- DELETE

export async function DELETE(req: NextRequest) {
  const medica = await exigirMedica();
  if (!medica) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ erro: "Informe o id." }, { status: 400 });

  const bloqueio = await prisma.bloqueio.findUnique({ where: { id } });
  if (!bloqueio || bloqueio.medicaId !== medica.id) {
    return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });
  }

  await prisma.bloqueio.delete({ where: { id } });

  return NextResponse.json({
    removido: true,
    // Remover o bloqueio devolve os horários à grade, mas não desfaz o
    // cancelamento — consulta cancelada não volta sozinha.
    aviso:
      "Os horários voltam a ser oferecidos. Consultas canceladas por este " +
      "bloqueio não são restauradas automaticamente.",
  });
}
