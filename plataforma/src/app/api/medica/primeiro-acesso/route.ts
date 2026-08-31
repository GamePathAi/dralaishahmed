/**
 * POST /api/medica/primeiro-acesso — pede o link de configuração inicial.
 *
 * Existe porque o único caminho para o primeiro cadastro era um script
 * interativo via SSH — inviável para quem não opera servidor. Este fluxo move
 * a configuração para o navegador: link por e-mail → definir senha → escanear
 * QR → confirmar o código → pronto.
 *
 * **Só funciona enquanto a conta NÃO tem credencial.** É bootstrap, não
 * recuperação: depois de configurada, quem perde o segundo fator continua
 * precisando de acesso ao servidor — se um e-mail bastasse para REDEFINIR o
 * acesso, tomar a caixa de e-mail tomaria todos os prontuários. Para o
 * bootstrap essa troca é aceitável: a alternativa era o SSH, e a conta ainda
 * não guarda nada.
 *
 * A resposta é sempre a mesma, exista a conta ou não, esteja configurada ou
 * não — enumeração de e-mail aqui diria a qualquer um qual endereço controla a
 * plataforma.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enviarPrimeiroAcesso } from "@/lib/email";
import { env } from "@/lib/env";
import { consumir } from "@/lib/rate-limit";
import { ipDoPedido } from "@/lib/pedido";

export const dynamic = "force-dynamic";

const Corpo = z.object({ email: z.string().email() });

/** Prefixo que separa estes tokens dos magic links de paciente na mesma tabela. */
const PREFIXO_PRIMEIRO_ACESSO = "primeiro-acesso:";

const RESPOSTA_NEUTRA = NextResponse.json({
  mensagem:
    "Se este e-mail corresponder a uma conta profissional ainda não configurada, " +
    "o link de configuração foi enviado para ele.",
});

export async function POST(req: NextRequest) {
  const analise = Corpo.safeParse(await req.json().catch(() => ({})));
  if (!analise.success) {
    return NextResponse.json({ erro: "Informe um e-mail válido." }, { status: 400 });
  }
  const email = analise.data.email.toLowerCase().trim();

  // Sem trava, este endpoint dispara e-mail e invalida o link anterior a cada
  // request. 3 pedidos / 10 min por IP mantém o bootstrap utilizável e barra o
  // uso como canhão de e-mail.
  const limite = consumir(`primeiro-acesso:${ipDoPedido(req) ?? "sem-ip"}`, 3, 10 * 60_000);
  if (!limite.ok) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Aguarde alguns minutos." },
      { status: 429, headers: { "Retry-After": String(limite.esperaSeg) } },
    );
  }

  const medica = await prisma.usuario.findUnique({
    where: { email },
    select: { papel: true, senhaHash: true, totpSecret: true },
  });

  // Qualquer desvio termina na mesma resposta, sem revelar qual regra barrou.
  const elegivel =
    medica?.papel === "MEDICA" && !medica.senhaHash && !medica.totpSecret;
  if (!elegivel) return RESPOSTA_NEUTRA;

  const identifier = PREFIXO_PRIMEIRO_ACESSO + email;

  // Um pedido novo invalida o anterior — nunca há dois links vivos.
  await prisma.tokenVerificacao.deleteMany({ where: { identifier } });

  const token = randomBytes(32).toString("base64url");
  await prisma.tokenVerificacao.create({
    data: {
      identifier,
      token,
      expires: new Date(Date.now() + 30 * 60_000),
    },
  });

  const url = `${env.AUTH_URL.replace(/\/$/, "")}/primeiro-acesso/${token}`;

  // Fire-and-forget: NÃO usar `await`. Aguardar o SMTP faria a resposta do
  // caminho elegível demorar mais que a do não-elegível — um oráculo de tempo que
  // revelaria qual e-mail controla a plataforma. Falha de SMTP também não pode
  // virar resposta diferente (enumeração pelo erro).
  void enviarPrimeiroAcesso({ email, url }).catch((erro) =>
    console.error("[primeiro-acesso] falha ao enviar", erro),
  );

  return RESPOSTA_NEUTRA;
}
