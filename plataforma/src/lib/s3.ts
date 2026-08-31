/**
 * Armazenamento temporário do áudio da consulta.
 *
 * O áudio nunca passa pelo servidor Next: o navegador sobe direto para o S3 por
 * URL pré-assinada. Isso evita segurar dezenas de MB de dado de saúde na memória
 * de uma função serverless — e evita o limite de body do Next.
 *
 * A chave sempre começa com `consultas/<consultaId>/`, e a rota de notas valida
 * esse prefixo. Sem isso, um cliente poderia pedir a transcrição do áudio de
 * outra consulta passando a chave dela.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
import { TIPO_AUDIO_CONSULTA } from "@/lib/tipos-midia";

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = env.AWS_S3_BUCKET_AUDIO;

export function chaveAudio(consultaId: string) {
  return `consultas/${consultaId}/audio-${Date.now()}.webm`;
}

/**
 * URL pré-assinada de upload. Curta de propósito — é usada em segundos.
 *
 * **Tudo que entra aqui vira header assinado, e o cliente precisa mandar
 * exatamente igual.** Duas armadilhas já custaram caro neste arquivo:
 *
 *  • `ServerSideEncryption: "AES256"` obrigava o navegador a enviar
 *    `x-amz-server-side-encryption`, coisa que ele não fazia. A criptografia
 *    em repouso continua garantida — pela **criptografia padrão do bucket**
 *    (SSE-S3), que a AWS liga sozinha em bucket novo e não depende do cliente.
 *    Confira em S3 → Properties → Default encryption.
 *
 *  • `ContentType` precisa bater com o header do PUT. Por isso vem de
 *    `TIPO_AUDIO_CONSULTA`, compartilhado com o componente da sala.
 */
export async function urlUploadAudio(consultaId: string) {
  const audioKey = chaveAudio(consultaId);
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: audioKey,
      ContentType: TIPO_AUDIO_CONSULTA,
    }),
    { expiresIn: 900 }, // 15 min
  );
  return { url, audioKey };
}

export async function baixarAudio(audioKey: string): Promise<File> {
  const objeto = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: audioKey }),
  );
  const bytes = await objeto.Body!.transformToByteArray();
  // O SDK tipa o retorno como `Uint8Array<ArrayBufferLike>`, que inclui
  // `SharedArrayBuffer` e por isso não satisfaz `BlobPart`. Vindo do S3 é
  // sempre um `ArrayBuffer` comum.
  return new File([bytes as Uint8Array<ArrayBuffer>], "consulta.webm", {
    type: "audio/webm",
  });
}

export async function removerAudio(audioKey: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: audioKey }));
}

/** Remove qualquer objeto do bucket — usado para o JSON da transcrição. */
export async function removerObjeto(chave: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chave }));
}

/**
 * Lê um JSON do bucket. É o resultado da Amazon Transcribe: diferente do
 * áudio, ele é pequeno e precisa ser processado no servidor, então aqui o
 * caminho pela memória do Next é adequado.
 */
export async function lerJson<T>(chave: string): Promise<T> {
  const objeto = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: chave }),
  );
  const texto = await objeto.Body!.transformToString("utf-8");
  return JSON.parse(texto) as T;
}
