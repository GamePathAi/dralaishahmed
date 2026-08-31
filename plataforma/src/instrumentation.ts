/**
 * Hook de instrumentação do Next (server-side). Carrega o Sentry no runtime
 * certo e captura todo erro de request de servidor (rotas de API, RSC).
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura automaticamente erros não tratados de request no servidor.
export const onRequestError = Sentry.captureRequestError;
