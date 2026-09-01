/**
 * Testa o MAPEAMENTO do nosso modelo para os dados do CFM (funções puras).
 *
 *     npm run teste:cfm
 *
 * Não toca na rede nem na lib do CFM (que é frontend/iframe e nem está no npm):
 * valida só a tradução Receita/Paciente/médica -> shapes do CFM, que é a parte
 * testável em Node. O iframe/postMessage é testado à mão quando houver a lib.
 */

import {
  medicamentosParaCfm,
  pacienteParaCfm,
  localAtendimentoParaCfm,
  tipoDocumentoDaReceita,
} from "../src/lib/cfm/mapeamento";
import { itemReceitaVazio, type ItemReceita } from "../src/lib/receita-tipos";

let falhas = 0;
function conferir(condicao: boolean, rotulo: string, detalhe = "") {
  if (condicao) {
    console.log(`  \x1b[32m✓\x1b[0m ${rotulo}`);
  } else {
    falhas++;
    console.log(`  \x1b[31m✗\x1b[0m ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

console.log("\n\x1b[1mMapeamento CFM\x1b[0m\n" + "─".repeat(50));

// ---- medicamentos ----
const itens: ItemReceita[] = [
  {
    ...itemReceitaVazio(),
    medicamento: "Amoxicilina",
    concentracao: "500mg",
    formaFarmaceutica: "cápsula",
    via: "oral",
    posologia: "1 cápsula 8/8h",
    quantidade: "21",
    duracao: "7 dias",
    controlado: false,
    observacao: "após as refeições",
  },
  {
    ...itemReceitaVazio(),
    medicamento: "Clonazepam",
    concentracao: "2mg",
    quantidade: "30",
    controlado: true,
  },
];

const meds = medicamentosParaCfm(itens);
conferir(meds.length === 2, "mapeia todos os itens");
conferir(meds[0]!.nome === "Amoxicilina" && meds[0]!.concentracao === "500mg", "nome e concentração");
conferir(meds[0]!.quantidade === 21, "quantidade vira número", String(meds[0]!.quantidade));
conferir(
  meds[0]!.informacoes.includes("Via: oral") && meds[0]!.informacoes.includes("Posologia:"),
  "informacoes concatena forma/via/posologia/duração",
  meds[0]!.informacoes,
);
conferir(meds[1]!.quantidade === 30 && !meds[1]!.manipulado, "2º item ok (industrializado)");

// ---- paciente ----
const pac = pacienteParaCfm({
  id: "pac-1",
  nome: "Fulano de Tal",
  cpf: "12345678901",
  nascimento: new Date("1990-05-20T00:00:00Z"),
  email: "fulano@exemplo.com",
  telefone: "67999998888",
});
conferir(pac.idPaciente === "pac-1" && pac.nome === "Fulano de Tal", "paciente id e nome");
conferir(pac.dataNascimento === "19900520", "data de nascimento em YYYYMMDD", pac.dataNascimento);
conferir(pac.cpf === "12345678901", "cpf");
const pacSemData = pacienteParaCfm({ id: "x", nome: "Sem Data", cpf: null, nascimento: null, email: "e@e.com", telefone: null });
conferir(pacSemData.dataNascimento === "" && pacSemData.cpf === "", "campos ausentes viram vazio (não quebram)");

// ---- local de atendimento ----
const local = localAtendimentoParaCfm({ nomeMedica: "Dra. Laís Caroline Hahmed" });
conferir(local.nome === "Dra. Laís Caroline Hahmed", "local de atendimento com o nome da médica");

// ---- tipo de documento ----
conferir(tipoDocumentoDaReceita(false) === "RECEITA_SIMPLES", "sem controlado → RECEITA_SIMPLES");
conferir(tipoDocumentoDaReceita(true) === "CONTROLE_ESPECIAL", "com controlado → CONTROLE_ESPECIAL");

console.log("─".repeat(50));
if (falhas === 0) {
  console.log("\x1b[32mMapeamento CFM OK.\x1b[0m\n");
} else {
  console.log(`\x1b[31m${falhas} falha(s) no mapeamento.\x1b[0m\n`);
  process.exitCode = 1;
}
