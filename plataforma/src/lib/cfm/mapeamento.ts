/**
 * Mapeia o NOSSO modelo (Receita/Paciente/médica) para os DADOS que a lib do CFM
 * espera. Funções puras (sem SDK, sem `env`, sem Prisma) — recebem valores
 * simples, então servem tanto no servidor quanto no cliente e são testáveis.
 *
 * Anexado à API real do CFM (ver [[cfm-prescricao-api]] na memória): o CFM tem
 * um único campo `informacoes` por medicamento, então concatenamos forma/via/
 * posologia/duração/observação numa linha.
 */

import type { ItemReceita } from "@/lib/receita-tipos";
import type {
  CfmMedicamentoData,
  CfmPacienteData,
  CfmLocalAtendimentoData,
  CfmNomeTipoDocumento,
} from "./tipos";

/** Data no formato ISO YYYYMMDD que o CFM exige (ou "" se não houver). */
function dataCfm(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Junta os campos clínicos do nosso item na única linha `informacoes` do CFM. */
function informacoesDoItem(i: ItemReceita): string {
  return [
    i.formaFarmaceutica && `Forma: ${i.formaFarmaceutica}`,
    i.via && `Via: ${i.via}`,
    i.posologia && `Posologia: ${i.posologia}`,
    i.duracao && `Duração: ${i.duracao}`,
    i.observacao && i.observacao,
  ]
    .filter(Boolean)
    .join(". ");
}

export function medicamentosParaCfm(itens: ItemReceita[]): CfmMedicamentoData[] {
  return itens.map((i, idx) => ({
    idMedicamento: String(idx + 1),
    // Nosso modelo não distingue manipulado/industrializado — assume
    // industrializado (o caso comum). Manipulado é ajuste futuro.
    manipulado: false,
    nome: i.medicamento,
    concentracao: i.concentracao,
    quantidade: Number.parseInt(i.quantidade, 10) || 0,
    informacoes: informacoesDoItem(i),
  }));
}

export function pacienteParaCfm(p: {
  id: string;
  nome: string;
  cpf: string | null;
  nascimento: Date | null;
  email: string;
  telefone: string | null;
}): CfmPacienteData {
  return {
    idPaciente: p.id,
    nome: p.nome,
    nomeSocial: "",
    cpf: p.cpf ?? "",
    dataNascimento: dataCfm(p.nascimento),
    // Nosso cadastro não tem sexo hoje; o CFM aceita vazio (campo opcional).
    sexo: "",
    email: p.email,
    telefoneCelular: p.telefone ?? "",
    telefoneFixo: "",
    endereco: null,
    responsavelLegal: null,
  };
}

export function localAtendimentoParaCfm(dados: {
  nomeMedica: string;
}): CfmLocalAtendimentoData {
  return {
    idLocal: "consultorio-dra-lais",
    logo: "",
    nome: dados.nomeMedica,
    // ENDERECO_MEDICA é texto livre; o CFM quer campos separados
    // (cep/uf/cidade/…). Deixado null até estruturarmos o endereço.
    endereco: null,
    email: "",
    telefoneCelular: "",
    telefoneFixo: "",
  };
}

/** Controlado → receituário de controle especial; senão, receita simples. */
export function tipoDocumentoDaReceita(
  temControlado: boolean,
): CfmNomeTipoDocumento {
  return temControlado ? "CONTROLE_ESPECIAL" : "RECEITA_SIMPLES";
}
