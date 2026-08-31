/**
 * Seletor do provedor de pagamento.
 *
 * Uma instância por processo (o provedor pode segurar cliente HTTP/credencial).
 * Trocar de provedor = adicionar um `case` aqui e um arquivo adaptador, mais as
 * chaves no `.env`. O default é o fake, para o dev subir sem configurar nada.
 */

import { env } from "@/lib/env";
import type { ProvedorPagamento } from "./provedor";
import { ProvedorFake } from "./fake";
import { ProvedorAsaas } from "./asaas";

let instancia: ProvedorPagamento | null = null;

export function provedorPagamento(): ProvedorPagamento {
  if (instancia) return instancia;

  switch (env.PAGAMENTO_PROVEDOR) {
    case "ASAAS":
      instancia = new ProvedorAsaas();
      break;
    case "FAKE":
    default:
      instancia = new ProvedorFake();
  }

  return instancia;
}

export type { ProvedorPagamento } from "./provedor";
