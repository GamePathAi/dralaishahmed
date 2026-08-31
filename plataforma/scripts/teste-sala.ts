/**
 * Passo 7 do roteiro, até onde dá sem navegador.
 *
 *     npm run teste:sala
 *
 * O vídeo em si exige câmera e WebRTC — isso continua manual. O que este script
 * prova é tudo que vem antes: a sala nasce na Daily com as propriedades de
 * privacidade que o `daily.ts` promete, o token é individual e limitado no
 * tempo, e a janela de acesso é respeitada. São justamente as garantias que
 * ninguém percebe estarem furadas só de olhar a tela do vídeo funcionando.
 */

import { PrismaClient } from "@prisma/client";
import { gerarHashSenha, gerarCodigoTotp, gerarSegredoTotp } from "../src/lib/seguranca";

const BASE = "http://localhost:3000";
const SENHA = "senha-de-teste-do-roteiro";
const prisma = new PrismaClient();

let falhas = 0;
const ok = (r: string, d = "") => console.log(`  \x1b[32m✓\x1b[0m ${r}${d ? ` — ${d}` : ""}`);
const nao = (r: string, d: string) => { falhas++; console.log(`  \x1b[31m✗\x1b[0m ${r} — ${d}`); };
const conferir = (c: boolean, r: string, d = "") => (c ? ok(r, d) : nao(r, d || "falso"));

const cookies = new Map<string, string>();
async function req(caminho: string, init: RequestInit & { form?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  let body = init.body;
  if (init.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form).toString();
  }
  const r = await fetch(`${BASE}${caminho}`, { ...init, headers, body, redirect: "manual" });
  for (const linha of r.headers.getSetCookie?.() ?? []) {
    const [par] = linha.split(";");
    const i = par?.indexOf("=") ?? -1;
    if (par && i > 0) cookies.set(par.slice(0, i), par.slice(i + 1));
  }
  const texto = await r.text();
  let corpo: any = null;
  try { corpo = JSON.parse(texto); } catch { /* html */ }
  return { status: r.status, corpo };
}

/** Payload de um JWT, sem verificar assinatura — só para inspecionar claims. */
function claims(jwt: string): any {
  const p = jwt.split(".")[1];
  if (!p) return {};
  return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
}

const daily = (caminho: string) =>
  fetch(`https://api.daily.co/v1${caminho}`, {
    headers: { Authorization: `Bearer ${process.env.DAILY_API_KEY}` },
  }).then((r) => r.json() as Promise<any>);

