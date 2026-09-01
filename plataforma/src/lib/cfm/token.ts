/**
 * Token OAuth do nosso sistema junto ao IAM do CFM (client_credentials).
 *
 * REGRA DO CFM (do README): NÃO pedir um token a cada chamada — ele vale alguns
 * minutos e deve ser REAPROVEITADO, senão o sistema é bloqueado. Por isso o
 * cache em módulo (a app é instância única). O `client_secret` é confidencial e
 * fica só aqui no servidor.
 *
 * Em SIMULACAO o mock do CFM ignora o token — devolvemos um placeholder.
 */

import { env } from "@/lib/env";

let cache: { token: string; expiraEm: number } | null = null;

export async function obterTokenPrescricaoCfm(): Promise<string> {
  if (env.CFM_AMBIENTE === "SIMULACAO") return "simulacao";

  // Reaproveita enquanto faltarem >30s para expirar.
  if (cache && cache.expiraEm > Date.now() + 30_000) return cache.token;

  if (!env.CFM_IAM_URL || !env.CFM_CLIENT_ID || !env.CFM_CLIENT_SECRET) {
    // O fail-safe do env.ts já barra CFM_ATIVO fora de SIMULACAO sem credencial;
    // esta guarda é a segunda barreira.
    throw new Error(
      "Credenciais do CFM ausentes (CFM_IAM_URL/CFM_CLIENT_ID/CFM_CLIENT_SECRET).",
    );
  }

  const r = await fetch(env.CFM_IAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.CFM_CLIENT_ID,
      client_secret: env.CFM_CLIENT_SECRET,
      scope: "openid",
    }),
  });
  if (!r.ok) {
    throw new Error(`IAM do CFM devolveu ${r.status} ao obter o token.`);
  }
  const d = (await r.json()) as { access_token: string; expires_in?: number };
  cache = {
    token: d.access_token,
    expiraEm: Date.now() + (d.expires_in ?? 300) * 1000,
  };
  return cache.token;
}
