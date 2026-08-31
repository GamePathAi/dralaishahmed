/**
 * POST /api/consultas — cria um agendamento.
 *
 * A parte que merece atenção é a corrida de agendamento duplo. Dois pacientes
 * podem clicar "confirmar" no mesmo horário com milissegundos de diferença:
 * ambos passam pela checagem de disponibilidade, ambos inserem, e a médica
 * descobre o conflito na hora da consulta.
 *
 * A defesa real é a constraint `@@unique([medicaId, inicioEm])` no banco — o
 * segundo INSERT falha com P2002 e vira "horário ocupado" para o usuário.
 * A revalidação em `horarioAindaValido` vem antes por outro motivo: pegar o
 * horário que saiu da grade por bloqueio novo ou janela desativada, casos que
 * a constraint de unicidade não cobre.
 *
 * PAGAMENTO: a consulta nasce AGUARDANDO_PAGAMENTO com uma cobrança Pix, e só
 * vira CONFIRMADA quando o webhook do provedor avisa que foi paga (ver
 * `lib/pagamento/confirmacao.ts`). É por isso que o e-mail de confirmação NÃO
 * é enviado aqui — sai no webhook. Enquanto não paga, a consulta segura o
 * horário; passada a janela de 20 min, o cron a remove e o slot volta à grade.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { horarioAindaValido } from "@/lib/agenda";
import { consumir, liberar } from "@/lib/rate-limit";
import { ipDoPedido } from "@/lib/pedido";
import { env } from "@/lib/env";
import { enviarConfirmacaoAgendamento } from "@/lib/email";
import { provedorPagamento } from "@/lib/pagamento";
import { precoDaConsulta } from "@/lib/config-medica";
import { cpfValido, limparCpf } from "@/lib/cpf";
import type { PixCliente } from "@/lib/pagamento/tipos";

const Corpo = z.object({
  // Dados do paciente (permite agendar sem conta prévia). Todo campo público
  // tem teto: sem `.max`, um texto de MB vira lixo retido 20 anos junto ao
  // prontuário e infla o e-mail de confirmação.
  nome: z.string().min(3, "Informe o nome completo.").max(120),
  email: z.string().email("E-mail inválido.").max(254),
  telefone: z
    .string()
    .min(10, "Telefone inválido.")
    .max(20)
    .regex(/^[\d\s()+-]+$/, "Telefone inválido."),
  nascimento: z.coerce
    .date()
    // Faixa de sanidade: nada de nascimento no futuro nem antes de 1900.
    .refine((d) => d <= new Date() && d.getFullYear() >= 1900, "Data inválida.")
    .optional(),

  // CPF do pagador. Opcional no schema porque só é exigido quando o provedor de
  // pagamento pede (Asaas) E o checkout está ligado — a validação de verdade e a
  // obrigatoriedade vêm mais abaixo, com o provedor em mãos.
  cpf: z.string().max(14).optional(),

  inicioEm: z.coerce.date(),
  modalidade: z.enum(["TELECONSULTA", "PRESENCIAL"]),
  duracaoMin: z.number().int().min(15).max(120).default(30),

  // Queixa livre. NÃO é prontuário — é o motivo declarado no agendamento, e
  // deliberadamente curto: não queremos histórico clínico digitado num
  // formulário público antes de existir relação médico-paciente.
  motivo: z.string().max(500).optional(),

  aceitouTermos: z.literal(true, {
    errorMap: () => ({ message: "É necessário aceitar os termos." }),
  }),
});

export async function POST(req: NextRequest) {
  // Validação vem ANTES de qualquer débito de cota. Um paciente que erra o
  // e-mail e corrige não pode gastar suas tentativas por causa do typo — antes,
  // com o `consumir` no topo, cada 400/409 queimava a cota e o paciente
  // legítimo era travado depois de dois enganos.
  const corpoJson = await req.json().catch(() => null);
  const analise = Corpo.safeParse(corpoJson);
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const dados = analise.data;

  // Guarda de FLOOD por IP, deliberadamente FROUXA. Operadoras móveis colocam
  // muitos pacientes reais atrás de um mesmo IP público (CGNAT); um teto baixo
  // por IP derruba gente legítima justamente quando um anúncio pago manda
  // tráfego de celular. 20 / 10 min limita o flood de um único IP sem punir os
  // vizinhos de NAT. O sinal real de spam é a cota por e-mail, mais abaixo.
  const ip = ipDoPedido(req) ?? "sem-ip";
  const limiteIp = consumir(`agendar-ip:${ip}`, 20, 10 * 60_000);
  if (!limiteIp.ok) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." },
      { status: 429, headers: { "Retry-After": String(limiteIp.esperaSeg) } },
    );
  }

  const medica = await prisma.usuario.findFirst({
    where: { papel: "MEDICA" },
    select: { id: true, valorTeleconsultaCent: true, valorPresencialCent: true },
  });
  if (!medica) {
    return NextResponse.json({ erro: "Agenda indisponível." }, { status: 503 });
  }

  // Revalida contra a grade atual — a tela do paciente pode estar defasada.
  const valido = await horarioAindaValido(
    medica.id,
    dados.inicioEm,
    dados.modalidade,
  );
  if (!valido) {
    return NextResponse.json(
      {
        erro: "Esse horário não está mais disponível. Escolha outro.",
        codigo: "HORARIO_INDISPONIVEL",
      },
      { status: 409 },
    );
  }

  const email = dados.email.toLowerCase().trim();

  // Se o e-mail já pertence a alguém que NÃO é paciente (a médica), este
  // formulário público não pode tocar na conta — nem para atualizar, nem para
  // criar um Paciente para ela. Resposta neutra: não revelar de quem é o
  // e-mail. O upsert por e-mail, sem esta guarda, permitia adulterar a conta
  // com acesso a todos os prontuários.
  const jaExiste = await prisma.usuario.findUnique({
    where: { email },
    select: { papel: true },
  });
  if (jaExiste && jaExiste.papel !== "PACIENTE") {
    return NextResponse.json(
      {
        consultaId: null,
        mensagem: "Recebemos seu pedido. Confira seu e-mail.",
      },
      { status: 202 },
    );
  }

  // Cota por E-MAIL: uma pessoa real não abre 3 agendamentos em 10 min; um bot
  // reusando a mesma identidade, sim. Como a chave é o e-mail (não o IP), ela
  // nunca encosta num vizinho de CGNAT. É debitada só aqui, depois de todas as
  // validações, então typo e horário-tomado não gastam a cota.
  const chaveEmail = `agendar-email:${email}`;
  const limiteEmail = consumir(chaveEmail, 3, 10 * 60_000);
  if (!limiteEmail.ok) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." },
      { status: 429, headers: { "Retry-After": String(limiteEmail.esperaSeg) } },
    );
  }

  const provedor = provedorPagamento();
  const valorCent = precoDaConsulta(medica, dados.modalidade);

  // Pagamento só entra no caminho quando está LIGADO e há valor a cobrar. Com o
  // checkout desligado (padrão) ou preço zero (isento), o agendamento confirma
  // direto e manda o e-mail aqui — o comportamento de sempre.
  const pagamentoLigado = env.PAGAMENTO_ATIVO && valorCent > 0;

  // Alguns provedores (Asaas) exigem o CPF do pagador para criar a cobrança Pix.
  // Só cobramos o CPF quando vamos de fato cobrar E o provedor pede — assim o
  // formulário público não pede CPF à toa quando o pagamento está desligado.
  if (pagamentoLigado && provedor.exigeCpf) {
    if (!dados.cpf || !cpfValido(dados.cpf)) {
      return NextResponse.json(
        { erro: "Informe um CPF válido para o pagamento.", codigo: "CPF_INVALIDO" },
        { status: 400 },
      );
    }
  }

  if (!pagamentoLigado) {
    try {
      const consulta = await prisma.$transaction(async (tx) => {
        const usuario = await tx.usuario.upsert({
          where: { email },
          create: {
            email,
            nome: dados.nome.trim(),
            telefone: dados.telefone,
            nascimento: dados.nascimento,
            papel: "PACIENTE",
            paciente: { create: {} },
          },
          update: {},
          include: { paciente: true },
        });
        const paciente =
          usuario.paciente ??
          (await tx.paciente.create({ data: { usuarioId: usuario.id } }));
        return tx.consulta.create({
          data: {
            pacienteId: paciente.id,
            medicaId: medica.id,
            inicioEm: dados.inicioEm,
            duracaoMin: dados.duracaoMin,
            modalidade: dados.modalidade,
            motivo: dados.motivo?.trim() || null,
            status: "AGENDADA",
            statusPagamento: "ISENTO",
          },
          select: { id: true, inicioEm: true, modalidade: true, duracaoMin: true },
        });
      });

      // E-mail com teto de tempo: um SMTP lento não pode segurar o POST até o
      // nginx cortar. Se estourar, seguimos com `confirmacaoEnviada:false` (a
      // tela mostra o horário) e o envio termina em segundo plano.
      let confirmacaoEnviada = true;
      const envio = enviarConfirmacaoAgendamento({
        nome: dados.nome.trim(),
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
        if (r === EXPIROU) {
          confirmacaoEnviada = false;
          envio.catch((e) => console.error("[consultas] confirmação falhou após timeout", e));
        }
      } catch (e) {
        confirmacaoEnviada = false;
        console.error("[consultas] falha ao enviar confirmação", e);
      } finally {
        if (timer) clearTimeout(timer);
      }

      return NextResponse.json(
        {
          consultaId: consulta.id,
          inicioEm: consulta.inicioEm,
          modalidade: consulta.modalidade,
          confirmacaoEnviada,
          mensagem: confirmacaoEnviada
            ? "Consulta agendada. Você receberá a confirmação por e-mail."
            : "Consulta agendada. Não conseguimos enviar o e-mail de confirmação agora — anote o horário abaixo.",
        },
        { status: 201 },
      );
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        liberar(chaveEmail);
        return NextResponse.json(
          { erro: "Esse horário acabou de ser ocupado. Escolha outro.", codigo: "HORARIO_INDISPONIVEL" },
          { status: 409 },
        );
      }
      console.error("[consultas] falha ao agendar", erro);
      return NextResponse.json({ erro: "Não foi possível concluir o agendamento." }, { status: 500 });
    }
  }

  try {
    // A consulta nasce AGUARDANDO_PAGAMENTO e já com a linha de Pagamento
    // PENDENTE. Criar a consulta segura o horário (a query de ocupação da agenda
    // conta este estado como ocupado). O `expiraEm` é definido AQUI, e não só a
    // partir do provedor, para que o cron consiga liberar o slot mesmo que a
    // criação da cobrança falhe lá fora.
    const expiraEm = new Date(Date.now() + 20 * 60_000);
    const { consulta, pagamentoId } = await prisma.$transaction(async (tx) => {
      // Paciente recorrente reaproveita o cadastro; novo é criado agora.
      const usuario = await tx.usuario.upsert({
        where: { email },
        create: {
          email,
          nome: dados.nome.trim(),
          telefone: dados.telefone,
          nascimento: dados.nascimento,
          papel: "PACIENTE",
          paciente: { create: {} },
        },
        // Cadastro existente NÃO é alterado por formulário público. Antes o
        // telefone era sobrescrito: um atacante que soubesse o e-mail da
        // vítima trocava o número que a médica usa para contato. Nome e
        // telefone só entram na criação; correção de cadastro é ato
        // autenticado, não efeito de agendamento anônimo.
        update: {},
        include: { paciente: true },
      });

      const paciente =
        usuario.paciente ??
        (await tx.paciente.create({ data: { usuarioId: usuario.id } }));

      const consulta = await tx.consulta.create({
        data: {
          pacienteId: paciente.id,
          medicaId: medica.id,
          inicioEm: dados.inicioEm,
          duracaoMin: dados.duracaoMin,
          modalidade: dados.modalidade,
          motivo: dados.motivo?.trim() || null,
          status: "AGUARDANDO_PAGAMENTO",
          statusPagamento: "PENDENTE",
          pagamento: {
            create: {
              valorCent,
              metodo: "PIX",
              provedor: provedor.nome,
              status: "PENDENTE",
              expiraEm,
            },
          },
        },
        select: {
          id: true,
          inicioEm: true,
          modalidade: true,
          duracaoMin: true,
          pagamento: { select: { id: true } },
        },
      });

      return { consulta, pagamentoId: consulta.pagamento!.id };
    });

    // Cria a cobrança no provedor DEPOIS do commit (precisa do consultaId) e
    // grava o retorno. Se o provedor falhar, a consulta já expira sozinha pelo
    // cron — o horário não fica preso para sempre.
    let pix: PixCliente;
    try {
      const cobranca = await provedor.criarCobrancaPix({
        valorCent,
        consultaId: consulta.id,
        pagador: {
          nome: dados.nome.trim(),
          email,
          cpf: dados.cpf ? limparCpf(dados.cpf) : null,
        },
      });
      await prisma.pagamento.update({
        where: { id: pagamentoId },
        data: {
          provedorRef: cobranca.provedorRef,
          pixCopiaCola: cobranca.copiaCola,
          expiraEm: cobranca.expiraEm,
        },
      });
      pix = {
        copiaCola: cobranca.copiaCola,
        qrBase64: cobranca.qrBase64,
        expiraEm: cobranca.expiraEm.toISOString(),
        teste: provedor.nome === "FAKE",
        linkPagamento: cobranca.linkPagamento,
      };
    } catch (erroCobranca) {
      console.error("[consultas] falha ao criar cobrança Pix", consulta.id, erroCobranca);
      await prisma.pagamento
        .update({ where: { id: pagamentoId }, data: { status: "FALHOU" } })
        .catch(() => {});
      // A cota volta: a falha não é do paciente, e o horário será liberado pelo
      // cron quando `expiraEm` vencer.
      liberar(chaveEmail);
      return NextResponse.json(
        { erro: "Não foi possível gerar o Pix agora. Tente novamente em instantes." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        consultaId: consulta.id,
        inicioEm: consulta.inicioEm,
        modalidade: consulta.modalidade,
        valorCent,
        // O pagamento é a etapa que confirma. O e-mail de confirmação NÃO sai
        // aqui: ele é disparado pelo webhook, quando o Pix é pago.
        pix,
      },
      { status: 201 },
    );
  } catch (erro) {
    // P2002 = violação de unicidade. Aqui significa exatamente uma coisa:
    // outro paciente fechou este horário entre a revalidação e o INSERT.
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    ) {
      // A corrida não é culpa do paciente: devolve a cota para ele escolher
      // outro horário sem ficar mais perto do bloqueio.
      liberar(chaveEmail);
      return NextResponse.json(
        {
          erro: "Esse horário acabou de ser ocupado. Escolha outro.",
          codigo: "HORARIO_INDISPONIVEL",
        },
        { status: 409 },
      );
    }

    console.error("[consultas] falha ao agendar", erro);
    return NextResponse.json(
      { erro: "Não foi possível concluir o agendamento." },
      { status: 500 },
    );
  }
}