async function main() {
  const consultaId = process.argv[2];
  if (!consultaId) {
    console.error("uso: npm run teste:sala -- <consultaId>");
    process.exit(1);
  }

  console.log(`\n\x1b[1mPasso 7 — sala de teleconsulta\x1b[0m\n${"─".repeat(60)}`);

  // ---- sessão da médica --------------------------------------------------
  const medica = await prisma.usuario.findFirstOrThrow({
    where: { papel: "MEDICA" },
    select: { id: true, email: true, totpSecret: true },
  });
  const segredo = medica.totpSecret ?? gerarSegredoTotp();
  await prisma.usuario.update({
    where: { id: medica.id },
    data: { senhaHash: await gerarHashSenha(SENHA), totpSecret: segredo },
  });

  const { corpo: csrf } = await req("/api/auth/csrf");
  await req("/api/auth/callback/medica", {
    method: "POST",
    form: {
      csrfToken: csrf.csrfToken,
      email: medica.email,
      senha: SENHA,
      totp: gerarCodigoTotp(segredo),
      callbackUrl: BASE,
    },
  });
  const sessao = await req("/api/auth/session");
  conferir(sessao.corpo?.user?.papel === "MEDICA", "Sessão da médica aberta");

  // ---- abrir a sala ------------------------------------------------------
  console.log("\n\x1b[1mAbertura da sala\x1b[0m");
  const r = await req(`/api/consultas/${consultaId}/sala`, { method: "POST" });

  if (r.status !== 200) {
    nao("POST /sala", `status ${r.status}: ${JSON.stringify(r.corpo).slice(0, 200)}`);
    console.log("\nInterrompido — a sala não abriu.\n");
    process.exitCode = 1;
    return;
  }
  ok("POST /sala responde 200");
  conferir(!!r.corpo.salaUrl, "Devolve URL da sala", r.corpo.salaUrl);
  conferir(!!r.corpo.token, "Devolve token de acesso");
  conferir(r.corpo.papel === "MEDICA", "Papel correto no retorno", r.corpo.papel);
  conferir(
    r.corpo.crmMedica?.includes("CRM-MS"),
    "CRM vai junto para exibir na sala",
    r.corpo.crmMedica,
  );

  // ---- o que a Daily realmente criou -------------------------------------
  console.log("\n\x1b[1mPropriedades da sala na Daily\x1b[0m");
  const sala = await daily(`/rooms/consulta-${consultaId}`);
  const p = sala.config ?? {};

  conferir(sala.privacy === "private", "Sala é privada", sala.privacy);
  conferir(p.max_participants === 2, "Limite de 2 participantes", `${p.max_participants}`);
  // "" é como a Daily representa "nenhuma gravação" — o campo é enum de
  // string, não booleano. Qualquer valor não-vazio aqui seria vídeo de
  // paciente indo parar na infraestrutura deles.
  conferir(
    p.enable_recording === "" || p.enable_recording === undefined,
    "Gravação em nuvem DESLIGADA",
    `enable_recording=${JSON.stringify(p.enable_recording)}`,
  );
  conferir(p.enable_prejoin_ui === true, "Tela de checagem de câmera ativa");
  conferir(p.eject_at_room_exp === true, "Participantes saem quando a sala expira");
  conferir(p.lang === "pt", "Interface em português", p.lang);

  const agora = Math.floor(Date.now() / 1000);
  conferir(p.nbf !== undefined && p.nbf <= agora, "Sala já abriu (nbf no passado)");
  conferir(p.exp !== undefined && p.exp > agora, "Sala ainda válida (exp no futuro)");
  const janelaMin = Math.round(((p.exp ?? 0) - (p.nbf ?? 0)) / 60);
  conferir(janelaMin === 75, "Janela total de 75 min (15 antes + 30 + 30 depois)", `${janelaMin} min`);

  // ---- o token ------------------------------------------------------------
  console.log("\n\x1b[1mToken individual\x1b[0m");
  const c = claims(r.corpo.token);
  conferir(c.r === `consulta-${consultaId}`, "Token preso a ESTA sala", c.r);
  conferir(c.o === true, "Médica entra como dona da sala (is_owner)");
  // Claims da Daily são abreviadas: ud=user_id, u=user_name, o=is_owner,
  // r=room_name, er=enable_recording.
  conferir(c.ud === medica.id, "Token carrega o id de quem pediu", c.ud);
  conferir(
    c.er === "" || c.er === undefined,
    "Token também nega gravação",
    `er=${JSON.stringify(c.er)}`,
  );
  conferir(c.exp > agora && c.nbf <= agora, "Token válido agora, com validade limitada");

  // ---- janela de tempo ----------------------------------------------------
  console.log("\n\x1b[1mJanela de acesso\x1b[0m");
  const original = await prisma.consulta.findUniqueOrThrow({
    where: { id: consultaId },
    select: { inicioEm: true },
  });

  await prisma.consulta.update({
    where: { id: consultaId },
    data: { inicioEm: new Date(Date.now() + 3 * 3600_000), status: "AGENDADA" },
  });
  const cedo = await req(`/api/consultas/${consultaId}/sala`, { method: "POST" });
  conferir(
    cedo.status === 425 && cedo.corpo?.codigo === "SALA_AINDA_FECHADA",
    "Antes da hora devolve 425 com mensagem útil",
    `status ${cedo.status}`,
  );

  await prisma.consulta.update({
    where: { id: consultaId },
    data: { inicioEm: new Date(Date.now() - 5 * 3600_000) },
  });
  const tarde = await req(`/api/consultas/${consultaId}/sala`, { method: "POST" });
  conferir(
    tarde.status === 410 && tarde.corpo?.codigo === "SALA_EXPIRADA",
    "Depois da janela devolve 410",
    `status ${tarde.status}`,
  );

  await prisma.consulta.update({
    where: { id: consultaId },
    data: { inicioEm: original.inicioEm, status: "EM_ANDAMENTO" },
  });

  console.log("\n" + "─".repeat(60));
  console.log(
    falhas === 0
      ? "\x1b[32mTudo passou.\x1b[0m"
      : `\x1b[31m${falhas} falharam.\x1b[0m`,
  );
  console.log(`\nAbra no navegador para ver o vídeo:\n  ${BASE}/atendimento/${consultaId}\n`);
  if (falhas) process.exitCode = 1;
}

main()
  .catch((e) => { console.error("\nInterrompido:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
