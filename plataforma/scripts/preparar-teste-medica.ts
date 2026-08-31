/**
 * Prepara o teste manual do lado da médica.
 *
 *     npm run preparar:medica
 *
 * Define a senha, garante o segredo TOTP, coloca a consulta dentro da janela
 * de acesso e confirma que a página de atendimento renderiza. Imprime o
 * `otpauth://` para cadastrar no autenticador — assim os códigos passam a sair
 * do celular, em vez de precisar pedir um novo a cada 30 segundos.
 */

import { PrismaClient } from "@prisma/client";
import {
  gerarHashSenha,
  gerarSegredoTotp,
  gerarCodigoTotp,
  verificarSenha,
} from "../src/lib/seguranca";

const BASE = "http://localhost:3000";
const SENHA = "senha-de-teste-do-roteiro";
const prisma = new PrismaClient();

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
  for (const l of r.headers.getSetCookie?.() ?? []) {
    const [par] = l.split(";");
    const i = par?.indexOf("=") ?? -1;
    if (par && i > 0) cookies.set(par.slice(0, i), par.slice(i + 1));
  }
  const texto = await r.text();
  let corpo: any = null;
  try { corpo = JSON.parse(texto); } catch { /* html */ }
  return { status: r.status, corpo, texto };
}

async function main() {
  const consultaId = process.argv[2];
  if (!consultaId) {
    console.error("uso: npm run preparar:medica -- <consultaId>");
    process.exit(1);
  }

  // Este script REESCREVE a senha da médica. Em desenvolvimento isso é
  // conveniente; contra um banco real seria apagar a credencial dela e
  // substituir por uma senha que está publicada neste arquivo.
  if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")) {
    console.error(
      "\nRECUSADO: DATABASE_URL não aponta para localhost.\n" +
        "Este script sobrescreve a senha da médica por uma senha de teste.\n",
    );
    process.exit(1);
  }

  const medica = await prisma.usuario.findFirstOrThrow({
    where: { papel: "MEDICA" },
    select: { id: true, email: true, nome: true, totpSecret: true, senhaHash: true },
  });

  // Se ela já definiu uma senha própria, não destrói: o segundo fator continua
  // valendo e o script segue servindo para preparar a consulta.
  const senhaPropria =
    !!medica.senhaHash && !(await verificarSenha(SENHA, medica.senhaHash));

  const segredo = medica.totpSecret ?? gerarSegredoTotp();
  await prisma.usuario.update({
    where: { id: medica.id },
    data: {
      ...(senhaPropria ? {} : { senhaHash: await gerarHashSenha(SENHA) }),
      totpSecret: segredo,
    },
  });

  // Janela de acesso: começa em 5 min, então a sala já está aberta.
  const consulta = await prisma.consulta.update({
    where: { id: consultaId },
    data: { inicioEm: new Date(Date.now() + 5 * 60_000), status: "AGENDADA" },
    include: { paciente: { include: { usuario: { select: { nome: true, email: true } } } } },
  });

  // Confirma que a página de atendimento compila e renderiza de verdade.
  let renderizou = false;
  if (!senhaPropria) {
    const csrf = await req("/api/auth/csrf");
    await req("/api/auth/callback/medica", {
      method: "POST",
      form: {
        csrfToken: csrf.corpo?.csrfToken ?? "",
        email: medica.email,
        senha: SENHA,
        totp: gerarCodigoTotp(segredo),
        callbackUrl: BASE,
      },
    });
    const pagina = await req(`/atendimento/${consultaId}`);
    renderizou = pagina.status === 200;
  }

  const rotulo = encodeURIComponent(`Plataforma (${medica.email})`);
  const uri = `otpauth://totp/${rotulo}?secret=${segredo}&issuer=Dra.%20La%C3%ADs%20Hahmed`;

  console.log(`
${"─".repeat(64)}
ACESSO PROFISSIONAL — ${BASE}/entrar  (aba "Acesso profissional")

  E-mail:  ${medica.email}
  Senha:   ${senhaPropria ? "a que você definiu (preservada)" : SENHA}
  Código:  ${gerarCodigoTotp(segredo)}   (vale ~30s)

Para não depender de mim a cada código, cadastre no autenticador:

  Chave:   ${segredo}
  URI:     ${uri}

${"─".repeat(64)}
CONSULTA PRONTA

  Paciente:  ${consulta.paciente.usuario.nome} <${consulta.paciente.usuario.email}>
  Começa em: 5 minutos (a sala já está aberta)
  Atender:   ${BASE}/atendimento/${consultaId}

  Página de atendimento: ${
    senhaPropria
      ? "não verificada (senha própria — não faço login por você)"
      : renderizou
        ? "renderizou (HTTP 200)"
        : "FALHOU"
  }
${"─".repeat(64)}

Este segredo TOTP é de DESENVOLVIMENTO. Antes de produção, rode
\`npm run medica:senha\` com uma senha real — ele gera segredo novo.
`);

  // Só é falha se eu tentei verificar e não consegui. Com senha própria, não
  // tentar é o comportamento correto — não é erro.
  if (!senhaPropria && !renderizou) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
