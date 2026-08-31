/**
 * Prévia local dos e-mails — SÓ para desenvolvimento.
 *
 * Renderiza os quatro e-mails a partir do template REAL (`email-template.ts`),
 * escreve um HTML com todos lado a lado (cada um num iframe) e não envia nada.
 * Uso: `npx tsx scripts/preview-emails.ts [dir-de-saida]`
 *
 * Reaproveita só as primitivas puras do template — não importa `email.ts` (que
 * abre transporte SMTP e exige `.env`). O conteúdo abaixo espelha o de `email.ts`.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assinaturaEmail,
  botaoEmail,
  layoutEmail,
  paragrafoEmail,
} from "../src/lib/email-template";

const saida = process.argv[2] ?? process.cwd();
const data = "segunda-feira, 31 de agosto de 2026 às 14:00";

const amostras: { arquivo: string; titulo: string; html: string }[] = [
  {
    arquivo: "preview-confirmacao.html",
    titulo: "Confirmação de consulta",
    html: layoutEmail({
      preheader: `Sua consulta está agendada para ${data}.`,
      conteudo:
        paragrafoEmail("Olá, João da Silva.") +
        paragrafoEmail("Sua consulta foi agendada:") +
        paragrafoEmail(`<strong>Data e horário:</strong> ${data} (horário de Campo Grande)`) +
        paragrafoEmail("<strong>Modalidade:</strong> Teleconsulta") +
        paragrafoEmail("<strong>Duração:</strong> 30 minutos") +
        paragrafoEmail("Cerca de uma hora antes você receberá outro e-mail com o link de acesso à sala. Ele só funciona a partir de 15 minutos antes do horário marcado.") +
        paragrafoEmail("Se precisar remarcar ou cancelar, responda a este e-mail.") +
        assinaturaEmail(),
    }),
  },
  {
    arquivo: "preview-lembrete.html",
    titulo: "Sua consulta é hoje (com botão)",
    html: layoutEmail({
      preheader: "Hoje às 14:00 (horário de Campo Grande).",
      conteudo:
        paragrafoEmail("Olá, João da Silva.") +
        paragrafoEmail(`Sua teleconsulta está marcada para <strong>${data}</strong> (horário de Campo Grande).`) +
        paragrafoEmail("Toque no botão abaixo para entrar na sala. Será pedido seu e-mail — use o mesmo que recebeu esta mensagem.") +
        paragrafoEmail("A sala abre 15 minutos antes do horário marcado.") +
        paragrafoEmail("Prefira um lugar reservado, com fone de ouvido e boa conexão.") +
        paragrafoEmail("Em caso de urgência ou emergência, procure atendimento presencial ou ligue 192 (SAMU).") +
        botaoEmail("https://consulta.dralaishahmed.com.br/sala/exemplo", "Entrar na consulta") +
        assinaturaEmail(),
    }),
  },
  {
    arquivo: "preview-cancelamento.html",
    titulo: "Consulta cancelada",
    html: layoutEmail({
      preheader: `A consulta de ${data} foi cancelada.`,
      conteudo:
        paragrafoEmail("Olá, João da Silva.") +
        paragrafoEmail(`Sua teleconsulta de <strong>${data}</strong> (horário de Campo Grande) foi cancelada e não acontecerá.`) +
        paragrafoEmail("Motivo: a médica precisou se ausentar nesta data.") +
        paragrafoEmail("Sentimos pelo transtorno. Para remarcar, responda a este e-mail ou agende um novo horário pelo site.") +
        paragrafoEmail("Se a consulta era urgente e você não conseguir remarcar a tempo, procure atendimento presencial ou ligue 192 (SAMU).") +
        assinaturaEmail(),
    }),
  },
  {
    arquivo: "preview-login.html",
    titulo: "Acesso à sua consulta (magic link, era em inglês)",
    html: layoutEmail({
      preheader: "Seu link de acesso — vale 15 minutos.",
      conteudo:
        paragrafoEmail("Olá.") +
        paragrafoEmail("Recebemos um pedido para acessar a área de consultas da Dra. Laís com este e-mail. Toque no botão abaixo para entrar:") +
        botaoEmail("https://consulta.dralaishahmed.com.br/entrar?token=exemplo", "Entrar") +
        paragrafoEmail('<span style="color:#6b7a72;font-size:13px;">O link vale por 15 minutos e só funciona uma vez.</span>') +
        paragrafoEmail("Se você não pediu este acesso, ignore este e-mail — nada acontece.") +
        assinaturaEmail(),
    }),
  },
];

for (const a of amostras) {
  writeFileSync(join(saida, a.arquivo), a.html, "utf8");
}

const indice = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prévia dos e-mails — Dra. Laís</title>
<style>
  body{margin:0;background:#dfe5e3;font-family:Arial,Helvetica,sans-serif;color:#26312d;}
  header{padding:20px 24px;background:#0f5f57;color:#fff;}
  header h1{margin:0;font-size:18px;font-weight:normal;}
  header p{margin:6px 0 0;font-size:13px;color:#bfe0d9;}
  .grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:22px;padding:24px;}
  .cartao{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px -12px rgba(0,0,0,.25);}
  .cartao h2{margin:0;padding:12px 16px;font-size:13px;font-weight:bold;background:#f6f8f7;border-bottom:1px solid #e2e8e5;color:#0f5f57;}
  iframe{display:block;width:100%;height:620px;border:0;background:#eef2f1;}
</style></head>
<body>
<header><h1>Prévia dos e-mails do paciente</h1><p>Renderizado do template real. Nenhum e-mail foi enviado.</p></header>
<div class="grade">
${amostras.map((a) => `<div class="cartao"><h2>${a.titulo}</h2><iframe src="./${a.arquivo}" title="${a.titulo}"></iframe></div>`).join("\n")}
</div>
</body></html>`;

writeFileSync(join(saida, "preview-index.html"), indice, "utf8");
console.log(join(saida, "preview-index.html"));
