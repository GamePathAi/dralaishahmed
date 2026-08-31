/**
 * Define senha e segundo fator da médica.
 *
 *     npm run medica:senha
 *
 * A senha é lida do terminal com eco desligado e nunca é gravada em disco,
 * histórico do shell ou variável de ambiente. O segredo TOTP aparece uma única
 * vez na tela — depois disso, só existe hasheado no banco e no aplicativo
 * autenticador dela.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaClient } from "@prisma/client";
import { gerarHashSenha, gerarSegredoTotp } from "../src/lib/seguranca";
import { uriAutenticador, qrTerminal } from "../src/lib/segundo-fator";

const prisma = new PrismaClient();

/** Lê sem exibir o que é digitado. */
async function perguntarOculto(rotulo: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  // O readline não tem modo silencioso nativo: interceptamos a escrita da saída
  // enquanto a pergunta está no ar, deixando passar só o rótulo.
  const escrever = (
    stdout as unknown as { write: (s: string) => boolean }
  ).write.bind(stdout);
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

async function main() {
  const medica = await prisma.usuario.findFirst({
    where: { papel: "MEDICA" },
    select: { id: true, nome: true, email: true, totpSecret: true },
  });

  if (!medica) {
    console.error("Nenhuma médica cadastrada. Rode antes: npm run db:seed");
    process.exit(1);
  }

  console.log(`\nDefinindo credenciais de ${medica.nome} (${medica.email})\n`);

  const senha = await perguntarOculto("Nova senha (mínimo 12 caracteres): ");
  if (senha.length < 12) {
    console.error("\nSenha curta demais. Esta conta acessa todos os prontuários.");
    process.exit(1);
  }

  const confirmacao = await perguntarOculto("Repita a senha: ");
  if (senha !== confirmacao) {
    console.error("\nAs senhas não conferem.");
    process.exit(1);
  }

  const senhaHash = await gerarHashSenha(senha);

  // Só gera segredo novo se ainda não houver — regerar invalidaria o
  // aplicativo já configurado dela sem aviso.
  const totpSecret = medica.totpSecret ?? gerarSegredoTotp();
  const novoTotp = !medica.totpSecret;

  await prisma.usuario.update({
    where: { id: medica.id },
    data: { senhaHash, totpSecret },
  });

  console.log("\n✓ Senha atualizada.");

  if (novoTotp) {
    const uri = uriAutenticador({ email: medica.email, segredo: totpSecret });

    console.log("\n" + "─".repeat(64));
    console.log("SEGUNDO FATOR — cadastre agora, aparece só uma vez.\n");
    console.log("Abra o autenticador, toque em adicionar e ESCANEIE:\n");

    // O QR é o que torna isto viável para quem não é técnico. Digitar 20
    // caracteres em base32 no celular é onde o cadastro do segundo fator
    // costuma ser abandonado.
    console.log(await qrTerminal(uri));

    console.log("  Se a câmera não pegar, use a opção de chave manual:\n");
    console.log(`    Chave:  ${totpSecret}`);
    console.log("    Tipo:   baseada em tempo (TOTP)\n");
    console.log("  Google Authenticator, Authy, Microsoft, 1Password — qualquer um serve.");
    console.log("─".repeat(64));
    console.log("\nConfirme que o app gera um código antes de fechar o terminal.");
  } else {
    console.log("Segundo fator mantido — o aplicativo já cadastrado continua valendo.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
