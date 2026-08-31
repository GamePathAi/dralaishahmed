/**
 * Conclusão do pipeline de notas, a partir de um job já iniciado.
 *
 * Vive fora da rota porque tem **dois** chamadores com autorizações
 * diferentes:
 *
 *  • `POST /api/consultas/[id]/notas` — a médica, com sessão, aguardando na
 *    tela após encerrar a consulta;
 *  • o cron — sem sessão, varrendo o que ficou para trás.
 *
 * O segundo existe porque o primeiro depende do navegador dela permanecer
 * aberto. Fechar a aba durante o processamento deixava o job rodando na AWS
 * sem ninguém buscar o resultado: o rascunho nunca era criado e — pior — o
 * áudio da consulta ficava no S3 indefinidamente.
 *
 * A função é idempotente: chamar de novo com o rascunho já criado devolve o
 * existente em vez de gastar outra chamada ao modelo.
 */

import { prisma } from "@/lib/prisma";
import { removerAudio } from "@/lib/s3";
import { acompanharTranscricao } from "@/lib/ia/transcricao";
import {
  gerarNotasClinicas,
  RecusaDoModeloError,
  ConfiguracaoIAError,
  type RelatorioClinico,
  type Prescricao,
} from "@/lib/ia/notas-clinicas";
import { Prisma } from "@prisma/client";
import { idDoModelo } from "@/lib/config-medica";

export type ResultadoPipeline =
  | { estado: "sem_job" }
  | { estado: "transcrevendo" }
  | { estado: "falhou"; motivo: string; codigo: string }
  | {
      estado: "pronto";
      registroId: string;
      relatorio: RelatorioClinico;
      /** Presente quando a médica prescreveu algo — id do rascunho de receita. */
      receitaId?: string;
    };

/**
 * Apaga o áudio e marca a transcrição.
 *
 * Chamado assim que o job sai de "em andamento", dê certo ou errado o resto:
 * o áudio já cumpriu a função e não pode sobreviver a uma falha do Claude.
 */
async function descartarAudio(consultaId: string, audioKey: string | null) {
  if (!audioKey) return;
  await removerAudio(audioKey)
    .then(() =>
      prisma.transcricao.update({
        where: { consultaId },
        data: { audioRemovido: true },
      }),
    )
    .catch((e) =>
      console.error("[pipeline] ÁUDIO ÓRFÃO NO S3 — remover manualmente", {
        audioKey,
        e,
      }),
    );
}

/**
 * Cria o rascunho de receita, se houve prescrição.
 *
 * Separado de propósito: a receita é documento próprio, com seu ciclo de
 * assinatura, e sua criação não pode derrubar a nota — se falhar, a médica ainda
 * tem o registro e prescreve manualmente. Devolve o id só quando cria.
 */
