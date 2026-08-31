/**
 * Adaptador de pagamento para DESENVOLVIMENTO.
 *
 * Faz para o Pix o que o Mailpit faz para e-mail: nada sai para o mundo, e há
 * um jeito de "pagar" localmente (a rota `POST /api/pagamentos/fake/pagar`, que
 * simula o webhook do provedor). Assim o fluxo inteiro — cobrança → webhook →
 * confirmação → e-mail — roda offline, sem chave paga.
 *
 * Determinístico de propósito: o mesmo `provedorRef` gera sempre o mesmo
 * copia-e-cola e o mesmo QR, então o polling do front e o roteiro de teste veem
 * valores estáveis. NÃO depende de rede — a regra do ambiente de dev.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { CobrancaPix, Pagador, ResultadoWebhook, StatusPagamento } from "./tipos";
import { JANELA_RESERVA_MIN } from "./tipos";
import type { ProvedorPagamento } from "./provedor";

/**
 * Assina o corpo do webhook fake. É um HMAC do corpo cru com o segredo de dev —
 * a MESMA verificação que um provedor real faz. A rota `fake/pagar` usa isto
 * para forjar um webhook que passa por `verificarWebhook`, exercitando o
 * caminho de assinatura de verdade em vez de pular a validação.
 */
export function assinarFake(corpo: string): string {
  return createHmac("sha256", env.PAGAMENTO_FAKE_SEGREDO).update(corpo).digest("hex");
}

/** Um QR "de mentira" mas visível: grade derivada do hash, embrulhada em SVG. */
function qrFake(semente: string): string {
  const hash = createHmac("sha256", "qr").update(semente).digest();
  const N = 21; // lado da grade, à la QR pequeno
  const cel = 8;
  const quiet = cel * 2;
  const lado = N * cel + quiet * 2;
  const quadrados: string[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const bit = hash[(y * N + x) % hash.length]! >> ((x + y) % 8);
      if (bit & 1) {
        quadrados.push(
          `<rect x="${quiet + x * cel}" y="${quiet + y * cel}" width="${cel}" height="${cel}"/>`,
        );
      }
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}">` +
    `<rect width="${lado}" height="${lado}" fill="#ffffff"/>` +
    `<g fill="#0f172a">${quadrados.join("")}</g>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export class ProvedorFake implements ProvedorPagamento {
  readonly nome = "FAKE";
  readonly exigeCpf = false; // o fake não valida nada externo — não precisa de CPF

  async criarCobrancaPix({
    valorCent,
    consultaId,
    pagador,
  }: {
    valorCent: number;
    consultaId: string;
    pagador: Pagador;
  }): Promise<CobrancaPix> {
    const provedorRef = `fake_${randomBytes(12).toString("hex")}`;
    // "BR Code" de brincadeira: legível, estável, sem parecer um Pix real.
    const copiaCola =
      `00020126FAKE-PIX-DEV${provedorRef}` +
      `520400005303986540${(valorCent / 100).toFixed(2)}5802BR` +
      `59${(pagador.nome || "PACIENTE").slice(0, 20)}6009SAO PAULO` +
      `62${consultaId.slice(-8)}6304FAKE`;
    return {
      provedorRef,
      copiaCola,
      qrBase64: qrFake(copiaCola),
      // Link de checkout "de mentira" — só para exercitar a UI no dev.
      linkPagamento: `https://checkout-fake.local/i/${provedorRef}`,
      expiraEm: new Date(Date.now() + JANELA_RESERVA_MIN * 60_000),
    };
  }

  async verificarWebhook(req: Request): Promise<ResultadoWebhook> {
    const corpo = await req.text();
    const assinatura = req.headers.get("x-fake-assinatura") ?? "";
    const esperada = assinarFake(corpo);

    // Comparação em tempo constante e com comprimento garantido igual.
    const a = Buffer.from(assinatura);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valido: false };
    }

    let dados: { provedorRef?: string; status?: StatusPagamento } = {};
    try {
      dados = JSON.parse(corpo);
    } catch {
      return { valido: false };
    }

    return {
      valido: true,
      provedorRef: dados.provedorRef,
      status: dados.status ?? "PAGO",
      bruto: dados,
    };
  }

  async reembolsar(provedorRef: string): Promise<void> {
    // Sem mundo externo para estornar: no dev, o reembolso é só a mudança de
    // estado que o chamador grava. Registrado para não passar despercebido.
    console.log("[pagamento/fake] reembolso simulado", provedorRef);
  }
}
