/**
 * POST /api/consultas/manual — encaixe manual da médica.
 *
 * A médica agenda um paciente DIRETO, no horário que quiser, por fora do fluxo
 * público. Dois modos de cobrança:
 *   - "isento": pago por fora (dinheiro, cortesia) — nasce CONFIRMADA/ISENTO com
 *     uma nota de como foi pago;
 *   - "pix": cobra um VALOR à escolha dela via Pix (Asaas). Nasce CONFIRMADA
 *     (ela já se comprometeu com o horário) e statusPagamento PENDENTE; devolve o
 *     copia-e-cola + QR para ela mandar ao paciente. Quando o paciente paga, o
 *     webhook marca PAGO. Como já é CONFIRMADA, o cron NÃO a expira (diferente do
 *     público, que fica AGUARDANDO_PAGAMENTO e é liberado se não pagar).
 *
 * Diferenças do público (`/api/consultas`): exige sessão de MÉDICA; horário LIVRE
 * (ignora antecedência de 2h e a grade); única trava é não CHOCAR com outra.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { enviarConfirmacaoAgendamento } from "@/lib/email";
import { FUSO_MEDICA } from "@/lib/agenda";
import { provedorPagamento } from "@/lib/pagamento";
import { cpfValido, limparCpf } from "@/lib/cpf";
import { PRECO_MAX_CENT } from "@/lib/config-medica";
import type { PixCliente } from "@/lib/pagamento/tipos";

const Corpo = z
  .object({
    email: z.string().email("E-mail inválido.").max(254),
    // Só usados ao CRIAR um paciente novo; ignorados se o e-mail já existe.
    nome: z.string().max(120).optional(),
    telefone: z.string().max(20).optional(),
    cpf: z.string().max(14).optional(),

    // Horário no fuso da médica, naive local "yyyy-MM-ddTHH:mm" (como bloqueios).
    inicioEm: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data/hora inválida."),
    duracaoMin: z.number().int().min(15).max(120).default(30),
    modalidade: z.enum(["TELECONSULTA", "PRESENCIAL"]),
    motivo: z.string().max(500).optional(),

    // Cobrança: isento (pago por fora) ou pix (cobra um valor via provedor).
    cobranca: z.enum(["isento", "pix"]).default("isento"),
    valorCent: z.number().int().min(100).max(PRECO_MAX_CENT).optional(),

    // Só no modo isento: "como foi pago" — nota livre para o registro da médica.
    pagamentoNota: z.string().max(80).optional(),
    // Só no modo isento: valor recebido POR FORA (dinheiro/transferência). Vira
    // receita no DRE (Pagamento DINHEIRO/PAGO). 0/ausente = cortesia.
    valorRecebidoCent: z.number().int().min(0).max(PRECO_MAX_CENT).optional(),
    avisarPaciente: z.boolean().default(true),
  })
  .refine((b) => !isNaN(new Date(`${b.inicioEm}:00-04:00`).getTime()), {
    message: "Data/hora inválida.",
    path: ["inicioEm"],
  });

export async function POST(req: NextRequest) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  const medicaId = sessao.user.id;

  const analise = Corpo.safeParse(await req.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const dados = analise.data;
  const email = dados.email.toLowerCase().trim();

  const cobrarPix = dados.cobranca === "pix";
  // No encaixe isento, a médica pode registrar quanto recebeu por fora (dinheiro).
  const recebidoCent = !cobrarPix ? (dados.valorRecebidoCent ?? 0) : 0;
  const provedor = provedorPagamento();

  // ---- pré-condições da cobrança Pix ------------------------------------
  if (cobrarPix) {
    if (!env.PAGAMENTO_ATIVO) {
      return NextResponse.json(
        {
          erro: "A cobrança na plataforma está desligada. Marque como isenta ou ative o pagamento.",
          codigo: "PAGAMENTO_DESLIGADO",
        },
        { status: 400 },
      );
    }
    if (!dados.valorCent) {
      return NextResponse.json(
        { erro: "Informe o valor a cobrar.", codigo: "VALOR_OBRIGATORIO" },
        { status: 400 },
      );
    }
    if (provedor.exigeCpf && (!dados.cpf || !cpfValido(dados.cpf))) {
      return NextResponse.json(
        { erro: "Informe um CPF válido do paciente para o Pix.", codigo: "CPF_INVALIDO" },
        { status: 400 },
      );
    }
  }

  const inicioEm = fromZonedTime(dados.inicioEm, FUSO_MEDICA);
  const fimEm = addMinutes(inicioEm, dados.duracaoMin);

  // ---- não pode CHOCAR com outra consulta ------------------------------
  const proximas = await prisma.consulta.findMany({
    where: {
      medicaId,
      status: { notIn: ["CANCELADA", "FALTOU"] },
      inicioEm: { gte: addMinutes(inicioEm, -120), lt: fimEm },
    },
    select: { inicioEm: true, duracaoMin: true },
  });
  const choca = proximas.some(
    (c) => c.inicioEm < fimEm && addMinutes(c.inicioEm, c.duracaoMin) > inicioEm,
  );
  if (choca) {
    return NextResponse.json(
      { erro: "Já há uma consulta nesse horário. Escolha outro.", codigo: "HORARIO_OCUPADO" },
      { status: 409 },
    );
  }

  // ---- paciente: acha por e-mail ou cria -------------------------------
  const existente = await prisma.usuario.findUnique({
    where: { email },
    include: { paciente: true },
  });
  if (existente && existente.papel !== "PACIENTE") {
    return NextResponse.json(
      { erro: "Esse e-mail é de acesso profissional — não pode ser agendado como paciente." },
      { status: 400 },
    );
  }
  if (!existente && !dados.nome?.trim()) {
    return NextResponse.json(
      { erro: "Paciente novo: informe o nome.", codigo: "NOME_OBRIGATORIO" },
      { status: 400 },
    );
  }

  try {
    const consulta = await prisma.$transaction(async (tx) => {
      let pacienteId: string;
      let nome: string;
      if (existente) {
        nome = existente.nome;
        pacienteId =
          existente.paciente?.id ??
          (await tx.paciente.create({ data: { usuarioId: existente.id } })).id;
      } else {
        nome = dados.nome!.trim();
        const novo = await tx.usuario.create({
          data: {
            email,
            nome,
            telefone: dados.telefone?.trim() || null,
            cpf: dados.cpf ? limparCpf(dados.cpf) : null,
            papel: "PACIENTE",
            paciente: { create: {} },
          },
          include: { paciente: true },
        });
        pacienteId = novo.paciente!.id;
      }

      const c = await tx.consulta.create({
        data: {
          pacienteId,
          medicaId,
          inicioEm,
          duracaoMin: dados.duracaoMin,
          modalidade: dados.modalidade,
          motivo: dados.motivo?.trim() || null,
          // Sempre CONFIRMADA: a médica se comprometeu com o horário. No Pix o
          // pagamento fica PENDENTE (não vira AGUARDANDO_PAGAMENTO, então o cron
          // não expira o encaixe dela).
          status: "CONFIRMADA",
          ...(cobrarPix
            ? {
                statusPagamento: "PENDENTE",
                pagamento: {
                  create: {
                    valorCent: dados.valorCent!,
                    metodo: "PIX",
                    provedor: provedor.nome,
                    status: "PENDENTE",
                  },
                },
              }
            : {
                statusPagamento: "ISENTO",
                pagamentoNota: dados.pagamentoNota?.trim() || null,
              }),
        },
        select: {
          id: true,
          inicioEm: true,
          modalidade: true,
          duracaoMin: true,
          pagamento: { select: { id: true } },
        },
      });

      // Encaixe isento pago POR FORA: registra o recebimento como Pagamento
      // DINHEIRO/PAGO para o DRE enxergar a receita (0 = cortesia, não gera nada).
      if (recebidoCent > 0) {
        await tx.pagamento.create({
          data: {
            consultaId: c.id,
            valorCent: recebidoCent,
            metodo: "DINHEIRO",
            provedor: "MANUAL",
            status: "PAGO",
            pagoEm: new Date(),
          },
        });
        await tx.consulta.update({ where: { id: c.id }, data: { statusPagamento: "PAGO" } });
      }

      return { ...c, nome };
    });

    // ---- modo PIX: cria a cobrança e devolve o copia-e-cola --------------
    if (cobrarPix) {
      try {
        const cobranca = await provedor.criarCobrancaPix({
          valorCent: dados.valorCent!,
          consultaId: consulta.id,
          pagador: {
            nome: consulta.nome,
            email,
            cpf: dados.cpf ? limparCpf(dados.cpf) : null,
          },
        });
        await prisma.pagamento.update({
          where: { id: consulta.pagamento!.id },
          data: {
            provedorRef: cobranca.provedorRef,
            pixCopiaCola: cobranca.copiaCola,
            expiraEm: cobranca.expiraEm,
          },
        });
        const pix: PixCliente = {
          copiaCola: cobranca.copiaCola,
          qrBase64: cobranca.qrBase64,
          expiraEm: cobranca.expiraEm.toISOString(),
          teste: provedor.nome === "FAKE",
          linkPagamento: cobranca.linkPagamento,
        };
        return NextResponse.json(
          { consultaId: consulta.id, nome: consulta.nome, valorCent: dados.valorCent, pix },
          { status: 201 },
        );
      } catch (erroCobranca) {
        // Rollback: a consulta acabou de nascer e não tem nada a preservar.
        // Melhor removê-la do que deixar um encaixe CONFIRMADO sem cobrança.
        console.error("[manual] falha ao criar cobrança Pix", consulta.id, erroCobranca);
        await prisma.pagamento.deleteMany({ where: { consultaId: consulta.id } }).catch(() => {});
        await prisma.consulta.delete({ where: { id: consulta.id } }).catch(() => {});
        return NextResponse.json(
          { erro: "Não consegui gerar o Pix agora. Tente de novo." },
          { status: 502 },
        );
      }
    }

    // ---- modo ISENTO: aviso ao paciente (opcional, best-effort) ----------
    let confirmacaoEnviada = false;
    if (dados.avisarPaciente) {
      const envio = enviarConfirmacaoAgendamento({
        nome: consulta.nome,
        email,
        inicioEm: consulta.inicioEm,
        modalidade: consulta.modalidade,
        duracaoMin: consulta.duracaoMin,
      }).then(() =>
        prisma.consulta.update({
          where: { id: consulta.id },
          data: { confirmacaoEnviadaEm: new Date() },
        }),
      );
      const EXPIROU = Symbol("expirou");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const r = await Promise.race([
          envio.then(() => "ok" as const),
          new Promise<typeof EXPIROU>((res) => {
            timer = setTimeout(() => res(EXPIROU), 8000);
          }),
        ]);
        confirmacaoEnviada = r !== EXPIROU;
        if (r === EXPIROU) envio.catch((e) => console.error("[manual] e-mail após timeout", e));
      } catch (e) {
        console.error("[manual] falha ao avisar paciente", e);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    return NextResponse.json(
      { consultaId: consulta.id, nome: consulta.nome, confirmacaoEnviada },
      { status: 201 },
    );
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      const alvo = (erro.meta?.target as string[] | undefined)?.join(",") ?? "";
      if (alvo.includes("cpf")) {
        return NextResponse.json({ erro: "Já existe um cadastro com esse CPF." }, { status: 409 });
      }
      return NextResponse.json(
        { erro: "Já há uma consulta nesse horário. Escolha outro.", codigo: "HORARIO_OCUPADO" },
        { status: 409 },
      );
    }
    console.error("[consultas/manual] falha", erro);
    return NextResponse.json({ erro: "Não foi possível criar a consulta." }, { status: 500 });
  }
}
