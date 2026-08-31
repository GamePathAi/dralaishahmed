/**
 * Cadastro do segundo fator: a URI `otpauth` e seus dois desenhos.
 *
 * Fica separado de `seguranca.ts` (que faz a criptografia) porque isto é
 * apresentação — e porque `seguranca.ts` é importado por caminhos de
 * autenticação onde arrastar uma biblioteca de QR junto não faz sentido.
 */

import QRCode from "qrcode";

/**
 * URI padrão dos autenticadores (Google, Authy, Microsoft, 1Password).
 *
 * O rótulo é escapado: o e-mail tem `@`, e um `@` cru quebraria o parsing do
 * `otpauth://totp/<rótulo>?...` em alguns aplicativos.
 */
export function uriAutenticador(opcoes: {
  email: string;
  segredo: string;
  emissor?: string;
  /**
   * Sufixo que diferencia o ambiente no aplicativo autenticador.
   *
   * Sem ele, a entrada de produção e a de desenvolvimento ficam com o MESMO
   * nome no app — gêmeas indistinguíveis — e quem lê o código da errada recebe
   * "credenciais inválidas" sem nenhuma pista. Já custou horas de depuração.
   */
  ambiente?: string;
}): string {
  const { email, segredo, emissor = "Dra. Laís Hahmed", ambiente } = opcoes;
  const rotulo = encodeURIComponent(
    ambiente ? `${ambiente} (${email})` : `Plataforma (${email})`,
  );
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}`;
}

/** QR em blocos Unicode, para escanear direto da janela do terminal. */
export function qrTerminal(uri: string): Promise<string> {
  // `small: true` usa meio-bloco por módulo: o QR cabe numa janela normal.
  // Sem isso ele sai grande demais para caber na tela e fica inescaneável.
  return QRCode.toString(uri, { type: "terminal", small: true, errorCorrectionLevel: "M" });
}

/** QR em SVG, para a tela. Sem imagem externa e sem canvas no cliente. */
export function qrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });
}
