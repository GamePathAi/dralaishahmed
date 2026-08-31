/**
 * Mostra o código TOTP atual da médica.
 *
 *     npm run totp
 *
 * Existe para desenvolvimento e para socorro: quando o autenticador não está à
 * mão e é preciso entrar. Em produção o acesso normal é pelo aplicativo — este
 * script exige acesso ao banco, que já é acesso total de qualquer forma.
 *
 * Imprime também um QR no terminal: cadastrar uma vez no celular é melhor do
 * que voltar aqui a cada 30 segundos.
 */

import { PrismaClient } from "@prisma/client";
import { gerarCodigoTotp } from "../src/lib/seguranca";
import { uriAutenticador, qrTerminal } from "../src/lib/segundo-fator";

const prisma = new PrismaClient();

async function main() {
  const medica = await prisma.usuario.findFirstOrThrow({
    where: { papel: "MEDICA" },
    select: { nome: true, email: true, totpSecret: true, senhaHash: true },
  });

  if (!medica.totpSecret) {
    console.error(
      "\nEsta conta ainda não tem segundo fator. Rode: npm run medica:senha\n",
    );
    process.exit(1);
  }

  const restante = 30 - (Math.floor(Date.now() / 1000) % 30);
  const codigo = gerarCodigoTotp(medica.totpSecret);
  const uri = uriAutenticador({
    email: medica.email,
    segredo: medica.totpSecret,
  });

  console.log(`
${"─".repeat(56)}
  ${medica.nome} — ${medica.email}

  CÓDIGO:  \x1b[1m\x1b[36m${codigo}\x1b[0m
  Expira em ${restante}s${restante < 8 ? "  \x1b[33m(quase vencendo — rode de novo)\x1b[0m" : ""}

  Senha definida: ${medica.senhaHash ? "sim" : "NÃO — rode npm run medica:senha"}
${"─".repeat(56)}

  Para parar de depender deste script, escaneie no autenticador:
`);

  console.log(await qrTerminal(uri));

  console.log(`  Se a câmera não pegar, use a chave manual:

    Chave:  \x1b[1m${medica.totpSecret}\x1b[0m
    Tipo:   baseada em tempo (TOTP)

${"─".repeat(56)}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
