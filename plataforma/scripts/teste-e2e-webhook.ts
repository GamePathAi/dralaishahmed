/**
 * Teste E2E do webhook de pagamento (Asaas sandbox) — ida e volta pela REDE.
 *
 * Cria uma cobrança Pix REAL no sandbox, ligada a uma consulta, exatamente como
 * o encaixe manual da médica faz (mesmo provedorPagamento()). Depois é só pagar
 * essa cobrança no painel do Asaas (sandbox) para o Asaas disparar o webhook
 * PAYMENT_RECEIVED contra o túnel → nosso app confirma sozinho.
 *
 * Carrega o .env com o MESMO loader do Next (@next/env), que desfaz o "\$" da
 * chave do Asaas — por isso NÃO usa `tsx --env-file`, que leria o "\" literal.
 *
 *   npx tsx scripts/teste-e2e-webhook.ts               # cria a cobrança
 *   npx tsx scripts/teste-e2e-webhook.ts --status <id> # confere a consulta
 */
import { createRequire } from "node:module";
const { loadEnvConfig } = createRequire(import.meta.url)("@next/env");
loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
import { addMinutes } from "date-fns";

const prisma = new PrismaClient();
const EMAIL_TESTE = "teste.webhook.e2e@teste.local";

async function status(consultaId: string) {
  if (!consultaId) throw new Error("Uso: --status <consultaId>");
  const c = await prisma.consulta.findUnique({
    where: { id: consultaId },
    select: {
      status: true,
      statusPagamento: true,
      pagamento: { select: { status: true, provedorRef: true, pagoEm: true, valorCent: true } },
    },
  });
  console.log(JSON.stringify(c, null, 2));
  const pago = c?.statusPagamento === "PAGO" && c?.pagamento?.status === "PAGO";
  console.log(pago ? "\n✅ CONFIRMADO — o webhook chegou e marcou PAGO." : "\n⏳ Ainda PENDENTE — pague no painel do Asaas.");
}

async function criar() {
  const { provedorPagamento } = await import("../src/lib/pagamento");
  const provedor = provedorPagamento();
  console.log("Provedor ativo:", provedor.nome);

  const medica = await prisma.usuario.findFirst({ where: { papel: "MEDICA" }, select: { id: true } });
  if (!medica) throw new Error("Sem médica no banco.");

  let usuario = await prisma.usuario.findUnique({ where: { email: EMAIL_TESTE }, include: { paciente: true } });
  if (!usuario) {
    usuario = await prisma.usuario.create({
      data: { email: EMAIL_TESTE, nome: "Paciente Webhook E2E", papel: "PACIENTE", paciente: { create: {} } },
      include: { paciente: true },
    });
  }

  // Limpa consultas de teste anteriores (ex.: tentativa que falhou antes do Pix).
  if (usuario.paciente) {
    const antigas = await prisma.consulta.findMany({
      where: { pacienteId: usuario.paciente.id },
      select: { id: true },
    });
    const ids = antigas.map((c) => c.id);
    if (ids.length) {
      await prisma.pagamento.deleteMany({ where: { consultaId: { in: ids } } });
      await prisma.consulta.deleteMany({ where: { id: { in: ids } } });
    }
  }

  const valorCent = 500; // R$ 5,00 — mínimo do Asaas
  const inicioEm = addMinutes(new Date(), 90);

  const consulta = await prisma.consulta.create({
    data: {
      pacienteId: usuario.paciente!.id,
      medicaId: medica.id,
      inicioEm,
      duracaoMin: 30,
      modalidade: "TELECONSULTA",
      motivo: "Teste webhook E2E",
      status: "CONFIRMADA",
      statusPagamento: "PENDENTE",
      pagamento: { create: { valorCent, metodo: "PIX", provedor: provedor.nome, status: "PENDENTE" } },
    },
    select: { id: true, pagamento: { select: { id: true } } },
  });

  const cobranca = await provedor.criarCobrancaPix({
    valorCent,
    consultaId: consulta.id,
    pagador: { nome: "Paciente Webhook E2E", email: EMAIL_TESTE, cpf: "52998224725" },
  });

  await prisma.pagamento.update({
    where: { id: consulta.pagamento!.id },
    data: { provedorRef: cobranca.provedorRef, pixCopiaCola: cobranca.copiaCola, expiraEm: cobranca.expiraEm },
  });

  console.log("\n✅ Cobrança criada no Asaas sandbox:");
  console.log("   CONSULTA_ID     = " + consulta.id);
  console.log("   ASAAS_PAYMENT_ID= " + cobranca.provedorRef);
  console.log("   LINK_PAGAMENTO  = " + (cobranca.linkPagamento ?? "(ausente)"));
  console.log("   PIX_COPIA_COLA  = " + (cobranca.copiaCola ? "presente (" + cobranca.copiaCola.slice(0, 20) + "…)" : "AUSENTE"));
  console.log("   VALOR           = R$ " + (valorCent / 100).toFixed(2));
  console.log("   COPIA_COLA      = " + cobranca.copiaCola);
}

