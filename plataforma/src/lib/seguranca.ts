/**
 * Hash de senha e segundo fator (TOTP) para o acesso da médica.
 *
 * Usa apenas primitivas do Node (`node:crypto`) — sem bcrypt, sem otplib.
 * Uma dependência a menos numa aplicação que guarda prontuário é uma superfície
 * de supply chain a menos, e scrypt/HMAC nativos são adequados aqui.
 */

import {
  scrypt as _scrypt,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const TAMANHO_CHAVE = 64;

// Custo do scrypt. N=2^15 dobra o padrão do Node (2^14) — mais caro para
// atacar, imperceptível no login. `maxmem` precisa acompanhar N (128*N*r).
const CUSTO = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ------------------------------------------------------------------ senha

export async function gerarHashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await scrypt(senha, sal, TAMANHO_CHAVE, CUSTO);
  // Os parâmetros de custo ENTRAM no hash. Sem eles, subir o custo depois
  // quebraria a verificação de todas as senhas já gravadas — impossível
  // endurecer sem forçar todo mundo a redefinir. Formato:
  // scrypt$N$r$p$sal$chave
  return `scrypt$${CUSTO.N}$${CUSTO.r}$${CUSTO.p}$${sal.toString("hex")}$${chave.toString("hex")}`;
}

export async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  const partes = hash.split("$");

  let N: number;
  let salHex: string | undefined;
  let chaveHex: string | undefined;
  if (partes.length === 6 && partes[0] === "scrypt") {
    // Formato novo, com custo embutido: scrypt$N$r$p$sal$chave
    N = Number(partes[1]);
    salHex = partes[4];
    chaveHex = partes[5];
  } else if (partes.length === 3 && partes[0] === "scrypt") {
    // Formato legado (sem custo) — usa o padrão do Node de então (N=2^14).
    N = 1 << 14;
    salHex = partes[1];
    chaveHex = partes[2];
  } else {
    return false;
  }
  const r = 8;
  if (!salHex || !chaveHex || !Number.isFinite(N)) return false;

  const esperado = Buffer.from(chaveHex, "hex");
  const obtido = await scrypt(senha, Buffer.from(salHex, "hex"), esperado.length, {
    N, r, p: 1, maxmem: 128 * N * r * 2,
  });

  // Comparação em tempo constante: `===` vaza, pelo tempo, quantos bytes
  // iniciais estavam corretos.
  return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
}

// ------------------------------------------------------------------- TOTP

/** Decodifica o segredo em Base32 (formato dos apps autenticadores). */
function base32ParaBytes(base32: string): Buffer {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const limpo = base32.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];

  for (const caractere of limpo) {
    const indice = alfabeto.indexOf(caractere);
    if (indice === -1) continue;
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

function gerarCodigo(segredo: Buffer, contador: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(contador));

  const digest = createHmac("sha1", segredo).update(buffer).digest();
  // Truncagem dinâmica do RFC 4226: os 4 bits finais apontam o offset dos
  // 4 bytes que viram o código. `readUInt32BE` faz a mesma leitura big-endian
  // dos quatro `digest[i]` manuais, com verificação de limite.
  const deslocamento = digest.readUInt8(digest.length - 1) & 0x0f;
  const binario = digest.readUInt32BE(deslocamento) & 0x7fffffff;

  return String(binario % 1_000_000).padStart(6, "0");
}

/**
 * Valida um código TOTP de 6 dígitos.
 *
 * A janela de ±1 passo (30s antes e depois) cobre relógio dessincronizado no
 * celular — sem ela, o segundo fator falha de forma intermitente e inexplicável
 * para quem está usando.
 */
export function verificarTotp(codigo: string, segredoBase32: string): boolean {
  const informado = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(informado)) return false;

  const segredo = base32ParaBytes(segredoBase32);
  const passo = Math.floor(Date.now() / 1000 / 30);

  for (const deslocamento of [-1, 0, 1]) {
    const esperado = gerarCodigo(segredo, passo + deslocamento);
    const a = Buffer.from(esperado);
    const b = Buffer.from(informado);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * Gera o código de 6 dígitos do passo atual — o mesmo que o aplicativo
 * autenticador mostraria. Serve ao teste de ponta a ponta, que precisa provar o
 * login real da médica em vez de forjar sessão.
 */
export function gerarCodigoTotp(segredoBase32: string): string {
  const passo = Math.floor(Date.now() / 1000 / 30);
  return gerarCodigo(base32ParaBytes(segredoBase32), passo);
}

/** Segredo Base32 para cadastrar no aplicativo autenticador. */
export function gerarSegredoTotp(): string {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(randomBytes(20))
    .map((b) => alfabeto[b % 32])
    .join("");
}
