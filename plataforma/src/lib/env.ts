/**
 * Validação das variáveis de ambiente na inicialização.
 *
 * O ponto: descobrir que a ANTHROPIC_API_KEY está faltando no meio de uma
 * consulta real é péssimo. Aqui a aplicação simplesmente não sobe, e o erro
 * diz exatamente qual campo falta.
 */

import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),

  AUTH_SECRET: z.string().min(32, "Gere com: npx auth secret"),
  AUTH_URL: z.string().url(),

  // Magic link do paciente. Sem estas duas o provider Nodemailer falha só na
  // hora em que alguém tenta entrar — que é tarde demais para descobrir.
  EMAIL_SERVER: z
    .string()
    .startsWith("smtp", "Formato: smtp://usuario:senha@host:587"),
  EMAIL_FROM: z.string().email(),

  // Autoriza o cron de lembretes. É a única credencial que trafega para uma
  // rota de API sem sessão — daí o mínimo alto.
  CRON_SECRET: z.string().min(32, "Gere com: openssl rand -base64 32"),

  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),

  DAILY_API_KEY: z.string().min(1),
  DAILY_DOMAIN: z.string().min(1),

  AWS_REGION: z.string().default("sa-east-1"),
  AWS_S3_BUCKET_AUDIO: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),

  // Liga o checkout de pagamento no agendamento. DESLIGADO por padrão: enquanto
  // não houver um provedor real, o agendamento confirma direto (como antes) e o
  // Pix fica dormente. Ligar só com um `PAGAMENTO_PROVEDOR` de verdade — senão o
  // paciente recebe um Pix falso que não paga (ver o fail-closed abaixo).
  PAGAMENTO_ATIVO: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  // Provedor de pagamento. "FAKE" é o adaptador de desenvolvimento; "ASAAS" é o
  // provedor real. `string` em vez de enum para plugar outro sem tocar aqui — o
  // seletor cai no fake para qualquer valor desconhecido.
  PAGAMENTO_PROVEDOR: z.string().default("FAKE"),
  // Segredo que assina o webhook do adaptador fake. Default embutido porque o
  // fake só roda em dev; um provedor real traz sua própria chave de assinatura.
  PAGAMENTO_FAKE_SEGREDO: z.string().default("segredo-fake-do-pix-dev"),

  // --- Asaas (Pix real) — usados só quando PAGAMENTO_PROVEDOR=ASAAS ---
  // Opcionais no schema para o app subir com o fake; a obrigatoriedade quando o
  // provedor é ASAAS é checada no fail-fast abaixo.
  ASAAS_API_KEY: z.string().optional(),
  ASAAS_AMBIENTE: z.enum(["sandbox", "producao"]).default("sandbox"),
  // Token que o Asaas envia no header `asaas-access-token` de cada webhook.
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),

  CRM_MEDICA: z.string().min(1),
  NOME_MEDICA: z.string().min(1),
  // Endereço profissional impresso na receita (exigência do receituário). Opcional
  // para não derrubar o app se ainda não foi preenchido; a receita avisa quando falta.
  ENDERECO_MEDICA: z.string().optional(),

  // --- Prescrição Eletrônica do CFM (Fase 1: SIMULAÇÃO, dormente) ---
  // Liga o botão "Emitir pelo CFM" na receita. OFF por padrão: o fluxo atual
  // (assinatura IMPRESSA + imprimir pelo navegador) segue sendo o único.
  CFM_ATIVO: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // Ambiente. SIMULACAO = mock do CFM, sem credencial. HOMOLOGACAO/PRODUCAO
  // exigem credenciais do CFM (processo à parte) — ainda não temos.
  CFM_AMBIENTE: z
    .enum(["SIMULACAO", "HOMOLOGACAO", "PRODUCAO"])
    .default("SIMULACAO"),
  // URL do bundle IIFE da lib do CFM (global `integracaoPrescricaoCfm`). O pacote
  // npm NÃO está publicado (404 em npm/unpkg, 09/2026), então a lib é carregada
  // em runtime a partir desta URL (self-host ou CDN do CFM quando disponível).
  // Sem ela, o botão do CFM avisa que a lib não está configurada.
  CFM_SCRIPT_URL: z.string().optional(),
  // Credenciais OAuth do sistema junto ao IAM do CFM (só HOMOLOGACAO/PRODUCAO).
  CFM_IAM_URL: z.string().optional(),
  CFM_CLIENT_ID: z.string().optional(),
  CFM_CLIENT_SECRET: z.string().optional(),
});

const resultado = schema.safeParse(process.env);

if (!resultado.success) {
  const faltando = resultado.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Variáveis de ambiente inválidas ou ausentes:\n${faltando}\n\n` +
      "Confira o .env.example e preencha o .env.local.",
  );
}

// Fail-closed de pagamento: em produção, NUNCA cobrar com o adaptador fake.
// O fake gera um Pix que não paga e assina o webhook com um segredo público
// (forjável). Se alguém ligar o pagamento sem plugar um provedor real, o app
// se recusa a subir — melhor não iniciar do que cobrar de mentira em produção.
if (
  process.env.NODE_ENV === "production" &&
  resultado.data.PAGAMENTO_ATIVO &&
  resultado.data.PAGAMENTO_PROVEDOR === "FAKE"
) {
  throw new Error(
    "PAGAMENTO_ATIVO=true com PAGAMENTO_PROVEDOR=FAKE em produção. " +
      "Configure um provedor de pagamento real antes de ligar o checkout.",
  );
}

// Asaas selecionado exige suas credenciais — falhar no boot é melhor que
// descobrir a chave faltando na primeira cobrança de um paciente real.
if (
  resultado.data.PAGAMENTO_PROVEDOR === "ASAAS" &&
  (!resultado.data.ASAAS_API_KEY || !resultado.data.ASAAS_WEBHOOK_TOKEN)
) {
  throw new Error(
    "PAGAMENTO_PROVEDOR=ASAAS exige ASAAS_API_KEY e ASAAS_WEBHOOK_TOKEN no .env.",
  );
}

// Fail-safe da Fase 1 do CFM: por enquanto SÓ a SIMULAÇÃO pode ser ligada.
// HOMOLOGACAO/PRODUCAO só valem com credenciais homologadas junto ao CFM (que
// ainda não temos) — ligar sem elas geraria receita sem validade legal. Falhar
// no boot é melhor que descobrir isso na primeira prescrição real.
if (resultado.data.CFM_ATIVO && resultado.data.CFM_AMBIENTE !== "SIMULACAO") {
  if (
    !resultado.data.CFM_IAM_URL ||
    !resultado.data.CFM_CLIENT_ID ||
    !resultado.data.CFM_CLIENT_SECRET
  ) {
    throw new Error(
      `CFM_ATIVO=true com CFM_AMBIENTE=${resultado.data.CFM_AMBIENTE} exige ` +
        "CFM_IAM_URL, CFM_CLIENT_ID e CFM_CLIENT_SECRET (credenciais do CFM). " +
        "Enquanto não houver homologação, use CFM_AMBIENTE=SIMULACAO.",
    );
  }
}

export const env = resultado.data;
