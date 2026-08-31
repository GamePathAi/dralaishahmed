/**
 * Preferências da médica que afetam o custo por consulta.
 *
 * Um lugar só para: os valores válidos, o mapa tier→modelo, e os rótulos que a
 * tela mostra. Guardar o TIER (OPUS/SONNET/HAIKU) em vez do id do modelo
 * significa que, quando a Anthropic troca um id, muda-se o mapa aqui — não o
 * banco.
 */

export const MODELOS_NOTA = ["OPUS", "SONNET", "HAIKU"] as const;
export type ModeloNota = (typeof MODELOS_NOTA)[number];

export const MODOS_ASSISTENTE = ["SEMPRE", "MANUAL", "DESLIGADO"] as const;
export type ModoAssistente = (typeof MODOS_ASSISTENTE)[number];

/** Tier → id real do modelo Claude. */
const ID_MODELO: Record<ModeloNota, string> = {
  OPUS: "claude-opus-5",
  SONNET: "claude-sonnet-5",
  HAIKU: "claude-haiku-4-5",
};

export function idDoModelo(tier: string): string {
  return ID_MODELO[(tier as ModeloNota) in ID_MODELO ? (tier as ModeloNota) : "OPUS"];
}

export const ROTULO_MODELO: Record<ModeloNota, { nome: string; descricao: string }> = {
  OPUS: {
    nome: "Máxima qualidade (Opus)",
    descricao:
      "O mais cuidadoso em preservar dose exata e em não inventar hipótese. Custo mais alto — recomendado para primeira consulta e casos complexos.",
  },
  SONNET: {
    nome: "Equilíbrio (Sonnet)",
    descricao:
      "Muito capaz e bem mais barato. Boa escolha para o dia a dia; revise as doses como sempre.",
  },
  HAIKU: {
    nome: "Econômico (Haiku)",
    descricao:
      "O mais barato. Suficiente para retornos e casos simples — revise com atenção redobrada antes de assinar.",
  },
};

// ------------------------------------------------------------------ preço

/** Placeholder inicial (R$ 300,00). A médica ajusta em /configuracoes. */
export const PRECO_PLACEHOLDER_CENT = 30000;

/** Teto de sanidade para os campos de preço (R$ 10.000,00), em centavos. */
export const PRECO_MAX_CENT = 1_000_000;

/** Formata centavos como moeda BRL. Puro — serve cliente e servidor. */
export function formatarBRL(cent: number): string {
  return (cent / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Preço da consulta pela modalidade, a partir da config da médica. */
export function precoDaConsulta(
  medica: { valorTeleconsultaCent: number; valorPresencialCent: number },
  modalidade: "TELECONSULTA" | "PRESENCIAL",
): number {
  return modalidade === "PRESENCIAL"
    ? medica.valorPresencialCent
    : medica.valorTeleconsultaCent;
}

export const ROTULO_MODO: Record<ModoAssistente, { nome: string; descricao: string }> = {
  SEMPRE: {
    nome: "Sempre oferecer",
    descricao:
      "Em toda teleconsulta, o paciente é perguntado sobre o assistente. Grava e transcreve quando ele autoriza.",
  },
  MANUAL: {
    nome: "Só quando eu ativar",
    descricao:
      "A consulta começa sem gravação. Se você quiser o rascunho por IA, ativa o assistente na sala — aí o paciente é perguntado. É o modo que mais economiza: sem ativação, não há custo de transcrição.",
  },
  DESLIGADO: {
    nome: "Desligado",
    descricao:
      "O assistente nunca é oferecido. Toda consulta é só vídeo, e o registro é sempre redigido à mão.",
  },
};
