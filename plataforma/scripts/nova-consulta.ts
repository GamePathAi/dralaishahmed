/**
 * Cria uma consulta de teste pronta para entrar na sala.
 *
 *     npm run nova:consulta -- <email>
 *
 * **Não apaga nada.** Existe porque "preparar um teste" e "limpar o banco" são
 * coisas diferentes que estavam juntas no `limpar:teste` — e essa confusão
 * custou prontuários assinados, apagados a cada link de teste gerado.
 *
 * Só desenvolvimento: cria consulta já marcada como confirmada por e-mail sem
 * enviar e-mail nenhum, e coloca o horário dentro da janela da sala.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] ?? "").toLowerCase().trim();
  if (!email) {
    console.error("\nuso: npm run nova:consulta -- <email>\n");
    process.exit(1);
  }

  if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")) {
    console.error("\nRECUSADO: DATABASE_URL não aponta para localhost.\n");
    process.exit(1);
  }

  const usuario = await prisma.usuario.findUnique({
    where: { email },
    select: { nome: true, papel: true, paciente: { select: { id: true } } },
  });

  if (!usuario?.paciente || usuario.papel !== "PACIENTE") {
    console.error(`\n${email} não é um paciente cadastrado.\n`);
    process.exit(1);
  }

  const medica = await prisma.usuario.findFirstOrThrow({
    where: { papel: "MEDICA" },
    select: { id: true },
  });

  // Começa em 5 min: a sala abre 15 min antes, então já está aberta.
  const consulta = await prisma.consulta.create({
    data: {
      pacienteId: usuario.paciente.id,
      medicaId: medica.id,
      inicioEm: new Date(Date.now() + 5 * 60_000),
      duracaoMin: 30,
      modalidade: "TELECONSULTA",
      motivo: "Teste da sala",
      status: "AGENDADA",
      // Criada direto no banco não dispara e-mail; sem isto ela apareceria
      // como "não avisado" na agenda, que é alarme falso.
      confirmacaoEnviadaEm: new Date(),
    },
  });

  const registros = await prisma.registroClinico.count({
    where: { pacienteId: usuario.paciente.id },
  });

  const BASE = process.env.AUTH_URL ?? "http://localhost:3000";
  console.log(`
${"─".repeat(62)}
\x1b[1mCONSULTA CRIADA\x1b[0m — ${usuario.nome}, começa em 5 minutos

  Paciente (janela anônima):
    ${BASE}/sala/${consulta.id}

  Médica (janela normal):
    ${BASE}/atendimento/${consulta.id}

  Mesmo id nos dois. Se divergirem, cada um espera o outro para sempre.

  Prontuário preservado: ${registros} registro(s) — nada foi apagado.
${"─".repeat(62)}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
