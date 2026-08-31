/**
 * Tipos PUROS da camada de pagamento — sem dependência de SDK, importáveis pelo
 * cliente (segue o padrão de `tipos-midia.ts` e `receita-tipos.ts`).
 *
 * O componente de agendamento (navegador) importa daqui o formato do Pix que a
 * API devolve; o servidor importa os mesmos tipos para preencher esse formato.
 * Se um dia divergirem, o TypeScript acusa antes de virar bug em produção.
 */

export type MetodoPagamento = "PIX" | "CARTAO" | "BOLETO";

export type StatusPagamento =
  | "ISENTO"
  | "PENDENTE"
  | "PAGO"
  | "EXPIRADO"
  | "FALHOU"
  | "REEMBOLSADO";

/**
 * Janela de reserva do horário enquanto o pagamento não confirma. Decisão de
 * produto: 20 minutos. Fonte única — o provedor usa isto no `expiraEm` da
 * cobrança e o cron usa o mesmo horizonte para varrer o que venceu.
 */
export const JANELA_RESERVA_MIN = 20;

/** Quem está pagando — o provedor pode exigir para o comprovante/antifraude. */
export interface Pagador {
  nome: string;
  email: string;
  cpf?: string | null;
}

/**
 * O que o provedor devolve ao criar uma cobrança Pix.
 *
 * `qrBase64` é uma **data URI** pronta para `<img src>` (ex.:
 * `data:image/png;base64,...` num provedor real, `data:image/svg+xml;base64,...`
 * no adaptador fake). Deixar a data URI completa mantém o mime sob controle do
 * provedor, então trocar de provedor não mexe no componente.
 */
export interface CobrancaPix {
  provedorRef: string;
  copiaCola: string;
  qrBase64: string;
  expiraEm: Date;
  /**
   * Link de pagamento hospedado pelo provedor (página de checkout: paga por
   * Pix/cartão/boleto abrindo a URL). O `invoiceUrl` do Asaas. Opcional porque
   * nem todo provedor devolve um.
   */
  linkPagamento?: string;
}

/** Resultado da verificação de um webhook recebido do provedor. */
export interface ResultadoWebhook {
  /** Assinatura conferiu? Se `false`, a rota responde 400 e ignora o corpo. */
  valido: boolean;
  provedorRef?: string;
  status?: StatusPagamento;
  /** Payload cru, guardado em `Pagamento.bruto` para auditoria. */
  bruto?: unknown;
}

/**
 * Formato do Pix que a API `POST /api/consultas` devolve ao navegador. É a
 * serialização de `CobrancaPix` (datas viram ISO) mais o `teste`, que liga o
 * botão de "simular pagamento" quando o provedor ativo é o fake.
 */
export interface PixCliente {
  copiaCola: string;
  qrBase64: string;
  /** ISO-8601. */
  expiraEm: string;
  /** Só verdadeiro no adaptador de desenvolvimento. */
  teste: boolean;
  /** Link de checkout hospedado (Asaas invoiceUrl), quando o provedor devolve. */
  linkPagamento?: string;
}
