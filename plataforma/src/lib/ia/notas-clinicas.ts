/**
 * Geração do relatório clínico estruturado a partir da transcrição da consulta.
 *
 * Duas decisões que sustentam o resto do arquivo:
 *
 * 1. Saída estruturada por schema, não por parsing de texto. `output_config.format`
 *    faz a API garantir que o primeiro bloco de texto é JSON válido no formato
 *    pedido. Sem isso, seria preciso "pedir JSON no prompt" e torcer — o que
 *    quebra no primeiro caso em que o modelo escreve uma frase antes do objeto.
 *
 * 2. O prompt proíbe inferência. O relatório documenta o que foi DITO na consulta.
 *    Um modelo que "completa" uma hipótese diagnóstica plausível mas não mencionada
 *    está inventando prontuário — o erro mais grave possível aqui.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// `zod/v4` de propósito: o helper do SDK só aceita schema da v4. O resto do
// projeto segue na v3 clássica (`from "zod"`) — os dois subcaminhos convivem
// no mesmo pacote e nenhum schema atravessa a fronteira.
import { z } from "zod/v4";
import { env } from "@/lib/env";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export const MODELO_NOTAS = "claude-opus-5";

// --------------------------------------------------------------- schema

const CampoNaoRelatado = "Não relatado na consulta.";

export const RelatorioClinicoSchema = z.object({
  queixaPrincipal: z
    .string()
    .describe(
      "Motivo da consulta nas palavras do paciente, com duração quando mencionada. " +
        `Se não houver queixa explícita, escreva exatamente: "${CampoNaoRelatado}"`,
    ),
  historiaMoleastiaAtual: z
    .string()
    .describe(
      "Evolução do quadro atual: início, características, fatores de melhora e piora, " +
        "sintomas associados, tratamentos já tentados. Apenas o que foi verbalizado.",
    ),
  antecedentes: z
    .string()
    .describe(
      "Antecedentes pessoais e familiares, comorbidades, cirurgias, alergias e " +
        "medicações em uso — somente os relatados nesta consulta.",
    ),
  hipotesesDiagnosticas: z
    .string()
    .describe(
      "APENAS hipóteses verbalizadas pela médica durante a consulta. " +
        "Nunca deduza, sugira ou complete um diagnóstico que não foi dito em voz alta.",
    ),
  conduta: z
    .string()
    .describe(
      "Plano terapêutico conforme conduzido: prescrições, exames solicitados, " +
        "orientações, encaminhamentos e retorno. Transcreva doses exatamente como ditas.",
    ),
  observacoes: z
    .string()
    .describe(
      "Trechos inaudíveis, ambiguidades, ou qualquer ponto que a médica precise " +
        "conferir antes de assinar. String vazia se não houver.",
    ),
  pontosParaRevisao: z
    .array(z.string())
    .describe(
      "Lista curta de itens de atenção — dose incerta, nome de medicamento pouco " +
        "audível, contradição na fala. São destacados em amarelo no modal de revisão.",
    ),
});

export type RelatorioClinico = z.infer<typeof RelatorioClinicoSchema>;

// ------------------------------------------------------- schema da receita

/**
 * Um item da prescrição. Estruturado de propósito: é o formato que a receita
 * imprimível consome hoje e que o Memed/ICP-Brasil vão consumir amanhã, sem
 * reparsear texto. Cada campo espelha o que uma receita precisa ter para valer.
 */
