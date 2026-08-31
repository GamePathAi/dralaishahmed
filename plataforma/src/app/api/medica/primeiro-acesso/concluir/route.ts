/**
 * POST /api/medica/primeiro-acesso/concluir — grava senha e segundo fator.
 *
 * O código de 6 dígitos é exigido AQUI, antes de salvar: é a prova de que o
 * aplicativo foi cadastrado com o segredo certo. Sem essa confirmação, um
 * QR escaneado errado (ou não escaneado) só apareceria no primeiro login —
 * com a conta já trancada atrás de um segundo fator que ninguém tem.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { gerarHashSenha, verificarTotp } from "@/lib/seguranca";
import { ipDoPedido } from "@/lib/pedido";

export const dynamic = "force-dynamic";

const PREFIXO = "primeiro-acesso:";

const Corpo = z.object({
  token: z.string().min(20),
  senha: z.string().min(12, "A senha precisa de pelo menos 12 caracteres."),
  segredo: z.string().regex(/^[A-Z2-7]{16,64}$/, "Segredo inválido."),
  codigo: z.string().regex(/^\d{6}$/, "Código de 6 dígitos."),
});

export async function POST(req: NextRequest) {
  const analise = Corpo.safeParse(await req.json().catch(() => ({})));
  if (!analise.success) {
    return NextResponse.json(
      { erro: analise.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }
  const { token, senha, segredo, codigo } = analise.data;

  const registro = await prisma.tokenVerificacao.findFirst({
    where: { token, identifier: { startsWith: PREFIXO } },
  });

  if (!registro || registro.expires < new Date()) {
    return NextResponse.json(
      {
        erro: "Este link expirou ou já foi usado. Peça um novo na tela de acesso.",
        codigo: "TOKEN_INVALIDO",
      },
      { status: 410 },
    );
  }

  const email = registro.identifier.slice(PREFIXO.length);
  const medica = await prisma.usuario.findUnique({
    where: { email },
    select: { id: true, papel: true, senhaHash: true, totpSecret: true },
  });

  // O alvo precisa continuar elegível: se alguém configurou nesse meio tempo,
  // este link não pode sobrescrever — seria troca de credencial por e-mail.
  if (!medica || medica.papel !== "MEDICA" || medica.senhaHash || medica.totpSecret) {
    await prisma.tokenVerificacao.delete({ where: { token } }).catch(() => {});
    return NextResponse.json(
      { erro: "Esta conta já está configurada.", codigo: "JA_CONFIGURADA" },
      { status: 409 },
    );
  }

  // Prova de que o aplicativo gera códigos deste segredo.
  if (!verificarTotp(codigo, segredo)) {
    return NextResponse.json(
      {
        erro:
          "O código não confere. Confirme que você escaneou o QR desta página " +
          "e digite o código atual do aplicativo.",
        codigo: "CODIGO_INVALIDO",
      },
      { status: 422 },
    );
  }

  await prisma.$transaction([
    prisma.usuario.update({
      where: { id: medica.id },
      data: { senhaHash: await gerarHashSenha(senha), totpSecret: segredo },
    }),
    // Uso único: o token morre junto com a gravação.
    prisma.tokenVerificacao.delete({ where: { token } }),
    prisma.auditoria.create({
      data: {
        usuarioId: medica.id,
        acao: "TROCOU_SEGUNDO_FATOR",
        recursoId: medica.id,
        detalhe: { origem: "primeiro-acesso" },
        ip: ipDoPedido(req),
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
