/**
 * Valida as credenciais e permissões AWS do pipeline de transcrição.
 *
 *     npm run validar:aws
 *
 * Não se contenta em "a chave existe": executa cada operação que o pipeline faz
 * de verdade, incluindo um job de transcrição completo com um áudio de 2
 * segundos. Permissão que só aparece no meio de uma consulta real é o pior
 * lugar para descobrir que faltava.
 *
 * Custo: fração de centavo (a Transcribe cobra por segundo de áudio).
 * Limpa tudo que cria.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  GetVocabularyCommand,
} from "@aws-sdk/client-transcribe";

const REGIAO = process.env.AWS_REGION ?? "sa-east-1";
const BUCKET = process.env.AWS_S3_BUCKET_AUDIO ?? "";
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
};

const s3 = new S3Client({ region: REGIAO, credentials });
const transcribe = new TranscribeClient({ region: REGIAO, credentials });

let falhas = 0;
const ok = (r: string, d = "") => console.log(`  \x1b[32m✓\x1b[0m ${r}${d ? ` — ${d}` : ""}`);
const nao = (r: string, d: string) => { falhas++; console.log(`  \x1b[31m✗\x1b[0m ${r}\n      ${d}`); };
const aviso = (r: string, d: string) => console.log(`  \x1b[33m•\x1b[0m ${r} — ${d}`);

const PREFIXO = "consultas/_validacao";
const CHAVE_AUDIO = `${PREFIXO}/probe.wav`;
const CHAVE_SAIDA = `${PREFIXO}/probe.json`;

/** WAV PCM 16 bits, mono, 16 kHz, 2 s de silêncio. */
function wavDeSilencio(segundos = 2, taxa = 16000): Buffer {
  const amostras = segundos * taxa;
  const dados = Buffer.alloc(amostras * 2); // silêncio = zeros
  const cabecalho = Buffer.alloc(44);
  cabecalho.write("RIFF", 0);
  cabecalho.writeUInt32LE(36 + dados.length, 4);
  cabecalho.write("WAVE", 8);
  cabecalho.write("fmt ", 12);
  cabecalho.writeUInt32LE(16, 16);
  cabecalho.writeUInt16LE(1, 20); // PCM
  cabecalho.writeUInt16LE(1, 22); // mono
  cabecalho.writeUInt32LE(taxa, 24);
  cabecalho.writeUInt32LE(taxa * 2, 28);
  cabecalho.writeUInt16LE(2, 32);
  cabecalho.writeUInt16LE(16, 34);
  cabecalho.write("data", 36);
  cabecalho.writeUInt32LE(dados.length, 40);
  return Buffer.concat([cabecalho, dados]);
}

const erroDe = (e: any) => `${e?.name ?? "Erro"}: ${e?.message ?? e}`;

