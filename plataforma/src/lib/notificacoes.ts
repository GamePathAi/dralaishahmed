/**
 * Camada de notificação ao paciente.
 *
 * Ponto único por onde saem as mensagens (confirmação, lembrete com link,
 * cancelamento). Hoje só e-mail; quando o número WhatsApp Business estiver na
 * Cloud API, o envio por WhatsApp entra AQUI e as rotas/cron não mudam — elas
 * já chamam estas funções, não o `email.ts` direto.
 *
 * O desenho é "melhor esforço, canais independentes": uma falha num canal não
 * impede o outro, e o retorno diz o que de fato saiu — a médica precisa saber
 * se o paciente foi avisado.
 */

import {
  enviarLembreteConsulta,
  enviarConfirmacaoAgendamento,
  enviarCancelamentoConsulta,
} from "@/lib/email";

type Modalidade = "TELECONSULTA" | "PRESENCIAL";

export interface ResultadoNotificacao {
  email: boolean;
  whatsapp: boolean | null; // null = canal não configurado
}

/**
 * Lembrete com o link de acesso à sala.
 *
 * Usado pelo cron (automático, ~15 min antes) e pelo botão "Enviar link" da
 * agenda (sob demanda). O link aponta para a rota da aplicação, nunca para a
 * URL da Daily — ver `email.ts`.
 */
export async function notificarLinkConsulta(dados: {
  nome: string;
  email: string;
  consultaId: string;
  inicioEm: Date;
  modalidade: Modalidade;
}): Promise<ResultadoNotificacao> {
  let email = false;
  try {
    await enviarLembreteConsulta(dados);
    email = true;
  } catch (erro) {
    console.error("[notificacoes] falha no e-mail de link", dados.consultaId, erro);
  }

  // Quando a Cloud API do WhatsApp estiver configurada, o envio por template
  // entra aqui, com o mesmo padrão de try/catch por canal.
  const whatsapp = whatsAppConfigurado() ? await enviarWhatsAppLink(dados) : null;

  return { email, whatsapp };
}

export async function notificarConfirmacao(dados: {
  nome: string;
  email: string;
  inicioEm: Date;
  modalidade: Modalidade;
  duracaoMin: number;
}): Promise<ResultadoNotificacao> {
  let email = false;
  try {
    await enviarConfirmacaoAgendamento(dados);
    email = true;
  } catch (erro) {
    console.error("[notificacoes] falha no e-mail de confirmação", erro);
  }
  const whatsapp = whatsAppConfigurado() ? await enviarWhatsAppConfirmacao(dados) : null;
  return { email, whatsapp };
}

export async function notificarCancelamento(dados: {
  nome: string;
  email: string;
  inicioEm: Date;
  modalidade: Modalidade;
  motivo?: string | null;
}): Promise<ResultadoNotificacao> {
  let email = false;
  try {
    await enviarCancelamentoConsulta(dados);
    email = true;
  } catch (erro) {
    console.error("[notificacoes] falha no e-mail de cancelamento", erro);
  }
  const whatsapp = whatsAppConfigurado() ? await enviarWhatsAppCancelamento(dados) : null;
  return { email, whatsapp };
}

// ---------------------------------------------------------------- WhatsApp
//
// Espaço reservado. Quando `env.ts` ganhar WHATSAPP_TOKEN e WHATSAPP_PHONE_ID
// (Cloud API da Meta) e os templates forem aprovados, estas funções passam a
// chamar https://graph.facebook.com/.../messages com o template correto.

function whatsAppConfigurado(): boolean {
  return !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_ID;
}

async function enviarWhatsAppLink(_dados: unknown): Promise<boolean> {
  return false;
}
async function enviarWhatsAppConfirmacao(_dados: unknown): Promise<boolean> {
  return false;
}
async function enviarWhatsAppCancelamento(_dados: unknown): Promise<boolean> {
  return false;
}