export const ItemPrescricaoSchema = z.object({
  medicamento: z
    .string()
    .describe(
      "Nome do medicamento (princípio ativo ou marca) exatamente como a médica " +
        "prescreveu. Se o nome estiver duvidoso na transcrição, mantenha o que foi " +
        "captado e marque com [?] logo após.",
    ),
  concentracao: z
    .string()
    .describe(
      'Concentração/dosagem do produto, ex.: "500 mg", "20 mg/mL". String vazia se não dita.',
    ),
  formaFarmaceutica: z
    .string()
    .describe(
      'Forma farmacêutica, ex.: "comprimido", "cápsula", "solução oral", "creme". Vazia se não dita.',
    ),
  via: z
    .string()
    .describe('Via de administração, ex.: "oral", "tópica", "intranasal". Vazia se não dita.'),
  posologia: z
    .string()
    .describe(
      "Como usar, EXATAMENTE como dito: dose, frequência, horários. Ex.: " +
        '"1 comprimido de 8 em 8 horas por 7 dias". Nunca preencha com posologia usual não verbalizada.',
    ),
  quantidade: z
    .string()
    .describe(
      'Quantidade total a dispensar, ex.: "1 caixa com 21 comprimidos", "2 frascos". Vazia se não dita.',
    ),
  duracao: z
    .string()
    .describe('Duração do tratamento se mencionada, ex.: "7 dias", "uso contínuo". Vazia se não dita.'),
  controlado: z
    .boolean()
    .describe(
      "true se for medicamento de CONTROLE ESPECIAL (Portaria SVS/MS 344/98 — " +
        "tarja preta: benzodiazepínicos, opioides, psicotrópicos, anorexígenos, " +
        "retinoides, etc.). Antibiótico NÃO é controlado (embora exija receita). " +
        "Na dúvida, marque true e registre em pontosParaRevisao — controlado exige " +
        "receituário especial que a médica precisa conferir.",
    ),
  observacao: z
    .string()
    .describe(
      'Observação específica deste item, ex.: "tomar após as refeições", "não dirigir". Vazia se não houver.',
    ),
});

export type ItemPrescricao = z.infer<typeof ItemPrescricaoSchema>;

export const PrescricaoSchema = z.object({
  houvePrescricao: z
    .boolean()
    .describe(
      "true se a médica prescreveu ao menos um medicamento nesta consulta. " +
        "Se nenhum medicamento foi prescrito (consulta só de orientação, pedido de " +
        "exame, etc.), false e itens vazio — NÃO invente uma receita.",
    ),
  itens: z.array(ItemPrescricaoSchema),
  orientacoesGerais: z
    .string()
    .describe(
      "Orientações gerais que acompanham a receita, quando ditas (ex.: retorno, " +
        "sinais de alerta). String vazia se não houver.",
    ),
  pontosParaRevisao: z
    .array(z.string())
    .describe(
      "Itens de atenção na prescrição: dose incerta, nome de medicamento pouco " +
        "audível, item controlado que precisa de receituário especial.",
    ),
});

export type Prescricao = z.infer<typeof PrescricaoSchema>;

/**
 * Saída completa de uma consulta: o registro do prontuário E a receita. Um único
 * schema num único `output_config.format`, porque as duas coisas saem da mesma
 * transcrição — pedir em duas chamadas dobraria o custo sem ganho.
 */
export const SaidaConsultaSchema = z.object({
  relatorio: RelatorioClinicoSchema,
  prescricao: PrescricaoSchema,
});

// --------------------------------------------------------------- prompt

