/**
 * E-mail transacional.
 *
 * Três mensagens, três momentos:
 *   1. confirmação  — no ato do agendamento, SEM link de sala;
 *   2. lembrete     — ~1h antes, com o link (é quando ele funciona);
 *   3. cancelamento — quando um bloqueio da médica derruba a consulta.
 *
 * Por que o link não vai na confirmação: a sala da Daily só existe dentro de
 * uma janela (15 min antes até o fim da consulta). Um link mandado três semanas
 * antes fica na caixa de entrada e, se clicado fora da hora, devolve "a sala
 * ainda não está aberta" — que o paciente lê como defeito, não como regra.
 *
 * O link também nunca é a `salaUrl` da Daily: é a rota da aplicação, que exige
 * sessão e emite um token individual. URL de sala em e-mail seria credencial
 * encaminhável.
 */

import nodemailer from "nodemailer";
import { env } from "@/lib/env";

const transportador = nodemailer.createTransport(env.EMAIL_SERVER);

const FUSO = "America/Campo_Grande";
const ASSINATURA = "Dra. Laís Caroline Hahmed — CRM-MS 16563";

/**
 * O nome vem de formulário público e é interpolado em HTML. Sem escapar, um
 * cadastro com `<` no nome quebra o corpo do e-mail — ou pior, injeta marcação.
 */
function esc(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatarData(inicioEm: Date): string {
  return inicioEm.toLocaleString("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: FUSO,
  });
}

function rotuloModalidade(modalidade: Modalidade): string {
  return modalidade === "TELECONSULTA" ? "Teleconsulta" : "Consulta presencial";
}

type Modalidade = "TELECONSULTA" | "PRESENCIAL";

/**
 * Monta as duas versões a partir das mesmas linhas. Cliente de e-mail que não
 * renderiza HTML recebe texto equivalente, não um corpo vazio.
 */
async function enviar({
  para,
  assunto,
  linhas,
}: {
  para: string;
  assunto: string;
  /** `null` vira parágrafo em branco no texto e é omitido no HTML. */
  linhas: (string | null)[];
}) {
  const texto = linhas.map((l) => l ?? "").join("\n");
  const html = linhas
    .filter((l): l is string => l !== null)
    .map((l) => `<p>${l}</p>`)
    .join("\n");

  await transportador.sendMail({
    from: env.EMAIL_FROM,
    to: para,
    subject: assunto,
    text: texto,
    html,
  });
}

// ----------------------------------------------------------- 1. confirmação

export async function enviarConfirmacaoAgendamento({
  nome,
  email,
  inicioEm,
  modalidade,
  duracaoMin,
}: {
  nome: string;
  email: string;
  inicioEm: Date;
  modalidade: Modalidade;
  duracaoMin: number;
}) {
  const teleconsulta = modalidade === "TELECONSULTA";

  await enviar({
    para: email,
    assunto: "Confirmação de consulta",
    linhas: [
      `Olá, ${esc(nome)}.`,
      "Sua consulta foi agendada:",
      `Data e horário: ${formatarData(inicioEm)} (horário de Campo Grande)`,
      `Modalidade: ${rotuloModalidade(modalidade)}`,
      `Duração: ${duracaoMin} minutos`,
      teleconsulta
        ? "Cerca de uma hora antes você receberá outro e-mail com o link de acesso à sala. Ele só funciona a partir de 15 minutos antes do horário marcado."
        : null,
      "Se precisar remarcar ou cancelar, responda a este e-mail.",
      ASSINATURA,
    ],
  });
}

// -------------------------------------------------------------- 2. lembrete

export async function enviarLembreteConsulta({
  nome,
  email,
  consultaId,
  inicioEm,
  modalidade,
}: {
  nome: string;
  email: string;
  consultaId: string;
  inicioEm: Date;
  modalidade: Modalidade;
}) {
  // Rota da aplicação, não da Daily. Quem abrir sem sessão cai em /entrar e
  // volta para cá pelo `destino` depois do magic link.
  const linkSala = `${env.AUTH_URL.replace(/\/$/, "")}/sala/${consultaId}`;
  const teleconsulta = modalidade === "TELECONSULTA";

  await enviar({
    para: email,
    assunto: "Sua consulta é hoje",
    linhas: [
      `Olá, ${esc(nome)}.`,
      `Sua ${rotuloModalidade(modalidade).toLowerCase()} está marcada para ${formatarData(inicioEm)} (horário de Campo Grande).`,
      teleconsulta ? `Link de acesso à sala: ${linkSala}` : null,
      teleconsulta
        ? "A sala abre 15 minutos antes do horário. Ao abrir o link será pedido seu e-mail para entrar — é o mesmo que recebeu esta mensagem."
        : null,
      teleconsulta
        ? "Prefira um lugar reservado, com fone de ouvido e boa conexão."
        : null,
      "Em caso de urgência ou emergência, procure atendimento presencial ou ligue 192 (SAMU).",
      ASSINATURA,
    ],
  });
}

// ------------------------------------------------ 2b. primeiro acesso médico

export async function enviarPrimeiroAcesso({
  email,
  url,
}: {
  email: string;
  url: string;
}) {
  await enviar({
    para: email,
    assunto: "Configure seu acesso profissional",
    linhas: [
      "Olá.",
      "Recebemos um pedido para configurar o acesso profissional da plataforma. " +
        "Abra o endereço abaixo para definir sua senha e cadastrar o aplicativo " +
        "autenticador — leva dois minutos:",
      url,
      "O link vale por 30 minutos e funciona uma única vez.",
      "Se você não pediu esta configuração, ignore este e-mail — nada será alterado.",
      ASSINATURA,
    ],
  });
}

// ---------------------------------------------------------- 3. cancelamento

export async function enviarCancelamentoConsulta({
  nome,
  email,
  inicioEm,
  modalidade,
  motivo,
}: {
  nome: string;
  email: string;
  inicioEm: Date;
  modalidade: Modalidade;
  motivo?: string | null;
}) {
  await enviar({
    para: email,
    assunto: "Sua consulta foi cancelada",
    linhas: [
      `Olá, ${esc(nome)}.`,
      // O que aconteceu vem antes de qualquer justificativa: quem abre este
      // e-mail precisa saber em uma linha que não deve comparecer.
      `Sua ${rotuloModalidade(modalidade).toLowerCase()} de ${formatarData(inicioEm)} (horário de Campo Grande) foi cancelada e não acontecerá.`,
      motivo ? `Motivo: ${esc(motivo)}` : null,
      "Sentimos pelo transtorno. Para remarcar, responda a este e-mail ou agende um novo horário pelo site.",
      "Se a consulta era urgente e você não conseguir remarcar a tempo, procure atendimento presencial ou ligue 192 (SAMU).",
      ASSINATURA,
    ],
  });
}
