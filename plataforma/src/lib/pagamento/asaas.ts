/**
 * Adaptador de pagamento do Asaas (Pix).
 *
 * Implementa `ProvedorPagamento` contra a API v3 do Asaas. Para ligar em
 * produção: `PAGAMENTO_PROVEDOR=ASAAS`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`,
 * `ASAAS_AMBIENTE=producao` no `.env`, e apontar o webhook no painel do Asaas
 * para `POST /api/pagamentos/webhook` com o mesmo token.
 *
 * Fatos da API que este arquivo depende:
 *   - auth: header `access_token` com a API key;
 *   - valor em REAIS (decimal), não centavos;
 *   - Pix exige um "customer" com `cpfCnpj` (por isso `exigeCpf = true`);
 *   - o QR vem de `GET /payments/{id}/pixQrCode` → { payload, encodedImage };
 *   - o webhook chega com o token no header `asaas-access-token`; pago =
 *     evento PAYMENT_RECEIVED ou PAYMENT_CONFIRMED.
 */

import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { limparCpf } from "@/lib/cpf";
import type { CobrancaPix, Pagador, ResultadoWebhook, StatusPagamento } from "./tipos";
import { JANELA_RESERVA_MIN } from "./tipos";
import type { ProvedorPagamento } from "./provedor";

function statusDoEvento(event: string): StatusPagamento | undefined {
  switch (event) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_CONFIRMED":
      return "PAGO";
    case "PAYMENT_OVERDUE":
      return "EXPIRADO";
    case "PAYMENT_REFUNDED":
      return "REEMBOLSADO";
    default:
      return undefined; // eventos que não mudam nosso estado
  }
}

export class ProvedorAsaas implements ProvedorPagamento {
  readonly nome = "ASAAS";
  readonly exigeCpf = true;

  private base(): string {
    return env.ASAAS_AMBIENTE === "producao"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  }

  private async api(caminho: string, init?: RequestInit): Promise<any> {
    const r = await fetch(`${this.base()}${caminho}`, {
      ...init,
      headers: {
        access_token: env.ASAAS_API_KEY ?? "",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg =
        corpo?.errors?.[0]?.description ?? `${r.status} ${r.statusText}`;
      throw new Error(`[asaas] ${caminho}: ${msg}`);
    }
    return corpo;
  }

  /** Reaproveita o cliente pelo CPF para não duplicar cadastro no Asaas. */
  private async acharOuCriarCliente(pagador: Pagador): Promise<string> {
    const cpf = limparCpf(pagador.cpf ?? "");
    const busca = await this.api(`/customers?cpfCnpj=${cpf}`, { method: "GET" });
    if (Array.isArray(busca?.data) && busca.data[0]?.id) {
      return busca.data[0].id as string;
    }
    const novo = await this.api("/customers", {
      method: "POST",
      body: JSON.stringify({ name: pagador.nome, cpfCnpj: cpf, email: pagador.email }),
    });
    return novo.id as string;
  }

  async criarCobrancaPix({
    valorCent,
    consultaId,
    pagador,
  }: {
    valorCent: number;
    consultaId: string;
    pagador: Pagador;
  }): Promise<CobrancaPix> {
    if (!pagador.cpf) {
      throw new Error("[asaas] CPF do pagador é obrigatório para cobrar via Pix.");
    }

    const customer = await this.acharOuCriarCliente(pagador);
    const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const pagamento = await this.api("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer,
        // UNDEFINED = o paciente ESCOLHE no checkout (Pix, cartão ou boleto).
        // O link (invoiceUrl) mostra as três opções; o Pix ainda é gerável abaixo.
        billingType: "UNDEFINED",
        value: valorCent / 100, // Asaas cobra em reais, não centavos
        dueDate: hoje,
        externalReference: consultaId,
        description: "Consulta — Dra. Laís Caroline Hahmed",
      }),
    });

    // O QR/copia-e-cola do Pix é um bônus — se por algum motivo não vier (ex.:
    // conta sem chave Pix), a cobrança NÃO cai: sobra o link, que já cobre tudo.
    let copiaCola = "";
    let qrBase64 = "";
    try {
      const qr = await this.api(`/payments/${pagamento.id}/pixQrCode`, { method: "GET" });
      copiaCola = qr.payload as string;
      qrBase64 = `data:image/png;base64,${qr.encodedImage}`;
    } catch (e) {
      console.warn("[asaas] pixQrCode indisponível — seguindo só com o link", e);
    }

    return {
      provedorRef: pagamento.id as string,
      copiaCola,
      qrBase64,
      // Página de checkout hospedada pelo Asaas (paga por Pix/cartão/boleto).
      linkPagamento: (pagamento.invoiceUrl as string | undefined) ?? undefined,
      // Mantém a janela de RESERVA do slot (20 min) independente da validade do
      // QR do Asaas — o cron libera o horário se não pagar nesse prazo.
      expiraEm: new Date(Date.now() + JANELA_RESERVA_MIN * 60_000),
    };
  }

  async verificarWebhook(req: Request): Promise<ResultadoWebhook> {
    const recebido = req.headers.get("asaas-access-token") ?? "";
    const esperado = env.ASAAS_WEBHOOK_TOKEN ?? "";
    const a = Buffer.from(recebido);
    const b = Buffer.from(esperado);
    if (!esperado || a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valido: false };
    }

    const corpo = await req.json().catch(() => null);
    if (!corpo?.payment?.id) {
      // Token confere, mas é um evento sem cobrança (ex.: teste do painel).
      return { valido: true };
    }

    return {
      valido: true,
      provedorRef: corpo.payment.id as string,
      status: statusDoEvento(corpo.event),
      bruto: corpo,
    };
  }

  async reembolsar(provedorRef: string): Promise<void> {
    await this.api(`/payments/${provedorRef}/refund`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
}
