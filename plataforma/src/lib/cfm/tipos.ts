/**
 * Tipos puros que espelham as classes da lib de Prescrição Eletrônica do CFM
 * (`integracao-prescricao-cfm`), extraídos do fonte real (repo Smnjr).
 *
 * Sem dependência do SDK — compartilhados entre servidor (mapeamento) e cliente
 * (o componente que fala com o iframe do CFM). Como a lib troca dados por
 * `postMessage` (que serializa em objeto plano), estes objetos são exatamente o
 * que trafega: não é preciso instanciar as CLASSES da lib para os DADOS — só o
 * orquestrador `CfmIntegracaoPrescricao` (iframe/postMessage) vem da lib.
 */

export type CfmNomeAmbiente = "SIMULACAO" | "HOMOLOGACAO" | "PRODUCAO";
export type CfmNomeTipoDocumento =
  | "RECEITA_SIMPLES"
  | "ANTIMICROBIANO"
  | "CONTROLE_ESPECIAL";

export interface CfmEnderecoData {
  cep: string;
  uf: string;
  cidade: string;
  bairro: string;
  logradouro: string;
  numero: string;
  complemento: string;
}

export interface CfmLocalAtendimentoData {
  idLocal: string;
  /** Logo PNG/JPG até 200kB (base64/URL). Vazio = sem logo. */
  logo: string;
  nome: string;
  endereco: CfmEnderecoData | null;
  email: string;
  telefoneCelular: string;
  telefoneFixo: string;
}

export interface CfmResponsavelLegalData {
  nome: string;
  cpf: string;
}

export interface CfmPacienteData {
  idPaciente: string;
  nome: string;
  nomeSocial: string;
  cpf: string;
  /** Formato ISO YYYYMMDD (sem separadores). */
  dataNascimento: string;
  /** 'M' | 'F' | '' (nosso cadastro não tem sexo hoje). */
  sexo: string;
  email: string;
  telefoneCelular: string;
  telefoneFixo: string;
  endereco: CfmEnderecoData | null;
  responsavelLegal: CfmResponsavelLegalData | null;
}

export interface CfmMedicamentoData {
  idMedicamento: string;
  manipulado: boolean;
  nome: string;
  concentracao: string;
  /** Obrigatório para industrializados. */
  quantidade: number;
  /** Forma/via/posologia/duração/observação numa linha (o CFM tem só este campo). */
  informacoes: string;
}

export interface CfmPrescricaoData {
  localAtendimento: CfmLocalAtendimentoData;
  paciente: CfmPacienteData;
  medicamentos: CfmMedicamentoData[];
}

/** Resposta que o iframe do CFM devolve por postMessage. */
export interface CfmRespostaData {
  tipo: { nome: string };
  /** Presente quando `tipo.nome === "SUCESSO"`: URL do PDF assinado. */
  urlDocumento?: string;
  mensagemErro?: string;
}
