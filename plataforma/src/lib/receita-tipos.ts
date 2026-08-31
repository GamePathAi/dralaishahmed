/**
 * Tipo do item de receita, sem dependências.
 *
 * Existe separado do schema Zod em `ia/notas-clinicas.ts` de propósito: aquele
 * arquivo importa o SDK da Anthropic e o zod/v4, que não podem entrar no bundle
 * de um componente cliente. Este tipo é o mesmo formato, puro, compartilhado
 * entre o editor (cliente), a rota de assinatura e a via impressa.
 */
export interface ItemReceita {
  medicamento: string;
  concentracao: string;
  formaFarmaceutica: string;
  via: string;
  posologia: string;
  quantidade: string;
  duracao: string;
  controlado: boolean;
  observacao: string;
}

export function itemReceitaVazio(): ItemReceita {
  return {
    medicamento: "",
    concentracao: "",
    formaFarmaceutica: "",
    via: "",
    posologia: "",
    quantidade: "",
    duracao: "",
    controlado: false,
    observacao: "",
  };
}

/** Uma linha legível do item, para a via impressa e para conferência rápida. */
export function descreverItem(item: ItemReceita): string {
  const cabeca = [item.medicamento, item.concentracao, item.formaFarmaceutica]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
  return cabeca;
}
