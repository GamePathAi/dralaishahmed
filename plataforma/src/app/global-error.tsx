"use client";

/**
 * Captura erros do layout raiz e de render do React (que os `error.tsx` de
 * segmento não pegam) e reporta ao Sentry.
 *
 * Antes renderizava `NextError statusCode={0}`, que é uma tela praticamente EM
 * BRANCO — a médica via o app "sumir" sem entender o que houve, sem saída. Agora
 * mostra uma mensagem clara e um botão de recarregar. O erro continua indo pro
 * Sentry para a gente investigar a causa.
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0f172a",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center", color: "#e2e8f0" }}>
          <div
            style={{
              margin: "0 auto 16px",
              width: 48,
              height: 48,
              display: "grid",
              placeItems: "center",
              borderRadius: 9999,
              background: "#1e293b",
              fontSize: 22,
            }}
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            Algo deu errado nesta tela
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#94a3b8", margin: "0 0 24px" }}>
            Não foi você — um erro inesperado interrompeu esta página. Nada do que
            já foi salvo no prontuário se perde. Recarregue para continuar; se
            persistir, avise o suporte.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "12px 24px",
                borderRadius: 12,
                border: "none",
                background: "#0d9488",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Recarregar a página
            </button>
            <a
              href="/agenda"
              style={{
                padding: "12px 24px",
                borderRadius: 12,
                border: "1px solid #334155",
                color: "#cbd5e1",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Voltar à agenda
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
