/**
 * Contrato de tipo do áudio entre navegador e S3.
 *
 * Existe num arquivo próprio, sem dependência de SDK, porque as duas pontas
 * precisam do MESMO valor e uma delas roda no navegador:
 *
 *   • `lib/s3.ts` assina a URL pré-assinada com este Content-Type;
 *   • `SalaTeleconsulta.tsx` envia este Content-Type no PUT.
 *
 * Se os dois divergirem, o S3 responde `403 SignatureDoesNotMatch` — uma URL
 * pré-assinada assina os headers, então qualquer diferença invalida tudo. Foi
 * exatamente o que acontecia: a URL era assinada para "audio/webm" e o
 * navegador mandava "audio/webm;codecs=opus", o valor que o MediaRecorder
 * produz. O upload falhava no fim da consulta, quando não dá para refazer.
 *
 * O gravador continua gravando em opus (melhor compressão para voz); só o
 * cabeçalho declarado no upload é normalizado para este valor.
 */
export const TIPO_AUDIO_CONSULTA = "audio/webm";