async function criarRascunhoReceita(
  consultaId: string,
  pacienteId: string,
  medicaId: string,
  prescricao: Prescricao,
  modelo: string,
  usuarioId: string,
  ip?: string,
): Promise<string | undefined> {
  if (!prescricao.houvePrescricao || prescricao.itens.length === 0) return undefined;

  try {
    const receita = await prisma.receita.create({
      data: {
        consultaId,
        pacienteId,
        medicaId,
        status: "RASCUNHO", // nunca ASSINADA por este caminho — a médica assina
        itens: prescricao.itens as unknown as Prisma.InputJsonValue,
        orientacoesGerais: prescricao.orientacoesGerais || null,
        temControlado: prescricao.itens.some((i) => i.controlado),
        origemIA: true,
        modeloIA: modelo,
        rascunhoIA: prescricao as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.auditoria.create({
      data: {
        usuarioId,
        acao: "CRIOU_RASCUNHO_IA",
        recursoId: receita.id,
        detalhe: { tipo: "receita", itens: prescricao.itens.length },
        ip,
      },
    });

    return receita.id;
  } catch (erro) {
    // Falhar a receita não pode perder a nota já criada. Registra e segue.
    console.error("[pipeline] falha ao criar rascunho de receita", {
      consultaId,
      erro,
    });
    return undefined;
  }
}

export async function concluirNotas(
  consultaId: string,
  /** Quem fica na trilha de auditoria como autor do rascunho. */
  usuarioId: string,
  ip?: string,
): Promise<ResultadoPipeline> {
  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    include: {
      transcricao: true,
      // Só o necessário: nunca trazer senhaHash/totpSecret/cpf do usuário para
      // um caminho que monta prompt de IA e serializa dado do paciente.
      paciente: {
        include: {
          usuario: { select: { nome: true, nascimento: true } },
        },
      },
      // Preferência de modelo da médica desta consulta.
      medica: { select: { modeloNota: true } },
    },
  });

  if (!consulta?.transcricao?.jobNome) return { estado: "sem_job" };

  // Rascunho já existe: devolve em vez de gastar o modelo de novo.
  const existente = await prisma.registroClinico.findFirst({
    where: { consultaId, status: "RASCUNHO", origemIA: true },
    orderBy: { criadoEm: "desc" },
  });
  if (existente) {
    // Se já havia receita gerada junto, devolve o id dela também — o rascunho da
    // consulta é um par (registro + receita) e a médica revisa os dois.
    const receitaExistente = await prisma.receita.findFirst({
      where: { consultaId, origemIA: true },
      orderBy: { criadoEm: "desc" },
      select: { id: true },
    });
    return {
      estado: "pronto",
      registroId: existente.id,
      relatorio: existente.rascunhoIA as unknown as RelatorioClinico,
      receitaId: receitaExistente?.id,
    };
  }

  // ---- estado do job ------------------------------------------------------
  const resultado = await acompanharTranscricao(
    consulta.transcricao.jobNome,
    consultaId,
  );

  if (resultado.estado === "processando") return { estado: "transcrevendo" };

  // A partir daqui o áudio não é mais necessário, aconteça o que acontecer.
  await descartarAudio(consultaId, consulta.transcricao.audioKey);

  if (resultado.estado === "falhou") {
    console.error("[pipeline] transcrição falhou", {
      consultaId,
      motivo: resultado.motivo,
    });
    return {
      estado: "falhou",
      codigo: "FALHA_TRANSCRICAO",
      motivo:
        "A transcrição do áudio falhou. A consulta foi encerrada normalmente — " +
        "redija o registro manualmente.",
    };
  }

  await prisma.transcricao.update({
    where: { consultaId },
    data: {
      texto: resultado.texto,
      duracaoSeg: resultado.duracaoSeg,
      modelo: resultado.modelo,
    },
  });

  if (!resultado.texto.trim()) {
    return {
      estado: "falhou",
      codigo: "TRANSCRICAO_VAZIA",
      motivo:
        "A transcrição voltou vazia — o áudio pode não ter captado as vozes. " +
        "Redija o registro manualmente.",
    };
  }

  // ---- estruturação pelo Claude ------------------------------------------
  try {
    const idade = consulta.paciente.usuario.nascimento
      ? Math.floor(
          (Date.now() - consulta.paciente.usuario.nascimento.getTime()) /
            (365.25 * 24 * 60 * 60 * 1000),
        )
      : undefined;

    const { relatorio, prescricao, modelo, tokensEntrada, tokensSaida } =
      await gerarNotasClinicas(
        resultado.texto,
        {
          nome: consulta.paciente.usuario.nome,
          idade,
          alergias: consulta.paciente.alergias,
          medicacoesUso: consulta.paciente.medicacoesUso,
          antecedentes: consulta.paciente.antecedentes,
        },
        idDoModelo(consulta.medica.modeloNota),
      );

    const registro = await prisma.registroClinico.create({
      data: {
        consultaId,
        pacienteId: consulta.pacienteId,
        status: "RASCUNHO", // nunca ASSINADO por este caminho
        queixaPrincipal: relatorio.queixaPrincipal,
        historiaMoleastiaAtual: relatorio.historiaMoleastiaAtual,
        antecedentes: relatorio.antecedentes,
        hipotesesDiagnosticas: relatorio.hipotesesDiagnosticas,
        conduta: relatorio.conduta,
        observacoes: relatorio.observacoes || null,
        origemIA: true,
        modeloIA: modelo,
        rascunhoIA: relatorio,
      },
    });

    await prisma.auditoria.create({
      data: {
        usuarioId,
        acao: "CRIOU_RASCUNHO_IA",
        recursoId: registro.id,
        detalhe: { modelo, tokensEntrada, tokensSaida },
        ip,
      },
    });

    // Receita: só cria rascunho quando a médica de fato prescreveu. Consulta sem
    // medicamento não gera receita vazia — a IA sinaliza isso em houvePrescricao.
    const receitaId = await criarRascunhoReceita(
      consultaId,
      consulta.pacienteId,
      consulta.medicaId,
      prescricao,
      modelo,
      usuarioId,
      ip,
    );

    return { estado: "pronto", registroId: registro.id, relatorio, receitaId };
  } catch (erro) {
    if (erro instanceof RecusaDoModeloError) {
      return { estado: "falhou", codigo: "RECUSA_MODELO", motivo: erro.message };
    }
    if (erro instanceof ConfiguracaoIAError) {
      console.error(`[pipeline] IA indisponível (${erro.motivo})`, { consultaId });
      return {
        estado: "falhou",
        codigo: `IA_${erro.motivo.toUpperCase()}`,
        motivo: erro.message,
      };
    }

    console.error("[pipeline] falha na geração da nota", { consultaId, erro });
    return {
      estado: "falhou",
      codigo: "FALHA_PIPELINE",
      motivo:
        "Não foi possível gerar o rascunho. A transcrição foi preservada — " +
        "o registro pode ser redigido manualmente a partir dela.",
    };
  }
}

/**
 * Varre as transcrições abandonadas.
 *
 * "Abandonada" = job iniciado, texto ainda vazio. É o rastro de uma médica que
 * fechou a aba antes de o processamento terminar. A janela de 24h evita ficar
 * tentando eternamente um job que a AWS já descartou.
 */
export async function retomarTranscricoesPendentes(limite = 20) {
  const pendentes = await prisma.transcricao.findMany({
    where: {
      jobNome: { not: null },
      texto: "",
      criadoEm: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
    select: { consultaId: true, consulta: { select: { medicaId: true } } },
    take: limite,
  });

  const resultados: { consultaId: string; estado: string }[] = [];

  for (const p of pendentes) {
    try {
      const r = await concluirNotas(p.consultaId, p.consulta.medicaId);
      resultados.push({ consultaId: p.consultaId, estado: r.estado });
    } catch (erro) {
      console.error("[pipeline] falha ao retomar", p.consultaId, erro);
      resultados.push({ consultaId: p.consultaId, estado: "erro" });
    }
  }

  return resultados;
}