// Prompt estável, no início do payload, para aproveitar prompt caching.
// Mínimo cacheável no Opus 5 é 512 tokens — este bloco passa disso, então
// todas as consultas seguintes leem o prefixo do cache (~0,1x do custo).
const SISTEMA = `Você estrutura a transcrição de uma consulta médica em um registro clínico para revisão da médica assistente.

# O que você está produzindo
Um rascunho de prontuário. Ele será lido, corrigido e assinado por uma médica antes de valer como documento. Sua função é organizar e não perder informação — não é raciocinar clinicamente.

# Regra central
Registre apenas o que foi efetivamente dito na consulta.

Não infira, não complete e não sugira. Se a médica não verbalizou uma hipótese diagnóstica, o campo correspondente não recebe hipótese alguma — mesmo que o quadro descrito aponte para uma conclusão óbvia. Um diagnóstico que aparece no prontuário sem ter sido formulado pela médica é um erro grave, não um serviço prestado.

O mesmo vale para condutas: não acrescente orientação padrão, dose usual ou exame de rotina que não tenha sido mencionado.

# Como escrever
- Linguagem médica objetiva, em terceira pessoa, sem juízo de valor.
- Preserve os números exatamente como ditos: doses, posologias, valores de exame, tempo de evolução.
- Na queixa principal, mantenha a expressão do paciente entre aspas quando ela for característica ("dor que aperta o peito").
- Não repita a mesma informação em campos diferentes.
- Campo sem informação recebe exatamente: "${CampoNaoRelatado}"

# Trechos duvidosos
Transcrição de áudio erra, principalmente em nome de medicamento e dose. Quando algo estiver incerto:
1. Registre o que foi captado, marcando com [?] logo após o termo duvidoso.
2. Adicione um item correspondente em pontosParaRevisao.

É melhor sinalizar dez dúvidas do que deixar passar uma dose errada.

# Fora de escopo
Conversa social, ruído, interrupções e falha de conexão não entram no relatório — a menos que expliquem uma lacuna na consulta.

# Receita (prescricao)
Além do relatório, você monta a RECEITA: a lista estruturada dos medicamentos que a médica prescreveu nesta consulta. Vale a mesma regra central — só o que foi efetivamente prescrito.

- Se a médica não prescreveu nenhum medicamento, houvePrescricao é false e itens fica vazio. Uma receita inventada é tão grave quanto um diagnóstico inventado.
- Cada medicamento vira um item. Preserve nome, concentração e posologia EXATAMENTE como ditos. Nunca complete uma dose usual, uma quantidade padrão ou uma via "óbvia" que não foi verbalizada — deixe o campo vazio e, se for relevante, aponte em pontosParaRevisao.
- Nome de medicamento e dose são o que a transcrição de áudio mais erra. Na menor dúvida, marque o termo com [?] e adicione a pontosParaRevisao. É a médica quem confere antes de assinar.
- Marque controlado=true para tarja preta (Portaria 344/98): benzodiazepínico, opioide, psicotrópico, anorexígeno, retinoide, etc. Antibiótico NÃO é controlado. Todo controlado vira também um item em pontosParaRevisao, porque exige receituário especial.
- A mesma prescrição aparece descrita em prosa na conduta do relatório E estruturada aqui — não é repetição indevida, são dois usos do mesmo dado (o prontuário e a receita).`;

// --------------------------------------------------------------- geração

export interface ContextoPaciente {
  nome: string;
  idade?: number;
  alergias?: string | null;
  medicacoesUso?: string | null;
  antecedentes?: string | null;
}

export interface ResultadoNotas {
  relatorio: RelatorioClinico;
  prescricao: Prescricao;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
}

/**
 * Falha de CONFIGURAÇÃO da conta, não de código.
 *
 * Sem esta distinção, "sem créditos na Anthropic" e "bug no pipeline" chegam à
 * médica com a mesma frase genérica — e a diferença é enorme: uma se resolve
 * na página de faturamento em dois minutos, a outra exige investigação. A
 * mensagem tem que dizer qual das duas é.
 */
export class ConfiguracaoIAError extends Error {
  constructor(
    readonly motivo: "sem_creditos" | "chave_invalida" | "limite_excedido",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ConfiguracaoIAError";
  }
}

export class RecusaDoModeloError extends Error {
  constructor(readonly categoria: string | null | undefined) {
    super(
      "O modelo recusou processar esta transcrição" +
        (categoria ? ` (categoria: ${categoria})` : "") +
        ". A médica deve redigir o registro manualmente.",
    );
    this.name = "RecusaDoModeloError";
  }
}

/**
 * Chama o modelo traduzindo falhas de conta em erro tipado.
 *
 * As classes de exceção do SDK separam o que a médica pode resolver do que
 * exige investigação. Sem isso, "sem créditos" chegava como "não foi possível
 * gerar o rascunho" — mandando procurar bug onde havia uma fatura.
 */
