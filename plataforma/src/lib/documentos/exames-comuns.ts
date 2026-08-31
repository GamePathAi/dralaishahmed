/**
 * Lista de exames comuns para a médica marcar rápido, + tipos PUROS (sem SDK) do
 * item de exame. O editor no cliente importa daqui. Fora daqui, ela também pode
 * digitar qualquer exame no campo livre.
 */

// Espelha o enum `CategoriaExame` do Prisma como união pura (cliente não importa
// @prisma/client). Valores idênticos aos do schema.
export type CategoriaExame = "SANGUE" | "IMAGEM" | "OUTROS";

export interface ItemExame {
  categoria: CategoriaExame;
  nome: string;
}

export const ROTULO_CATEGORIA_EXAME: Record<CategoriaExame, string> = {
  SANGUE: "Sangue / laboratorial",
  IMAGEM: "Imagem",
  OUTROS: "Outros",
};

export const EXAMES_COMUNS: ItemExame[] = [
  { categoria: "SANGUE", nome: "Hemograma completo" },
  { categoria: "SANGUE", nome: "Glicemia de jejum" },
  { categoria: "SANGUE", nome: "Hemoglobina glicada (HbA1c)" },
  { categoria: "SANGUE", nome: "Colesterol total e frações" },
  { categoria: "SANGUE", nome: "Triglicerídeos" },
  { categoria: "SANGUE", nome: "TSH e T4 livre" },
  { categoria: "SANGUE", nome: "Ureia e creatinina" },
  { categoria: "SANGUE", nome: "TGO / TGP" },
  { categoria: "SANGUE", nome: "Ácido úrico" },
  { categoria: "SANGUE", nome: "Vitamina D (25-OH)" },
  { categoria: "SANGUE", nome: "Ferritina" },
  { categoria: "SANGUE", nome: "EAS (urina tipo I)" },
  { categoria: "IMAGEM", nome: "Raio-X de tórax" },
  { categoria: "IMAGEM", nome: "Ultrassom abdominal total" },
  { categoria: "IMAGEM", nome: "Ultrassom de tireoide" },
  { categoria: "IMAGEM", nome: "Eletrocardiograma (ECG)" },
  { categoria: "OUTROS", nome: "Teste ergométrico" },
];
