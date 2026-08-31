/**
 * POST /api/consultas/[id]/notas
 *
 * Pipeline: áudio no S3 → Amazon Transcribe → Claude → rascunho no prontuário.
 *
 * **A rota é um avanço de estado, não uma chamada longa.** A transcrição da AWS
 * é um job assíncrono: uma consulta de 30 min leva minutos, e o nginx corta a
 * requisição em 60s. Então cada POST empurra o pipeline um passo e responde na
 * hora; o cliente chama de novo até sair `pronto`. Chamar com o job em
 * andamento é seguro e não reinicia nada.
 *
 *   1º POST  → inicia o job                    → 202 { estado: "transcrevendo" }
 *   POSTs    → job ainda rodando               → 202 { estado: "transcrevendo" }
 *   POST     → job pronto, gera nota no Claude → 200 { estado: "pronto", ... }
 *
 * Quatro garantias que não devem ser afrouxadas:
 *
 *   1. Sem consentimento registrado, nada roda. A verificação é aqui, no
 *      servidor, não só na UI — um cliente adulterado não pode contornar.
 *   2. O áudio sai do S3 assim que a transcrição volta, dê certo ou errado a
 *      etapa seguinte. Job que falha também apaga.
 *   3. O JSON que a Transcribe grava no bucket contém a consulta inteira em
 *      texto claro. Ele é apagado junto (em `acompanharTranscricao`).
 *   4. O registro nasce RASCUNHO. Nenhum caminho neste arquivo cria ASSINADO.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removerAudio } from "@/lib/s3";
import { iniciarTranscricao, MODELO_TRANSCRICAO } from "@/lib/ia/transcricao";
import { concluirNotas } from "@/lib/ia/pipeline-notas";
import { ipDoPedido } from "@/lib/pedido";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: consultaId } = await params;

  // ---- autorização: só a médica dona da consulta -------------------------
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  // S� o que esta rota usa: id/medica/status via campos escalares, mais o
  // consentimento e o job de transcri��o. N�o carrega o usu�rio inteiro
  // (senhaHash/totpSecret/cpf) � o pipeline busca o que precisa por conta.
  const consulta = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: {
      medicaId: true,
      consentimento: { select: { aceito: true } },
      transcricao: { select: { jobNome: true } },
    },
  });

  if (!consulta) {
    return NextResponse.json({ erro: "Consulta não encontrada." }, { status: 404 });
  }
  if (consulta.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }

  // ---- porta do consentimento -------------------------------------------
  // Barreira principal do sistema. Não remover, não tornar opcional por flag.
  if (!consulta.consentimento?.aceito) {
    return NextResponse.json(
      {
        erro:
          "Não há consentimento do paciente para gravação e processamento por IA. " +
          "O registro desta consulta deve ser redigido manualmente.",
        codigo: "SEM_CONSENTIMENTO",
      },
      { status: 403 },
    );
  }

  const { audioKey } = (await req.json().catch(() => ({}))) as {
    audioKey?: string;
  };

  // ======================================================================
  // Passo 1 — ainda não há job: inicia
  // ======================================================================
  if (!consulta.transcricao?.jobNome) {
    // Formato exato da chave, n�o s� o prefixo. `startsWith` sozinho aceitava
    // `consultas/<id>/../../outra` e sufixos arbitr�rios; aqui a chave tem que
    // casar o padr�o inteiro que `chaveAudio` gera.
    const chaveOk =
      typeof audioKey === "string" &&
      new RegExp(`^consultas/${consultaId}/audio-\\d+\\.webm$`).test(audioKey);
    if (!chaveOk) {
      return NextResponse.json({ erro: "Chave de �udio inv�lida." }, { status: 400 });
    }

    try {
      /**
       * O vocabulário customizado é um APOIO de precisão, não um requisito.
       *
       * Ele melhora o reconhecimento de nome de medicação e posologia. Se não
       * estiver `READY` na AWS — ainda processando, ou reprovado por um termo
       * inválido —, a Transcribe recusa o job inteiro. Deixar isso derrubar o
       * pipeline troca "transcrição um pouco pior" por "consulta inteira
       * perdida", que é a troca errada: o áudio já foi apagado e não há
       * segunda chance.
       *
       * Então: tenta com vocabulário, e cai para sem ele.
       */
      let jobNome: string;
      try {
        jobNome = await iniciarTranscricao({
          consultaId,
          audioKey,
          carimbo: Date.now(),
        });
      } catch (erroVocabulario) {
        const msg = String(
          (erroVocabulario as Error)?.message ?? erroVocabulario,
        );
        if (!/vocabulary/i.test(msg)) throw erroVocabulario;

        console.warn(
          "[notas] vocabulário indisponível, transcrevendo sem ele —",
          "rode `npm run vocabulario:aws` e confira o estado na AWS:",
          msg,
        );
        jobNome = await iniciarTranscricao({
          consultaId,
          audioKey,
          usarVocabulario: false,
          carimbo: Date.now(),
        });
      }

      // `audioKey` é gravado junto: quem apaga o áudio depois pode não ser
      // este navegador. Sem isso, uma aba fechada no meio deixava o arquivo no
      // bucket sem ninguém saber o nome dele.
      await prisma.transcricao.upsert({
        where: { consultaId },
        create: {
          consultaId,
          jobNome,
          audioKey,
          texto: "",
          modelo: MODELO_TRANSCRICAO,
          audioRemovido: false,
        },
        update: { jobNome, audioKey, audioRemovido: false },
      });

      return NextResponse.json(
        { estado: "transcrevendo", audioKey },
        { status: 202 },
      );
    } catch (erro) {
      console.error("[notas] falha ao iniciar transcrição", { consultaId, erro });
      await removerAudio(audioKey).catch(() => {});
      return NextResponse.json(
        {
          erro:
            "Não foi possível iniciar a transcrição. Redija o registro manualmente.",
          codigo: "FALHA_TRANSCRICAO",
        },
        { status: 502 },
      );
    }
  }


  // ======================================================================
  // Passos 2 a 4 � acompanhar o job, transcrever e estruturar
  // ======================================================================
  // Delegado a `concluirNotas`, que o cron tamb�m usa para retomar o que ficou
  // para tr�s quando a m�dica fecha a aba no meio do processamento.
  const r = await concluirNotas(
    consultaId,
    sessao.user.id,
    ipDoPedido(req),
  );

  if (r.estado === "transcrevendo") {
    return NextResponse.json({ estado: "transcrevendo" }, { status: 202 });
  }

  if (r.estado === "sem_job") {
    return NextResponse.json(
      { erro: "Transcri��o n�o iniciada.", codigo: "SEM_JOB" },
      { status: 409 },
    );
  }

  if (r.estado === "falhou") {
    // 503 para falha de conta (resolve-se fora do c�digo); 502 para o resto.
    const status = r.codigo.startsWith("IA_") ? 503 : 502;
    return NextResponse.json({ erro: r.motivo, codigo: r.codigo }, { status });
  }

  return NextResponse.json({
    estado: "pronto",
    registroId: r.registroId,
    relatorio: r.relatorio,
    pontosParaRevisao: r.relatorio.pontosParaRevisao,
    aviso: AVISO,
  });
}

const AVISO =
  "Rascunho gerado automaticamente. Revise cada campo antes de assinar � " +
  "a responsabilidade pelo conte�do do prontu�rio � da m�dica.";
