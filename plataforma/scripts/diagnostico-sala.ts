/**
 * Diagnóstico da sala: mostra a janela de validade do token de cada consulta
 * recente e se AGORA está dentro dela.
 *
 *     npx tsx --env-file=.env scripts/diagnostico-sala.ts
 *
 * Temporário — serve para separar "token fora da janela" de "permissão do
 * navegador", que hoje produzem a mesma mensagem na tela.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MIN_ANTES = 15;
const MIN_DEPOIS = 30;

const fmt = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Campo_Grande" });

async function main() {
  const consultas = await prisma.consulta.findMany({
    orderBy: { inicioEm: "desc" },
    take: 6,
    select: {
      id: true,
      inicioEm: true,
      duracaoMin: true,
      status: true,
      modalidade: true,
      salaNome: true,
      salaUrl: true,
      salaExpiraEm: true,
      paciente: { select: { usuario: { select: { nome: true } } } },
    },
  });

  const agora = new Date();
  console.log(`\nAgora: ${fmt(agora)}  (America/Campo_Grande)\n`);

  for (const c of consultas) {
    const abre = new Date(c.inicioEm.getTime() - MIN_ANTES * 60_000);
    const fecha = new Date(
      c.inicioEm.getTime() + (c.duracaoMin + MIN_DEPOIS) * 60_000,
    );
    const dentro = agora >= abre && agora <= fecha;

    console.log(`${c.id}  [${c.status}] ${c.paciente.usuario?.nome ?? "(sem nome)"}`);
    console.log(`  início ....... ${fmt(c.inicioEm)} (${c.duracaoMin} min)`);
    console.log(`  janela ....... ${fmt(abre)}  →  ${fmt(fecha)}`);
    console.log(`  agora dentro?  ${dentro ? "SIM" : "NAO  <<< token recusado"}`);
    console.log(`  sala criada?   ${c.salaUrl ? "sim" : "NAO"}`);
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
