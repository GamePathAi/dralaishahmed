/**
 * Sentry — runtime do navegador (cliente). Erros de client component +
 * spans de navegação do App Router.
 *
 * SEM Session Replay de propósito: gravaria a tela — que aqui mostra prontuário,
 * transcrição e dados de paciente. Sem PII (dataCollection omitido = padrão
 * conservador). Só captura o erro em si + a navegação.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
