import type { NextConfig } from "next";
// NOTA: `withSentryConfig` (plugin de build do Sentry) foi REMOVIDO
// temporariamente — ele deixa o build pesado demais para o EC2 de 900MB de RAM
// (thrash > 10min) e para o disco local (cheio). O Sentry continua capturando
// erros de SERVIDOR pelo `src/instrumentation.ts` (`onRequestError`) + as
// `sentry.*.config.ts`, que NÃO dependem do plugin. O que se perde sem o plugin:
// upload de source map e parte da instrumentação de cliente/tracing.
// Reativar quando houver ambiente de build com mais RAM (t3.small) ou disco livre.

/**
 * Cabeçalhos de segurança aplicados a toda a aplicação.
 *
 * A CSP é mais permissiva que a do site institucional porque aqui há vídeo:
 * a Daily precisa carregar o próprio bundle, abrir WebSocket de sinalização e
 * conectar a servidores de mídia. `connect-src` e `frame-src` refletem isso.
 *
 * `media-src blob:` é o que permite reproduzir a stream local no `<video>`;
 * sem ele o preview da própria câmera fica preto.
 */

/**
 * Origem do bucket de áudio.
 *
 * O navegador sobe o áudio da consulta DIRETO para o S3, por URL pré-assinada
 * — o arquivo nunca passa pelo servidor Next. Isso significa que o S3 é um
 * destino de `connect-src`, e ele faltava aqui: a CSP bloqueava o PUT, o áudio
 * nunca chegava ao bucket e a transcrição nunca tinha o que transcrever.
 *
 * O sintoma era enganoso — `POST /audio` respondia 200 (só gera a URL) e o
 * PUT seguinte morria em silêncio, num `csp-violation` no console.
 *
 * Montado a partir das variáveis para liberar **só o bucket desta instalação**,
 * em vez de `*.amazonaws.com`, que abriria a AWS inteira como destino.
 */
const origemS3 =
  process.env.AWS_S3_BUCKET_AUDIO && process.env.AWS_REGION
    ? `https://${process.env.AWS_S3_BUCKET_AUDIO}.s3.${process.env.AWS_REGION}.amazonaws.com`
    : "";

const CSP = [
  "default-src 'self'",
  // `unsafe-eval`: exigência do runtime do Next em desenvolvimento E do call
  // machine da Daily (WebRTC/WASM) em produção — sem ele a sala de vídeo não
  // instancia. `blob:`/`data:`: o daily-react carrega o AudioWorklet do medidor
  // de voz por uma `data:` URI (e workers do Daily por `blob:`) — sem eles a
  // câmera funciona mas o microfone não é medido. É o preço de rodar Daily.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://*.daily.co",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.daily.co",
  // A Daily serve mídia e o bundle da chamada também por *.dailywebrtc.com/.net,
  // não só por *.daily.co — sem estes, o vídeo não conecta.
  "media-src 'self' blob: https://*.daily.co https://*.dailywebrtc.com https://*.dailywebrtc.net",
  "font-src 'self'",
  // `*.ingest.us.sentry.io`: o SDK do Sentry (cliente) envia erros/traces para lá
  // por fetch — sem isto na CSP, o relato do navegador seria bloqueado.
  `connect-src 'self' https://*.daily.co wss://*.daily.co https://*.wss.daily.co https://*.dailywebrtc.com https://*.dailywebrtc.net wss://*.dailywebrtc.com wss://*.dailywebrtc.net https://*.ingest.us.sentry.io${origemS3 ? ` ${origemS3}` : ""}`,
  "frame-src 'self' https://*.daily.co",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  // Disco apertado (local e no EC2): o cache de build do webpack (`.next/cache`)
  // enche o disco durante o `next build` e causa ENOSPC. Desligado para o build
  // caber — o custo é rebuild um pouco mais lento (sem cache incremental).
  webpack: (config) => {
    config.cache = false;
    return config;
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Câmera e microfone liberados para a própria origem — a
            // teleconsulta depende deles. Geolocalização e pagamento, não.
            value: "camera=(self), microphone=(self), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
      {
        // Nada da área autenticada pode ficar em cache intermediário.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
    ];
  },
};

export default nextConfig;