async function chamarModelo(
  // Variante NÃO-streaming explícita: o tipo genérico de `create` inclui a
  // sobrecarga de stream, e o retorno viraria uma união com `Stream<…>` — onde
  // `stop_reason`, `content` e `usage` não existem.
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Beta.BetaMessage> {
  try {
    return await client.beta.messages.create(params);
  } catch (erro) {
    if (erro instanceof Anthropic.AuthenticationError) {
      throw new ConfiguracaoIAError(
        "chave_invalida",
        "A chave da Anthropic é inválida ou foi revogada. O assistente está " +
          "fora do ar até que ela seja corrigida.",
      );
    }
    if (erro instanceof Anthropic.RateLimitError) {
      throw new ConfiguracaoIAError(
        "limite_excedido",
        "Limite de requisições da Anthropic atingido. Tente novamente em " +
          "alguns minutos.",
      );
    }
    if (
      erro instanceof Anthropic.BadRequestError &&
      /credit balance/i.test(erro.message)
    ) {
      throw new ConfiguracaoIAError(
        "sem_creditos",
        "A conta da Anthropic está sem créditos, então o assistente não pôde " +
          "montar o rascunho. A transcrição foi preservada e o registro pode " +
          "ser redigido a partir dela. Para reativar: console.anthropic.com → " +
          "Plans & Billing.",
      );
    }
    throw erro;
  }
}

export async function gerarNotasClinicas(
  transcricao: string,
  paciente: ContextoPaciente,
  // Modelo escolhido pela médica nas configurações. Default no mais capaz —
  // quem não configurou nada continua no Opus.
  modelo: string = MODELO_NOTAS,
): Promise<ResultadoNotas> {
  const contexto = [
    `Paciente: ${paciente.nome}`,
    paciente.idade ? `Idade: ${paciente.idade} anos` : null,
    paciente.alergias ? `Alergias em prontuário: ${paciente.alergias}` : null,
    paciente.medicacoesUso
      ? `Medicações em uso em prontuário: ${paciente.medicacoesUso}`
      : null,
    paciente.antecedentes
      ? `Antecedentes em prontuário: ${paciente.antecedentes}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await chamarModelo({
    model: modelo,
    max_tokens: 16000,

    // Pensamento adaptativo: o modelo calibra a profundidade ao caso. Uma consulta
    // de renovação de receita não precisa do mesmo esforço que uma primeira consulta
    // com múltiplas queixas.
    thinking: { type: "adaptive" },

    // effort e format vivem no MESMO output_config — declarar o objeto duas vezes
    // faz a segunda sobrescrever a primeira silenciosamente.
    output_config: {
      effort: "high",
      // Schema garantido pela API: o primeiro bloco de texto é JSON válido.
      // Relatório + receita no mesmo objeto, uma só chamada.
      format: zodOutputFormat(SaidaConsultaSchema),
    },

    // Conteúdo clínico pode acionar os classificadores de segurança (categoria
    // biomédica). Com fallbacks, uma recusa é reprocessada em outro modelo dentro
    // da mesma chamada, em vez de deixar a médica sem rascunho.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",

    system: [
      {
        type: "text",
        text: SISTEMA,
        // Prefixo estável — reaproveitado em todas as consultas.
        cache_control: { type: "ephemeral" },
      },
    ],

    messages: [
      {
        role: "user",
        content:
          `<contexto_prontuario>\n${contexto}\n</contexto_prontuario>\n\n` +
          `<transcricao>\n${transcricao}\n</transcricao>\n\n` +
          "Estruture esta consulta: o registro clínico (relatorio) e a receita " +
          "(prescricao) com os medicamentos que a médica prescreveu.",
      },
    ],
  });

  // Checar a recusa ANTES de ler o conteúdo. Numa recusa o array vem vazio, e
  // indexar content[0] estoura antes de chegar no tratamento de erro.
  if (response.stop_reason === "refusal") {
    throw new RecusaDoModeloError(response.stop_details?.category);
  }

  const bloco = response.content.find((b) => b.type === "text");
  if (!bloco || bloco.type !== "text") {
    throw new Error("Resposta sem bloco de texto — nada a estruturar.");
  }

  // Dupla validação: a API já garante o schema, mas validar aqui protege contra
  // resposta truncada por max_tokens e dá um erro legível em vez de undefined
  // aparecendo no meio do modal de revisão.
  const saida = SaidaConsultaSchema.parse(JSON.parse(bloco.text));

  return {
    relatorio: saida.relatorio,
    prescricao: saida.prescricao,
    modelo: response.model,
    tokensEntrada: response.usage.input_tokens,
    tokensSaida: response.usage.output_tokens,
  };
}
