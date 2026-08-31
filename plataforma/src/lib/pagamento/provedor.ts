/**
 * Interface do provedor de pagamento.
 *
 * Tudo que a aplicação sabe sobre "cobrar" passa por aqui. Plugar Asaas,
 * Mercado Pago ou Pagar.me depois é escrever UM arquivo que implementa esta
 * interface e apontar `PAGAMENTO_PROVEDOR` no `.env` — schema, rotas, front e
 * cron não mudam.
 *
 * Contratos que todo adaptador deve honrar:
 *   • `criarCobrancaPix` é a ÚNICA forma de nascer uma cobrança;
 *   • `verificarWebhook` valida a assinatura ANTES de a rota confiar no corpo —
 *     nunca confie no cliente para confirmar pagamento;
 *   • o estado só muda por webhook, então `criarCobrancaPix` devolve algo
 *     PENDENTE e nada mais.
 */

import type { CobrancaPix, Pagador, ResultadoWebhook } from "./tipos";

export interface ProvedorPagamento {
  /** Identificador gravado em `Pagamento.provedor` (ex.: "FAKE", "ASAAS"). */
  readonly nome: string;

  /**
   * O provedor exige o CPF do PAGADOR para criar a cobrança Pix? O Asaas sim
   * (cria um "customer" com cpfCnpj); o Mercado Pago não. Quando `true`, o
   * formulário de agendamento coleta o CPF e a rota o exige antes de cobrar.
   */
  readonly exigeCpf: boolean;

  criarCobrancaPix(args: {
    valorCent: number;
    consultaId: string;
    pagador: Pagador;
  }): Promise<CobrancaPix>;

  /** Lê e valida a requisição de webhook. Só quem passa aqui muda estado. */
  verificarWebhook(req: Request): Promise<ResultadoWebhook>;

  /** Estorna uma cobrança já paga. Idempotência é responsabilidade do chamador. */
  reembolsar(provedorRef: string): Promise<void>;
}
