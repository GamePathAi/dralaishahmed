/**
 * GET /api/cfm/token-prescricao
 *
 * O frontend pede este token ao carregar o componente do CFM (ver a lib de
 * Prescrição Eletrônica). O `client_secret` é confidencial e nunca vai ao
 * cliente — só o token de curta duração. Em SIMULACAO devolve um placeholder
 * (o mock não valida). Só responde quando `CFM_ATIVO`.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { obterTokenPrescricaoCfm } from "@/lib/cfm/token";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  if (!env.CFM_ATIVO) {
    return NextResponse.json(
      { erro: "Integração CFM desligada.", codigo: "CFM_DESLIGADO" },
      { status: 409 },
    );
  }

  try {
    const accessToken = await obterTokenPrescricaoCfm();
    return NextResponse.json(
      { access_token: accessToken, token_type: "Bearer" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[cfm] falha ao obter token", e);
    return NextResponse.json(
      { erro: "Não foi possível obter o token do CFM.", codigo: "CFM_TOKEN_FALHOU" },
      { status: 502 },
    );
  }
}
