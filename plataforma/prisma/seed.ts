/**
 * Seed inicial: cria a médica e uma disponibilidade de exemplo.
 *
 * Deliberadamente NÃO define senha aqui. Senha em arquivo de seed acaba
 * versionada, copiada para o ambiente errado e esquecida em produção. Depois de
 * rodar o seed, use:
 *
 *     npm run medica:senha
 *
 * que pede a senha no terminal, gera o segredo TOTP e mostra a chave para
 * cadastrar no aplicativo autenticador — sem nada disso tocar o disco.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Ajuste antes de rodar.
const MEDICA = {
  nome: "Laís Caroline Hahmed",
  email: "contato@dralaishahmed.com.br",
  telefone: "(67) 99187-3948",
};

/** Minutos desde a meia-noite, no fuso da médica. */
const hora = (h: number, m = 0) => h * 60 + m;

async function main() {
  console.log("Criando médica…");

  const medica = await prisma.usuario.upsert({
    where: { email: MEDICA.email },
    create: { ...MEDICA, papel: "MEDICA" },
    update: { nome: MEDICA.nome, telefone: MEDICA.telefone },
  });

  console.log(`  ✓ ${medica.nome} (${medica.id})`);

  const jaTem = await prisma.disponibilidade.count({
    where: { medicaId: medica.id },
  });

  if (jaTem > 0) {
    console.log(`\nJá existem ${jaTem} janelas — nada a fazer.`);
  } else {
    console.log("\nCriando disponibilidade de exemplo…");

    // Segunda a sexta, tarde, teleconsulta de 30 min com 10 de intervalo.
    // Ajuste pela tela /agenda/disponibilidade depois.
    const janelas = [1, 2, 3, 4, 5].map((diaSemana) => ({
      medicaId: medica.id,
      diaSemana,
      inicioMin: hora(14),
      fimMin: hora(18),
      modalidade: "TELECONSULTA" as const,
      duracaoMin: 30,
      intervaloMin: 10,
    }));

    await prisma.disponibilidade.createMany({ data: janelas });

    // A conta que a tela mostra: passo = duração + intervalo.
    const porDia = Math.floor((hora(18) - hora(14)) / (30 + 10));
    console.log(
      `  ✓ 5 janelas (seg–sex, 14h–18h) — ${porDia} encaixes/dia, ${porDia * 5}/semana`,
    );
  }

  console.log("\n" + "─".repeat(60));
  console.log("Próximo passo — definir senha e segundo fator:");
  console.log("\n    npm run medica:senha\n");
  console.log("Sem isso, o acesso profissional não funciona.");
  console.log("─".repeat(60));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
