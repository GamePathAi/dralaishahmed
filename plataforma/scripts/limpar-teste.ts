/**
 * Apaga consultas de teste de um paciente e deixa uma consulta nova pronta.
 *
 *     npm run limpar:teste -- <email>
 *     npm run limpar:teste -- <email> --incluir-assinados
 *
 * SOMENTE DESENVOLVIMENTO. Duas travas, e as duas existem por motivo concreto:
 *
 *  1. **Localhost obrigatório.** É o que separa "limpar bagunça de teste" de
 *     "destruir prontuário". Não é opcional.
 *
 *  2. **Consulta com registro ASSINADO é preservada por padrão.** Isto foi
 *     aprendido do jeito caro: o script era usado repetidamente para gerar
 *     links de teste, e cada execução apagava o prontuário que a médica tinha
 *     acabado de assinar. Preparar uma consulta nova não exige destruir as
 *     antigas — a versão anterior confundia as duas coisas.
 *
 * Registro assinado só sai com `--incluir-assinados`, escrito à mão.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] ?? "").toLowerCase().trim();
  if (!email) {
    console.error("\nuso: npm run limpar:teste -- <email>\n");
    process.exit(1);
  }

  if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")) {
    console.error(
      "\nRECUSADO: DATABASE_URL não aponta para localhost.\n" +
        "Este script apaga prontuário. Contra banco real, isso é irreversível.\n",
    );
    process.exit(1);
  }

  const usuario = await prisma.usuario.findUnique({
    where: { email },
    select: { id: true, nome: true, papel: true, paciente: { select: { id: true } } },
  });

  if (!usuario?.paciente) {
    console.error(`\nNenhum paciente com o e-mail ${email}.\n`);
    process.exit(1);
  }
  if (usuario.papel !== "PACIENTE") {
    console.error(`\n${email} não é paciente (papel: ${usuario.papel}). Recusado.\n`);
    process.exit(1);
  }

  const pacienteId = usuario.paciente.id;
  const consultas = await prisma.consulta.findMany({
    where: { pacienteId },
    select: { id: true, status: true, inicioEm: true, motivo: true },
    orderBy: { inicioEm: "asc" },
  });

  const [registros, transcricoes, consentimentos] = await Promise.all([
    prisma.registroClinico.count({ where: { pacienteId } }),
    prisma.transcricao.count({ where: { consultaId: { in: consultas.map((c) => c.id) } } }),
    prisma.consentimento.count({ where: { consultaId: { in: consultas.map((c) => c.id) } } }),
  ]);

  console.log(`\n\x1b[1mSerá apagado — ${usuario.nome} <${email}>\x1b[0m`);
  console.log(`${"─".repeat(60)}`);
  for (const c of consultas) {
    console.log(
      `  ${c.inicioEm.toISOString().slice(0, 16).replace("T", " ")}  ` +
        `${c.status.padEnd(13)} ${c.motivo ?? ""}`,
    );
  }
  console.log(
    `\n  ${consultas.length} consulta(s), ${registros} registro(s) clínico(s), ` +
      `${transcricoes} transcrição(ões), ${consentimentos} consentimento(s)`,
  );

  if (consultas.length === 0) {
    console.log("\nNada a fazer.\n");
    return;
  }

  // ---- o que NÃO se apaga sem ordem explícita ----------------------------
  //
  // Registro assinado é prontuário. Este script existe para tirar lixo de
  // teste do caminho, não para destruir o que a médica assinou — e a diferença
  // se perde fácil quando alguém roda "limpar" cinco vezes seguidas para
  // preparar links de teste. Já custou registros reais uma vez.
  const assinadas = new Set(
    (
      await prisma.registroClinico.findMany({
        where: {
          consultaId: { in: consultas.map((c) => c.id) },
          status: { in: ["ASSINADO", "RETIFICADO"] },
        },
        select: { consultaId: true },
      })
    ).map((r) => r.consultaId),
  );

  const forcar = process.argv.includes("--incluir-assinados");
  const ids = consultas
    .map((c) => c.id)
    .filter((id) => forcar || !assinadas.has(id));

  if (assinadas.size > 0 && !forcar) {
    console.log(
      `\n\x1b[33m${assinadas.size} consulta(s) preservada(s)\x1b[0m — têm registro ASSINADO.\n` +
        "  Prontuário assinado não é lixo de teste. Para apagar mesmo assim:\n" +
        "    npm run limpar:teste -- <email> --incluir-assinados\n",
    );
  }

  if (ids.length === 0) {
    console.log("Nada a apagar.\n");
  } else {
    // Ordem ditada pelas chaves estrangeiras: os dependentes primeiro.
    await prisma.registroClinico.deleteMany({ where: { consultaId: { in: ids } } });
    await prisma.transcricao.deleteMany({ where: { consultaId: { in: ids } } });
    await prisma.consentimento.deleteMany({ where: { consultaId: { in: ids } } });
    await prisma.consulta.deleteMany({ where: { id: { in: ids } } });

    // A trilha de auditoria aponta por `recursoId` (sem FK), então sobreviveria
    // órfã. Some junto: auditoria de consulta que não existe mais é ruído.
    await prisma.auditoria.deleteMany({ where: { recursoId: { in: ids } } });

    console.log(`\n\x1b[32m✓ ${ids.length} consulta(s) apagada(s).\x1b[0m`);
  }

  // ---- uma consulta limpa para seguir testando ---------------------------
  const medica = await prisma.usuario.findFirstOrThrow({
    where: { papel: "MEDICA" },
    select: { id: true },
  });

  const nova = await prisma.consulta.create({
    data: {
      pacienteId,
      medicaId: medica.id,
      inicioEm: new Date(Date.now() + 5 * 60_000),
      duracaoMin: 30,
      modalidade: "TELECONSULTA",
      motivo: "Teste do fluxo completo",
      status: "AGENDADA",
      // Marcada como avisada de propósito: criar direto no banco não dispara
      // e-mail, e sem isto ela apareceria como "não avisado" na agenda.
      confirmacaoEnviadaEm: new Date(),
    },
  });

  const BASE = process.env.AUTH_URL ?? "http://localhost:3000";
  console.log(`
${"─".repeat(60)}
\x1b[1mCONSULTA LIMPA — começa em 5 minutos\x1b[0m

  Paciente (janela anônima):
    ${BASE}/sala/${nova.id}

  Médica (janela normal):
    ${BASE}/atendimento/${nova.id}

  Mesmo id nos dois. Se divergirem, cada um espera o outro para sempre.
${"─".repeat(60)}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
