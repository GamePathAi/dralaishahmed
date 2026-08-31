/**
 * Diagnóstico do login da médica — diz QUAL fator está falhando.
 *
 *     npx tsx --env-file=.env scripts/diagnostico-login.ts
 *
 * A tela de login esconde de propósito qual dos dois fatores falhou (não dar
 * pista a quem tenta adivinhar). Aqui, com acesso ao banco, essa proteção não
 * faz sentido — e sem ela não dá para consertar.
 *
 * A senha é lida com eco desligado e não é gravada em lugar nenhum. O segredo
 * TOTP nunca é impresso.
 *
 * Temporário: pode apagar depois de resolver.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaClient } from "@prisma/client";
import { verificarSenha, verificarTotp, gerarCodigoTotp } from "../src/lib/seguranca";

const prisma = new PrismaClient();

/** Lê sem exibir o que é digitado (mesma técnica de definir-senha-medica.ts). */
async function perguntarOculto(rotulo: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const escrever = (stdout as unknown as { write: (s: string) => boolean }).write.bind(stdout);
  let silenciar = false;

  (stdout as unknown as { write: (s: string) => boolean }).write = (s: string) =>
    silenciar ? true : escrever(s);

  escrever(rotulo);
  silenciar = true;
  const resposta = await rl.question("");
  silenciar = false;
  (stdout as unknown as { write: (s: string) => boolean }).write = escrever;
  escrever("\n");
  rl.close();

  return resposta;
}

async function perguntar(rotulo: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const resposta = await rl.question(rotulo);
  rl.close();
  return resposta;
}

async function main() {
  const medica = await prisma.usuario.findFirst({
    where: { papel: "MEDICA" },
    select: { nome: true, email: true, senhaHash: true, totpSecret: true },
  });

  if (!medica) {
    console.error("\nNenhuma médica cadastrada. Rode: npm run db:seed\n");
    process.exit(1);
  }

  console.log(`\nConta: ${medica.nome} <${medica.email}>`);
  console.log(`  senha definida: ${medica.senhaHash ? "sim" : "NÃO"}`);
  console.log(`  segundo fator:  ${medica.totpSecret ? "sim" : "NÃO"}\n`);

  if (!medica.senhaHash || !medica.totpSecret) {
    console.error("Conta incompleta — rode: npm run medica:senha\n");
    process.exit(1);
  }

  console.log("Digite exatamente o que você digita na tela de login.\n");

  const senha = await perguntarOculto("Senha (não aparece na tela): ");
  const totp = await perguntar("Código de 6 dígitos do aplicativo: ");

  const senhaOk = await verificarSenha(senha, medica.senhaHash);
  const totpOk = verificarTotp(totp, medica.totpSecret);

  console.log("\n" + "─".repeat(52));
  console.log(`  SENHA:  ${senhaOk ? "\x1b[32mOK\x1b[0m" : "\x1b[31mERRADA\x1b[0m"}`);
  console.log(`  CÓDIGO: ${totpOk ? "\x1b[32mOK\x1b[0m" : "\x1b[31mERRADO\x1b[0m"}`);
  console.log("─".repeat(52));

  if (!totpOk) {
    const restante = 30 - (Math.floor(Date.now() / 1000) % 30);
    console.log(`\n  Código correto agora: \x1b[1m${gerarCodigoTotp(medica.totpSecret)}\x1b[0m (expira em ${restante}s)`);
    console.log(`  Hora deste computador: ${new Date().toISOString()}`);
    console.log(`\n  Se o código acima é DIFERENTE do que o aplicativo mostra,`);
    console.log(`  o aplicativo está com um segredo antigo: recadastre com`);
    console.log(`  o QR de 'npm run totp'.`);
  }

  if (!senhaOk) {
    console.log("\n  Redefina com: npm run medica:senha");
    console.log("  (ele preserva o segundo fator já cadastrado)");
  }

  if (senhaOk && totpOk) {
    console.log("\n  Os dois fatores conferem. Se a tela ainda recusa, o");
    console.log("  problema não é credencial — é o servidor Next apontando");
    console.log("  para outro banco (confira DATABASE_URL do processo do dev).");
  }

  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
