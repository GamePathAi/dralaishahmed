/**
 * Modelos fixos de atestado + texto-base. PURO (sem SDK) — o editor no cliente
 * importa daqui. A médica escolhe um modelo, o editor vem preenchido, e ela
 * ajusta nome/data/dias/texto. Modelo customizável no banco fica para depois.
 */

// Espelha o enum `TipoAtestado` do Prisma como união pura (o cliente não importa
// o @prisma/client). Os valores são idênticos aos do enum no schema.
export type TipoAtestado = "COMPARECIMENTO" | "AFASTAMENTO" | "REPOUSO";

export interface ModeloAtestado {
  chave: string;
  rotulo: string;
  tipo: TipoAtestado;
  /** Dias sugeridos (só faz sentido em AFASTAMENTO/REPOUSO). */
  diasPadrao?: number;
}

export const MODELOS_ATESTADO: ModeloAtestado[] = [
  { chave: "comparecimento", rotulo: "Comparecimento à consulta", tipo: "COMPARECIMENTO" },
  { chave: "afastamento", rotulo: "Afastamento (dias)", tipo: "AFASTAMENTO", diasPadrao: 2 },
  { chave: "repouso", rotulo: "Repouso (dias)", tipo: "REPOUSO", diasPadrao: 3 },
];

export const ROTULO_TIPO: Record<TipoAtestado, string> = {
  COMPARECIMENTO: "Comparecimento",
  AFASTAMENTO: "Afastamento",
  REPOUSO: "Repouso",
};

/** Texto-base do atestado — ponto de partida editável, não a versão final. */
export function textoDoModelo(tipo: TipoAtestado, { nome, dias }: { nome?: string; dias?: number }): string {
  const paciente = nome?.trim() || "o(a) paciente";
  const d = dias && dias > 0 ? String(dias) : "___";
  switch (tipo) {
    case "COMPARECIMENTO":
      return `Atesto, para os devidos fins, que ${paciente} esteve sob meus cuidados médicos nesta data, comparecendo à consulta.`;
    case "AFASTAMENTO":
      return `Atesto, para os devidos fins, que ${paciente} necessita de afastamento de suas atividades laborais por ${d} dia(s), a partir desta data, por motivo de saúde.`;
    case "REPOUSO":
      return `Atesto, para os devidos fins, que ${paciente} necessita de repouso por ${d} dia(s), a partir desta data, por motivo de saúde.`;
  }
}
