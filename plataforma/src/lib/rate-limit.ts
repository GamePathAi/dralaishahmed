/**
 * Limitação de taxa em memória.
 *
 * A defesa principal contra flood é o nginx (`limit_req`, na borda, cobre tudo
 * e sobrevive a restart). Esta camada é o complemento que o nginx não faz: o
 * **lockout por identidade** — travar o login da médica por e-mail após N
 * falhas, independentemente do IP, que é o que anula a força bruta do TOTP
 * quando a senha vaza.
 *
 * `Map` de módulo persiste enquanto o processo vive. A plataforma roda em uma
 * única instância (`next start` sob systemd), então isso basta e não exige
 * Redis. Se um dia escalar para vários processos, esta camada precisa migrar
 * para um store compartilhado — o nginx continua valendo em qualquer caso.
 */

interface Janela {
  contagem: number;
  reiniciaEm: number;
}

const baldes = new Map<string, Janela>();

/** Faxina preguiçosa: remove janelas vencidas quando o Map cresce. */
function limparSeNecessario() {
  if (baldes.size < 5000) return;
  const agora = Date.now();
  for (const [chave, j] of baldes) {
    if (j.reiniciaEm <= agora) baldes.delete(chave);
  }
}

export interface ResultadoLimite {
  ok: boolean;
  restam: number;
  /** Segundos até liberar, quando bloqueado. */
  esperaSeg: number;
}

/**
 * Conta uma tentativa e diz se passou do limite.
 *
 * @param chave  identidade da cota — ex.: `login:${email}` ou `ip:${ip}`
 * @param max    tentativas permitidas na janela
 * @param janelaMs  duração da janela
 */
export function consumir(
  chave: string,
  max: number,
  janelaMs: number,
): ResultadoLimite {
  limparSeNecessario();
  const agora = Date.now();
  const atual = baldes.get(chave);

  if (!atual || atual.reiniciaEm <= agora) {
    baldes.set(chave, { contagem: 1, reiniciaEm: agora + janelaMs });
    return { ok: true, restam: max - 1, esperaSeg: 0 };
  }

  if (atual.contagem >= max) {
    return {
      ok: false,
      restam: 0,
      esperaSeg: Math.ceil((atual.reiniciaEm - agora) / 1000),
    };
  }

  atual.contagem += 1;
  return { ok: true, restam: max - atual.contagem, esperaSeg: 0 };
}

/** Zera a cota de uma chave — chamado após sucesso (ex.: login válido). */
export function liberar(chave: string) {
  baldes.delete(chave);
}
