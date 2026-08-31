/**
 * Transcrição do áudio da consulta via Amazon Transcribe.
 *
 * Por que a AWS e não o Whisper da OpenAI: o áudio já vive no nosso bucket em
 * `sa-east-1`. A Transcribe lê direto de lá e escreve o resultado no mesmo
 * bucket — o áudio da consulta **nunca sai do Brasil**. Com o Whisper, o dado
 * mais cru que existe aqui (a voz do paciente descrevendo sintomas) atravessava
 * a fronteira, o que exige base legal específica de transferência internacional
 * (LGPD art. 33) e mais um contrato de operador.
 *
 * O preço é a assincronia: a Transcribe é um job, não uma chamada. Quem usa
 * este módulo precisa iniciar e depois acompanhar — ver a rota de notas.
 *
 * Substituindo o `prompt` do Whisper (que enviesava o vocabulário do decoder
 * com termos médicos), aqui o equivalente é um **custom vocabulary** registrado
 * na AWS. Ele é opcional: sem ele a transcrição funciona, só erra mais em nome
 * de medicação e posologia — que é exatamente onde errar custa caro. Registre
 * com `npm run vocabulario:aws`.
 */

import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
} from "@aws-sdk/client-transcribe";
import { env } from "@/lib/env";
import { lerJson, removerObjeto } from "@/lib/s3";

const cliente = new TranscribeClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export const MODELO_TRANSCRICAO = "aws-transcribe";

/** Nome do vocabulário customizado. Ver `scripts/vocabulario-aws.ts`. */
export const VOCABULARIO = "termos-clinicos-ptbr";

/** Onde a Transcribe deposita o JSON do resultado. */
const chaveResultado = (consultaId: string) =>
  `consultas/${consultaId}/transcricao.json`;

export interface TranscricaoPronta {
  estado: "pronta";
  texto: string;
  duracaoSeg?: number;
  modelo: string;
}

export type EstadoTranscricao =
  | { estado: "processando" }
  | { estado: "falhou"; motivo: string }
  | TranscricaoPronta;

/**
 * Dispara o job. Devolve o nome, que é a alça para acompanhar depois.
 *
 * O nome carrega a consulta e um sufixo de tempo: a Transcribe recusa nomes
 * repetidos, e uma consulta pode ser reprocessada se a primeira tentativa
 * falhar.
 */
export async function iniciarTranscricao(opcoes: {
  consultaId: string;
  audioKey: string;
  /** Passe `false` se o vocabulário ainda não foi registrado na conta. */
  usarVocabulario?: boolean;
  carimbo: number;
}): Promise<string> {
  const { consultaId, audioKey, usarVocabulario = true, carimbo } = opcoes;
  const jobNome = `consulta-${consultaId}-${carimbo}`;

  await cliente.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobNome,
      LanguageCode: "pt-BR",
      Media: { MediaFileUri: `s3://${env.AWS_S3_BUCKET_AUDIO}/${audioKey}` },
      MediaFormat: "webm",

      // Resultado no NOSSO bucket, não no gerenciado pela AWS. Assim ele cai
      // sob a mesma regra de ciclo de vida e a mesma criptografia do áudio —
      // e some junto quando apagamos. O JSON contém a consulta inteira em
      // texto; deixá-lo num bucket que não controlamos seria pior que o áudio.
      OutputBucketName: env.AWS_S3_BUCKET_AUDIO,
      OutputKey: chaveResultado(consultaId),

      Settings: {
        // Separa quem falou o quê. Numa consulta, distinguir a fala da médica
        // da fala do paciente muda o sentido de cada frase no relatório.
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 2,
        ...(usarVocabulario ? { VocabularyName: VOCABULARIO } : {}),
      },
    }),
  );

  return jobNome;
}

interface ResultadoTranscribe {
  results?: {
    transcripts?: { transcript?: string }[];
    items?: { end_time?: string }[];
  };
}

/** Consulta o job. Não bloqueia: devolve o estado atual. */
export async function acompanharTranscricao(
  jobNome: string,
  consultaId: string,
): Promise<EstadoTranscricao> {
  const { TranscriptionJob } = await cliente.send(
    new GetTranscriptionJobCommand({ TranscriptionJobName: jobNome }),
  );

  const status = TranscriptionJob?.TranscriptionJobStatus;

  if (status === TranscriptionJobStatus.FAILED) {
    return {
      estado: "falhou",
      motivo: TranscriptionJob?.FailureReason ?? "motivo não informado",
    };
  }

  if (status !== TranscriptionJobStatus.COMPLETED) {
    return { estado: "processando" };
  }

  const chave = chaveResultado(consultaId);
  const bruto = await lerJson<ResultadoTranscribe>(chave);

  const texto = (bruto.results?.transcripts ?? [])
    .map((t) => t.transcript ?? "")
    .join(" ")
    .trim();

  // O JSON tem a consulta inteira em texto claro. Cumpriu a função, sai do
  // bucket agora — o prontuário é a cópia que fica, no banco.
  await removerObjeto(chave).catch((e) =>
    console.error("[transcricao] JSON órfão no S3 — remover manualmente", {
      chave,
      e,
    }),
  );

  const itens = bruto.results?.items ?? [];
  const ultimoFim = [...itens].reverse().find((i) => i.end_time)?.end_time;

  return {
    estado: "pronta",
    texto,
    duracaoSeg: ultimoFim ? Math.round(Number(ultimoFim)) : undefined,
    modelo: MODELO_TRANSCRICAO,
  };
}