async function asaas(paymentId: string) {
  if (!paymentId) throw new Error("Uso: --asaas <paymentId>");
  const base =
    process.env.ASAAS_AMBIENTE === "producao"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const chave = (process.env.ASAAS_API_KEY ?? "").replace(/^\\/, ""); // desfaz o \$ se veio de --env-file
  const r = await fetch(`${base}/payments/${paymentId}`, {
    headers: { access_token: chave, "Content-Type": "application/json" },
  });
  const j = await r.json();
  console.log("HTTP", r.status);
  console.log(JSON.stringify({ id: j.id, status: j.status, value: j.value, billingType: j.billingType, dateCreated: j.dateCreated, confirmedDate: j.confirmedDate, paymentDate: j.paymentDate }, null, 2));
}

async function webhooks() {
  const base =
    process.env.ASAAS_AMBIENTE === "producao"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const chave = (process.env.ASAAS_API_KEY ?? "").replace(/^\\/, "");
  const r = await fetch(`${base}/webhooks`, {
    headers: { access_token: chave, "Content-Type": "application/json" },
  });
  const j = await r.json();
  console.log("HTTP", r.status);
  for (const w of j.data ?? []) {
    console.log(JSON.stringify({ id: w.id, name: w.name, url: w.url, enabled: w.enabled, interrupted: w.interrupted, sendType: w.sendType, apiVersion: w.apiVersion, events: w.events }, null, 2));
  }
  if (!(j.data ?? []).length) console.log("NENHUM webhook configurado.", JSON.stringify(j));
}

async function fixWebhook(novaUrl: string) {
  if (!novaUrl) throw new Error("Uso: --fix-webhook <url>");
  const base =
    process.env.ASAAS_AMBIENTE === "producao"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const chave = (process.env.ASAAS_API_KEY ?? "").replace(/^\\/, "");
  const headers = { access_token: chave, "Content-Type": "application/json" };

  const lista = await (await fetch(`${base}/webhooks`, { headers })).json();
  const w = (lista.data ?? [])[0];
  if (!w) throw new Error("Nenhum webhook para ajustar.");

  // Atualiza só url + enabled + authToken; mantém o resto do que já existe.
  const corpo = {
    name: w.name,
    url: novaUrl,
    email: w.email,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    sendType: w.sendType ?? "SEQUENTIALLY",
    authToken: process.env.ASAAS_WEBHOOK_TOKEN ?? "",
    events: w.events,
  };
  const r = await fetch(`${base}/webhooks/${w.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(corpo),
  });
  const j = await r.json();
  console.log("HTTP", r.status);
  console.log(JSON.stringify({ id: j.id, url: j.url, enabled: j.enabled, interrupted: j.interrupted }, null, 2));
}

async function receive(paymentId: string) {
  if (!paymentId) throw new Error("Uso: --receive <paymentId>");
  const base =
    process.env.ASAAS_AMBIENTE === "producao"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const chave = (process.env.ASAAS_API_KEY ?? "").replace(/^\\/, "");
  const hoje = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${base}/payments/${paymentId}/receiveInCash`, {
    method: "POST",
    headers: { access_token: chave, "Content-Type": "application/json" },
    body: JSON.stringify({ paymentDate: hoje, value: 5, notifyCustomer: false }),
  });
  const j = await r.json();
  console.log("HTTP", r.status, "→ status:", j.status ?? JSON.stringify(j));
}

async function limpar() {
  const u = await prisma.usuario.findUnique({ where: { email: EMAIL_TESTE }, include: { paciente: true } });
  if (!u) return console.log("Nada a limpar.");
  if (u.paciente) {
    const cs = await prisma.consulta.findMany({ where: { pacienteId: u.paciente.id }, select: { id: true } });
    const ids = cs.map((c) => c.id);
    if (ids.length) {
      await prisma.pagamento.deleteMany({ where: { consultaId: { in: ids } } });
      await prisma.consulta.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.paciente.delete({ where: { id: u.paciente.id } });
  }
  await prisma.auditoria.deleteMany({ where: { usuarioId: u.id } });
  await prisma.usuario.delete({ where: { id: u.id } });
  console.log("✅ Dados de teste E2E removidos (paciente + consultas + pagamentos).");
}

async function disableWebhook() {
  const base =
    process.env.ASAAS_AMBIENTE === "producao"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const chave = (process.env.ASAAS_API_KEY ?? "").replace(/^\\/, "");
  const headers = { access_token: chave, "Content-Type": "application/json" };
  const lista = await (await fetch(`${base}/webhooks`, { headers })).json();
  const w = (lista.data ?? [])[0];
  if (!w) return console.log("Nenhum webhook para desativar.");
  const r = await fetch(`${base}/webhooks/${w.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      name: w.name,
      url: w.url,
      email: w.email,
      enabled: false,
      interrupted: false,
      apiVersion: 3,
      sendType: w.sendType ?? "SEQUENTIALLY",
      authToken: process.env.ASAAS_WEBHOOK_TOKEN ?? "",
      events: w.events,
    }),
  });
  const j = await r.json();
  console.log("HTTP", r.status, "→ enabled:", j.enabled, "url:", j.url);
}

const arg = process.argv[2];
const p = process.argv[3] ?? ""; // as funções validam vazio e lançam erro amigável

function dispatch(): Promise<unknown> {
  switch (arg) {
    case "--limpar":
      return limpar();
    case "--receive":
      return receive(p);
    case "--status":
      return status(p);
    case "--asaas":
      return asaas(p);
    case "--webhooks":
      return webhooks();
    case "--fix-webhook":
      return fixWebhook(p);
    case "--disable-webhook":
      return disableWebhook();
    default:
      return criar();
  }
}

dispatch()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
