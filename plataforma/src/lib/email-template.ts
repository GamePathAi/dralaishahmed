/**
 * Layout visual compartilhado dos e-mails.
 *
 * Função PURA — sem nodemailer, sem transporte, sem `env` — de propósito: assim
 * pode ser importada tanto por `email.ts` (transacionais) quanto por `auth.ts`
 * (magic link) sem arrastar dependência de Node para onde não deve.
 *
 * HTML de e-mail é primitivo: nada de CSS externo nem fonte custom. Tudo é
 * tabela + estilo inline + cores explícitas, e o desenho tem que sobreviver com
 * a imagem BLOQUEADA (muitos clientes escondem imagens por padrão) — por isso a
 * marca também aparece como TEXTO, não só como logo.
 */

const SITE = "https://www.dralaishahmed.com.br";
const LOGO = `${SITE}/assets/img/logo-lh-branco.png`; // versão branca, sobre o teal

export const MARCA = "Dra. Laís Caroline Hahmed";
export const CRM = "CRM-MS 16563";

const TEAL = "#0f5f57";
const TINTA = "#26312d";
const MUTED = "#6b7a72";
const FUNDO = "#eef2f1";
const LINHA = "#e2e8e5";
const SANS = "Arial, Helvetica, sans-serif";

/** Parágrafo de corpo, com estilo inline (o cliente de e-mail ignora <style>). */
export function paragrafoEmail(conteudo: string): string {
  return `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.65;color:${TINTA};">${conteudo}</p>`;
}

/** Assinatura da médica ao pé do corpo. */
export function assinaturaEmail(): string {
  return (
    `<p style="margin:22px 0 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${TINTA};">` +
    `${MARCA}<br>` +
    `<span style="color:${MUTED};font-size:13px;">${CRM}</span>` +
    `</p>`
  );
}

/** Botão de ação (magic link, link da sala). Table-based para o Outlook. */
export function botaoEmail(url: string, rotulo: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">` +
    `<tr><td align="center" bgcolor="${TEAL}" style="border-radius:8px;">` +
    `<a href="${url}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${rotulo}</a>` +
    `</td></tr></table>`
  );
}

/**
 * Envelopa o conteúdo no layout completo. `preheader` é o texto de prévia que o
 * cliente mostra ao lado do assunto na caixa de entrada (fica oculto no corpo).
 */
export function layoutEmail({
  preheader,
  conteudo,
}: {
  preheader: string;
  conteudo: string;
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${MARCA}</title>
</head>
<body style="margin:0;padding:0;background:${FUNDO};">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINHA};border-radius:14px;overflow:hidden;">

<tr><td align="center" bgcolor="${TEAL}" style="background:${TEAL};padding:26px 24px;">
<img src="${LOGO}" alt="" width="46" height="46" style="display:block;border:0;margin:0 auto 10px;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:normal;letter-spacing:.2px;color:#ffffff;">${MARCA}</div>
<div style="font-family:${SANS};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#bfe0d9;margin-top:4px;">${CRM}</div>
</td></tr>

<tr><td style="padding:30px 34px 26px;">
${conteudo}
</td></tr>

<tr><td style="padding:18px 34px;background:#f6f8f7;border-top:1px solid ${LINHA};">
<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">
Este é um e-mail automático de consulta.dralaishahmed.com.br. Em caso de dúvida, você pode responder a esta mensagem.
</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
