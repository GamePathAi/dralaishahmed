/**
 * POST /api/medica/segundo-fator
 *
 * Mostra o QR do autenticador atual, ou troca o segredo por um novo.
 *
 * **Exige a senha de novo, mesmo com sessão aberta.** Não é burocracia: quem
 * revela ou troca o segundo fator está, na prática, decidindo qual aparelho
 * tem acesso a todos os prontuários. Uma sessão esquecida aberta num consultório
 * não pode bastar para isso — a senha é a prova de que é ela ali.
 *
 * Trocar o segredo **derruba o aparelho antigo na hora**. Por isso `trocar`
 * é uma ação explícita e separada de `ver`, nunca um efeito colateral.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verificarSenha, verificarTotp, gerarSegredoTotp } from "@/lib/seguranca";
import { uriAutenticador, qrSvg } from "@/lib/segundo-fator";
import { consumir } from "@/lib/rate-limit";
import { ipDoPedido } from "@/lib/pedido";

export const dynamic = "force-dynamic";

const Corpo = z.object({
  senha: z.string().min(1).max(200),
  // O código do autenticador atual é exigido junto da senha: ver o segredo é
  // clonar o 2FA, e trocá-lo derruba o aparelho legítimo. Sem provar posse do
  // aparelho atual, uma sessão viva + senha (phishing) bastaria para clonar
  // permanentemente o segundo fator da conta que abre todos os prontuários.
  codigo: z.string().regex(/^\d{6}$/, "Código de 6 dígitos."),
  acao: z.enum(["ver", "trocar"]),
});

export async function POST(req: NextRequest) {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const analise = Corpo.safeParse(await req.json().catch(() => ({})));
  if (!analise.success) {
    return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  }
  const { senha, codigo, acao } = analise.data;

  const medica = await prisma.usuario.findUnique({
    where: { id: sessao.user.id },
    select: { id: true, email: true, senhaHash: true, totpSecret: true },
  });

  if (!medica?.senhaHash || !medica.totpSecret) {
    return NextResponse.json(
      { erro: "Conta sem credenciais definidas.", codigo: "SEM_2FA" },
      { status: 409 },
    );
  }

  // ---- reautenticação: os DOIS fatores ------------------------------------
  // Trava por conta contra força bruta do código a partir de uma sessão viva.
  const trava = consumir(`2fa-op:${medica.id}`, 5, 15 * 60_000);
  if (!trava.ok) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Aguarde alguns minutos." },
      { status: 429 },
    );
  }

  const senhaOk = await verificarSenha(senha, medica.senhaHash);
  const codigoOk = verificarTotp(codigo, medica.totpSecret);
  if (!senhaOk || !codigoOk) {
    // Sem dizer qual dos dois — não dar pista a quem adivinha.
    return NextResponse.json(
      { erro: "Senha ou código incorretos." },
      { status: 401 },
    );
  }

  const ip = ipDoPedido(req);

  // ---- troca -------------------------------------------------------------
  if (acao === "trocar") {
    const segredo = gerarSegredoTotp();
    await prisma.usuario.update({
      where: { id: medica.id },
      data: { totpSecret: segredo },
    });

    await prisma.auditoria.create({
      data: {
        usuarioId: medica.id,
        acao: "TROCOU_SEGUNDO_FATOR",
        recursoId: medica.id,
        ip,
      },
    });

    const uri = uriAutenticador({ email: medica.email, segredo });
    return NextResponse.json({
      svg: await qrSvg(uri),
      chave: segredo,
      trocado: true,
    });
  }

  // ---- visualização do atual ---------------------------------------------
  if (!medica.totpSecret) {
    return NextResponse.json(
      { erro: "Esta conta ainda não tem segundo fator.", codigo: "SEM_2FA" },
      { status: 409 },
    );
  }

  await prisma.auditoria.create({
    data: {
      usuarioId: medica.id,
      acao: "VISUALIZOU_SEGUNDO_FATOR",
      recursoId: medica.id,
      ip,
    },
  });

  const uri = uriAutenticador({ email: medica.email, segredo: medica.totpSecret });
  return NextResponse.json({
    svg: await qrSvg(uri),
    chave: medica.totpSecret,
    trocado: false,
  });
}