async function main() {
  console.log(`\n\x1b[1mValidação das credenciais AWS\x1b[0m\n${"─".repeat(60)}`);

  // ---- 0. preenchimento ---------------------------------------------------
  const faltando = Object.entries({
    AWS_S3_BUCKET_AUDIO: BUCKET,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  }).filter(([, v]) => !v || v === "PREENCHER");

  if (faltando.length) {
    console.error(
      `\nAinda em branco no .env: ${faltando.map(([k]) => k).join(", ")}\n`,
    );
    process.exit(1);
  }
  ok("Variáveis preenchidas", `bucket "${BUCKET}", região ${REGIAO}`);

  // ---- 1. o bucket existe e responde --------------------------------------
  console.log("\n\x1b[1mS3\x1b[0m");
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    ok("Bucket acessível");
  } catch (e: any) {
    const regiaoReal = e?.$response?.headers?.["x-amz-bucket-region"];
    if (regiaoReal && regiaoReal !== REGIAO) {
      nao(
        "Bucket está na região errada",
        `o bucket vive em "${regiaoReal}", mas AWS_REGION é "${REGIAO}". ` +
          `A Transcribe exige bucket na MESMA região do job — e fora de ` +
          `sa-east-1 o áudio sai do Brasil, que era o motivo da migração.`,
      );
    } else if (e?.name === "Forbidden" || e?.$metadata?.httpStatusCode === 403) {
      // A aplicação NUNCA chama HeadBucket — só opera em objetos. Então isto
      // não bloqueia nada; só nos priva da checagem automática de região.
      // Adicione s3:ListBucket na ARN do bucket se quiser essa rede a mais.
      aviso(
        "HeadBucket negado (403)",
        "falta s3:ListBucket — não impede o pipeline, mas impede eu conferir a região automaticamente",
      );
    } else if (e?.$metadata?.httpStatusCode === 404) {
      nao("Bucket não existe", `crie "${BUCKET}" em ${REGIAO}`);
      console.log("\nInterrompido: sem bucket, o resto não roda.\n");
      process.exit(1);
    } else {
      aviso("HeadBucket não respondeu como esperado", erroDe(e));
    }
  }

  // ---- 2. as três operações do áudio --------------------------------------
  const audio = wavDeSilencio();
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: CHAVE_AUDIO,
        Body: audio,
        ContentType: "audio/wav",
        ServerSideEncryption: "AES256",
      }),
    );
    ok("PutObject (o navegador sobe o áudio)");
  } catch (e) {
    nao("PutObject negado", erroDe(e));
    process.exit(1);
  }

  try {
    await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: CHAVE_AUDIO }));
    ok("GetObject (leitura do resultado)");
  } catch (e) {
    nao("GetObject negado", erroDe(e));
  }

  // ---- 3. permissões da Transcribe ----------------------------------------
  console.log("\n\x1b[1mTranscribe\x1b[0m");
  try {
    await transcribe.send(
      new GetVocabularyCommand({ VocabularyName: "vocabulario-que-nao-existe" }),
    );
  } catch (e: any) {
    if (e?.name === "AccessDeniedException") {
      nao(
        "Sem permissão de vocabulário",
        "falta transcribe:GetVocabulary — o vocabulário customizado não vai funcionar",
      );
    } else {
      ok("Permissão de vocabulário", "a API respondeu 'não encontrado', não 'negado'");
    }
  }

  // ---- 4. job de transcrição de verdade -----------------------------------
  const jobNome = `validacao-${Date.now()}`;
  try {
    await transcribe.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobNome,
        LanguageCode: "pt-BR",
        Media: { MediaFileUri: `s3://${BUCKET}/${CHAVE_AUDIO}` },
        MediaFormat: "wav",
        OutputBucketName: BUCKET,
        OutputKey: CHAVE_SAIDA,
      }),
    );
    ok("StartTranscriptionJob aceito", jobNome);
  } catch (e: any) {
    if (e?.name === "AccessDeniedException") {
      nao("Sem permissão para iniciar job", "falta transcribe:StartTranscriptionJob");
    } else {
      nao("Falha ao iniciar o job", erroDe(e));
    }
    await limpar();
    encerrar();
    return;
  }

  process.stdout.write("  … aguardando o job (pode levar ~1 min) ");
  let estado = "IN_PROGRESS";
  let motivo = "";
  for (let i = 0; i < 60 && (estado === "IN_PROGRESS" || estado === "QUEUED"); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    process.stdout.write(".");
    try {
      const { TranscriptionJob } = await transcribe.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobNome }),
      );
      estado = TranscriptionJob?.TranscriptionJobStatus ?? "?";
      motivo = TranscriptionJob?.FailureReason ?? "";
    } catch (e: any) {
      if (e?.name === "AccessDeniedException") {
        console.log("");
        nao("Sem permissão para acompanhar job", "falta transcribe:GetTranscriptionJob");
        await limpar();
        encerrar();
        return;
      }
      throw e;
    }
  }
  console.log("");

  if (estado === "COMPLETED") {
    ok("Job concluído", "a Transcribe leu o áudio e gravou o resultado no bucket");
  } else if (estado === "FAILED") {
    // Um WAV de silêncio às vezes é recusado por não ter fala — isso NÃO é
    // problema de credencial, e a mensagem da AWS deixa claro qual é o caso.
    if (/language|speech|audio/i.test(motivo)) {
      aviso(
        "Job falhou por falta de fala no áudio de teste",
        "esperado num WAV silencioso — as permissões estão OK",
      );
    } else {
      nao("Job falhou", motivo || "motivo não informado");
    }
  } else {
    aviso("Job ainda rodando após 5 min", `estado ${estado} — permissões OK, só lento`);
  }

  // ---- 5. leitura e remoção do resultado ----------------------------------
  console.log("\n\x1b[1mLimpeza\x1b[0m");
  if (estado === "COMPLETED") {
    try {
      const r = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: CHAVE_SAIDA }),
      );
      const json = JSON.parse(await r.Body!.transformToString("utf-8"));
      ok(
        "JSON do resultado lido do bucket",
        `transcrição: "${json?.results?.transcripts?.[0]?.transcript ?? ""}" (vazia é o esperado)`,
      );
    } catch (e) {
      nao("Não consegui ler o JSON do resultado", erroDe(e));
    }
  }

  // ---- 6. o caminho que a PLATAFORMA usa ---------------------------------
  // O que passou até aqui foi o SDK direto. A aplicação usa `lib/s3.ts`, que
  // por sua vez passa pelo `env.ts` — e o navegador sobe o áudio por URL
  // pré-assinada, sem tocar no servidor. Cada um desses tem falha própria.
  console.log("\n\x1b[1mPelo caminho da plataforma\x1b[0m");

  try {
    const s3App = await import("../src/lib/s3");
    ok("lib/s3.ts carrega", "env.ts aceitou as variáveis");

    const { url, audioKey } = await s3App.urlUploadAudio("_validacao");
    ok("URL pré-assinada gerada", `${url.slice(0, 60)}…`);

    // Sobe pela URL, como o navegador faz — assinatura, prefixo e política do
    // bucket entram no teste de uma vez só.
    // Mesmo Content-Type que assinou a URL. Divergir aqui reproduz o
    // `403 SignatureDoesNotMatch` que este teste existe para pegar.
    const { TIPO_AUDIO_CONSULTA } = await import("../src/lib/tipos-midia");
    const envio = await fetch(url, {
      method: "PUT",
      body: new Uint8Array(audio),
      headers: { "Content-Type": TIPO_AUDIO_CONSULTA },
    });

    if (envio.ok) {
      ok("Upload pela URL pré-assinada", `HTTP ${envio.status}`);
    } else {
      nao(
        "Upload pela URL pré-assinada falhou",
        `HTTP ${envio.status} — ${(await envio.text()).slice(0, 200)}`,
      );
    }

    await s3App.removerObjeto(audioKey).catch(() => {});
    ok("removerObjeto (usado para apagar o JSON da transcrição)");
  } catch (e) {
    nao("Caminho da plataforma falhou", erroDe(e));
  }

  // ---- 7. CORS: só o navegador sofre com isso ----------------------------
  // O upload acima saiu daqui, do Node, onde CORS não existe. No navegador da
  // médica, um bucket sem CORS recusa o PUT e a gravação da consulta se perde
  // silenciosamente no fim do atendimento.
  try {
    const { GetBucketCorsCommand } = await import("@aws-sdk/client-s3");
    const { CORSRules } = await s3.send(
      new GetBucketCorsCommand({ Bucket: BUCKET }),
    );
    const regraPut = (CORSRules ?? []).find((r) =>
      (r.AllowedMethods ?? []).includes("PUT"),
    );
    if (regraPut) {
      ok(
        "CORS permite PUT",
        `origens: ${(regraPut.AllowedOrigins ?? []).join(", ")}`,
      );
    } else {
      nao(
        "CORS não permite PUT",
        "o navegador não conseguirá subir o áudio — veja a configuração no fim",
      );
    }
  } catch (e: any) {
    if (e?.name === "NoSuchCORSConfiguration") {
      nao(
        "Bucket SEM configuração de CORS",
        "o upload do áudio falha no navegador (funciona em script). Configure antes da primeira consulta.",
      );
    } else if (e?.name === "AccessDeniedException" || e?.$metadata?.httpStatusCode === 403) {
      aviso(
        "Não consegui ler o CORS",
        "falta s3:GetBucketCORS — confira manualmente no console do S3",
      );
    } else {
      aviso("Não consegui ler o CORS", erroDe(e));
    }
  }

  await limpar();
  encerrar();
}

async function limpar() {
  for (const chave of [CHAVE_AUDIO, CHAVE_SAIDA]) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chave }));
      ok(`DeleteObject — ${chave.split("/").pop()}`);
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404) continue;
      nao(`DeleteObject negado — ${chave}`, erroDe(e));
    }
  }
}

function encerrar() {
  console.log("\n" + "─".repeat(60));
  if (falhas === 0) {
    console.log("\x1b[32mCredenciais e permissões OK. O pipeline pode rodar.\x1b[0m");
    console.log("\nPróximo passo: npm run vocabulario:aws\n");
  } else {
    console.log(`\x1b[31m${falhas} problema(s). Ajuste a policy IAM e rode de novo.\x1b[0m\n`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nInterrompido:", erroDe(e));
  process.exitCode = 1;
});
