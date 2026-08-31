/**
 * Sentry — runtime Node.js (rotas de API, server components, cron).
 *
 * App de saúde (LGPD): configurado para NÃO vazar dado de paciente.
 * - `dataCollection` omitido → cai no padrão conservador (`sendDefaultPii=false`).
 * - `includeLocalVariables: false` → não anexa variáveis locais ao stack (podem
 *   conter nome/CPF/nota clínica).
 * - `enableLogs: false` → não embarca logs (que poderiam carregar dado sensível).
 * - Sem Session Replay (só existe no cliente; aqui nem se aplica).
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  includeLocalVariables: false,
  enableLogs: false,
});
