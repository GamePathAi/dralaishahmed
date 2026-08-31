/**
 * Roteiro de teste de ponta a ponta — seção 6 do README.
 *
 *     npm run roteiro
 *
 * Exercita a aplicação pela HTTP, como um cliente qualquer: nada de chamar
 * função interna e declarar vitória. O login da médica é o login de verdade,
 * com senha e TOTP passando pelo Auth.js — sessão forjada provaria só que o
 * forjador funciona.
 *
 * FORA DE ALCANCE, e por quê:
 *   • sala de vídeo (passo 7)      — exige DAILY_API_KEY real e WebRTC no navegador
 *   • transcrição + IA (passo 9)   — exige OPENAI_API_KEY e ANTHROPIC_API_KEY reais,
 *                                    e áudio de consulta; ambas cobram por chamada
 * O passo 8 é coberto parcialmente: o registro de consentimento é verificado
 * pelo banco, a recusa dentro da sala não.
 *
 * SOMENTE DESENVOLVIMENTO. As guardas no início se recusam a rodar contra banco
 * remoto ou SMTP que entregue de verdade — este script cria paciente fictício,
 * cancela consulta e dispara e-mail.
 */

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { gerarHashSenha, gerarCodigoTotp, gerarSegredoTotp } from "../src/lib/seguranca";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const SENHA_TESTE = "senha-de-teste-do-roteiro";

const prisma = new PrismaClient();

// ------------------------------------------------------------ instrumentação

let passos = 0;
let falhas = 0;
const pendencias: string[] = [];

function ok(rotulo: string, detalhe = "") {
  passos++;
  console.log(`  \x1b[32m✓\x1b[0m ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

function falhou(rotulo: string, detalhe: string) {
  passos++;
  falhas++;
  console.log(`  \x1b[31m✗\x1b[0m ${rotulo} — ${detalhe}`);
}

/** Afirma e segue: um passo quebrado não deve esconder os seguintes. */
function conferir(condicao: boolean, rotulo: string, detalhe = "") {
  if (condicao) ok(rotulo, detalhe);
  else falhou(rotulo, detalhe || "condição falsa");
  return condicao;
}

function foraDeAlcance(rotulo: string, porque: string) {
  pendencias.push(`${rotulo} — ${porque}`);
  console.log(`  \x1b[33m•\x1b[0m ${rotulo} \x1b[2m(fora de alcance: ${porque})\x1b[0m`);
}

function secao(titulo: string) {
  console.log(`\n\x1b[1m${titulo}\x1b[0m`);
}

// ------------------------------------------------------------- cookies e HTTP

const cookies = new Map<string, string>();

function guardarCookies(resposta: Response) {
  // getSetCookie existe no undici do Node 20+; sem ele, cookies múltiplos numa
  // única linha se perderiam silenciosamente.
  for (const linha of resposta.headers.getSetCookie?.() ?? []) {
    const [par] = linha.split(";");
    const idx = par?.indexOf("=") ?? -1;
    if (!par || idx < 1) continue;
    cookies.set(par.slice(0, idx), par.slice(idx + 1));
  }
}

function cabecalhoCookie(): string {
  return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function req(
  caminho: string,
  init: RequestInit & { form?: Record<string, string>; json?: unknown } = {},
): Promise<{ status: number; corpo: any; texto: string; headers: Headers }> {
  const headers = new Headers(init.headers);
  if (cookies.size) headers.set("cookie", cabecalhoCookie());

  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (init.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form).toString();
  }

  const r = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers,
    body,
    redirect: "manual",
  });
  guardarCookies(r);

  const texto = await r.text();
  let corpo: any = null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    /* HTML de página, não JSON */
  }
  return { status: r.status, corpo, texto, headers: r.headers };
}

// ------------------------------------------------------------------- Mailpit

async function limparCaixa() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
}

type Mensagem = { ID: string; Subject: string; To: { Address: string }[] };

async function caixa(): Promise<Mensagem[]> {
  const r = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
  return ((await r.json()) as { messages: Mensagem[] }).messages ?? [];
}

async function corpoDe(id: string): Promise<string> {
  const r = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  const m = (await r.json()) as { Text?: string; HTML?: string };
  return `${m.Text ?? ""}\n${m.HTML ?? ""}`;
}

/**
 * Derruba e devolve o SMTP, para exercitar o caminho de falha de verdade em vez
 * de confiar na leitura do código. Parar o contêiner faz a porta recusar
 * conexão — exatamente o que um SMTP fora do ar faz.
 */
async function pausarMailpit() {
  execSync("docker compose stop mailpit", { stdio: "ignore" });
}

async function retomarMailpit() {
  execSync("docker compose start mailpit", { stdio: "ignore" });
  // O contêiner volta antes de a porta aceitar conexão.
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${MAILPIT}/api/v1/messages?limit=1`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Espera a mensagem aparecer: o envio é assíncrono ao retorno da API. */
async function esperarEmail(
  para: string,
  assuntoContem: string,
  tentativas = 20,
): Promise<Mensagem | null> {
  for (let i = 0; i < tentativas; i++) {
    const m = (await caixa()).find(
      (x) =>
        x.To.some((t) => t.Address === para) && x.Subject.includes(assuntoContem),
    );
    if (m) return m;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// -------------------------------------------------------------------- guardas

function exigirAmbienteLocal() {
  const db = process.env.DATABASE_URL ?? "";
  const smtp = process.env.EMAIL_SERVER ?? "";
  const local = (s: string) => /(localhost|127\.0\.0\.1)/.test(s);

  if (!local(db)) {
    console.error(
      "\nRECUSADO: DATABASE_URL não aponta para localhost.\n" +
        "Este roteiro cria paciente fictício e CANCELA consultas — não roda contra banco real.\n",
    );
    process.exit(1);
  }
  if (!local(smtp)) {
    console.error(
      "\nRECUSADO: EMAIL_SERVER não aponta para localhost.\n" +
        "O roteiro dispara confirmação, lembrete e cancelamento. Aponte para o Mailpit\n" +
        '(EMAIL_SERVER="smtp://usuario:senha@localhost:1025") para não enviar e-mail de verdade.\n',
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------- passos

async function main() {
  exigirAmbienteLocal();

  console.log(`\n\x1b[1mRoteiro de teste\x1b[0m  ${BASE}\n${"─".repeat(64)}`);
  await limparCaixa();

  // ---- credenciais da médica (o script assume o papel de `medica:senha`) ----
  const medica = await prisma.usuario.findFirstOrThrow({
    where: { papel: "MEDICA" },
    select: { id: true, email: true, totpSecret: true },
  });
  const totpSecret = medica.totpSecret ?? gerarSegredoTotp();
  await prisma.usuario.update({
    where: { id: medica.id },
    data: { senhaHash: await gerarHashSenha(SENHA_TESTE), totpSecret },
  });

  // ---------------------------------------------------------------- passo 1
  secao("1. Páginas públicas");
  {
    const home = await req("/");
    conferir(home.status === 200, "GET / responde 200", `status ${home.status}`);

    // Os dois sentidos da mesma regra. `/agendar` é público e começa com
    // "/agenda"; casar por prefixo de string mandava visitante anônimo para o
    // login. Afrouxar a comparação não pode ter aberto a área da médica junto.
    const agendar = await req("/agendar");
    conferir(
      agendar.status === 200,
      "GET /agendar é público (não cai no login)",
      `status ${agendar.status}`,
    );

    const agendaAnonima = await req("/agenda");
    conferir(
      agendaAnonima.status === 307 &&
        (agendaAnonima.headers.get("location") ?? "").includes("/entrar"),
      "GET /agenda sem sessão ainda redireciona para /entrar",
      `status ${agendaAnonima.status}`,
    );

    const hoje = new Date().toISOString().slice(0, 10);
    const grade = await req(`/api/agenda/horarios?data=${hoje}`);
    const total = (grade.corpo?.dias ?? []).reduce(
      (s: number, d: any) => s + d.horarios.length,
      0,
    );
    conferir(grade.status === 200 && total > 0, "Grade traz horários", `${total} encaixes`);
    conferir(
      grade.corpo?.fuso === "America/Campo_Grande",
      "Horários no fuso da médica",
      grade.corpo?.fuso,
    );
  }

  // ---------------------------------------------------------------- passo 2
  secao("2. Agendamento público");
  const vagas: string[] = [];
  {
    const hoje = new Date().toISOString().slice(0, 10);
    const grade = await req(`/api/agenda/horarios?data=${hoje}`);
    for (const d of grade.corpo?.dias ?? []) {
      for (const h of d.horarios) vagas.push(h.inicioEm);
    }
    conferir(vagas.length >= 4, "Há vagas suficientes para o roteiro", `${vagas.length}`);
  }

  const paciente = {
    nome: "Paciente Fictício do Roteiro",
    email: "roteiro@teste.local",
    telefone: "67999990000",
  };

  async function agendar(inicioEm: string, motivo: string) {
    return req("/api/consultas", {
      method: "POST",
      json: { ...paciente, inicioEm, modalidade: "TELECONSULTA", duracaoMin: 30, motivo, aceitouTermos: true },
    });
  }

  /** Simula o webhook do provedor: paga o Pix da consulta (rota só de dev). */
  async function pagar(consultaId: string) {
    return req("/api/pagamentos/fake/pagar", { method: "POST", json: { consultaId } });
  }

  const consultaA = await agendar(vagas[0]!, "Roteiro: cancelamento");
  conferir(consultaA.status === 201, "Agendar cria a consulta", `status ${consultaA.status}`);
  // O roteiro se ADAPTA ao flag PAGAMENTO_ATIVO: com Pix na resposta, exercita o
  // fluxo de pagamento; sem Pix, o de confirmação direta (a config de produção).
  const pagamentoLigado = !!consultaA.corpo?.pix;
  console.log(
    `  \x1b[2m→ pagamento ${pagamentoLigado ? "LIGADO (Pix)" : "DESLIGADO (confirma direto)"}\x1b[0m`,
  );

  // Consulta (paga ou isenta) já segura o horário: reagendar o mesmo slot falha.
  const duplicada = await agendar(vagas[0]!, "Roteiro: duplicada");
  conferir(
    duplicada.status === 409 && duplicada.corpo?.codigo === "HORARIO_INDISPONIVEL",
    "Mesmo horário de novo devolve 409",
    `status ${duplicada.status}`,
  );

  const consultaB = await agendar(vagas[1]!, "Roteiro: prontuário");
  conferir(consultaB.status === 201, "Segunda consulta criada (prontuário)");
  const consultaC = await agendar(vagas[2]!, "Roteiro: lembrete");
  conferir(consultaC.status === 201, "Terceira consulta criada (lembrete)");

  if (pagamentoLigado) {
    // Estado inicial (AGUARDANDO_PAGAMENTO/PENDENTE) e "confirmação não sai antes de pagar".
    {
      const c = await prisma.consulta.findUniqueOrThrow({
        where: { id: consultaA.corpo?.consultaId },
        select: {
          status: true,
          statusPagamento: true,
          pagamento: { select: { status: true, valorCent: true, provedor: true, provedorRef: true, expiraEm: true } },
        },
      });
      conferir(
        c.status === "AGUARDANDO_PAGAMENTO" && c.statusPagamento === "PENDENTE",
        "Consulta nasce AGUARDANDO_PAGAMENTO / PENDENTE",
        `${c.status} / ${c.statusPagamento}`,
      );
      conferir(
        !!c.pagamento && c.pagamento.status === "PENDENTE" && c.pagamento.valorCent > 0 &&
          c.pagamento.provedor === "FAKE" && !!c.pagamento.provedorRef && !!c.pagamento.expiraEm,
        "Pagamento PENDENTE criado com provedorRef e expiraEm",
        `${c.pagamento?.valorCent} centavos`,
      );
      conferir(consultaA.corpo?.pix?.teste === true, "Provedor fake sinaliza modo de teste");
      const cedo = await esperarEmail(paciente.email, "Confirmação", 6);
      conferir(!cedo, "Confirmação NÃO é enviada antes do pagamento", "sai só no webhook");
    }

    // -------------------------------------------------------------- passo 2a
    secao("2a. Pagamento (Pix) confirma a consulta");
    {
      const pg = await pagar(consultaA.corpo?.consultaId);
      conferir(pg.status === 200 && pg.corpo?.ok === true, "fake/pagar confirma o pagamento", `status ${pg.status}`);

      const c = await prisma.consulta.findUniqueOrThrow({
        where: { id: consultaA.corpo?.consultaId },
        select: { status: true, statusPagamento: true, pagamento: { select: { status: true, pagoEm: true } } },
      });
      conferir(
        c.status === "CONFIRMADA" && c.statusPagamento === "PAGO",
        "Consulta vira CONFIRMADA / PAGO",
        `${c.status} / ${c.statusPagamento}`,
      );
      conferir(c.pagamento?.status === "PAGO" && !!c.pagamento?.pagoEm, "Pagamento marcado PAGO com pagoEm");

      // Idempotência: o webhook chega repetido e não pode reprocessar.
      const denovo = await pagar(consultaA.corpo?.consultaId);
      conferir(
        denovo.status === 200 && denovo.corpo?.jaProcessado === true,
        "Webhook repetido é idempotente (jaProcessado)",
        JSON.stringify(denovo.corpo),
      );

      const trilha = await prisma.auditoria.count({
        where: { acao: "REGISTROU_PAGAMENTO", recursoId: consultaA.corpo?.consultaId },
      });
      conferir(trilha === 1, "Auditoria registra o pagamento UMA vez", `${trilha}`);

      const m = await esperarEmail(paciente.email, "Confirmação");
      if (conferir(!!m, "Confirmação chega DEPOIS do pagamento")) {
        const corpo = await corpoDe(m!.ID);
        conferir(!corpo.includes("/sala/"), "Confirmação NÃO traz link de sala");
        conferir(corpo.includes("Teleconsulta"), "Confirmação nomeia a modalidade");
      }
      const marcada = await prisma.consulta.findUniqueOrThrow({
        where: { id: consultaA.corpo?.consultaId },
        select: { confirmacaoEnviadaEm: true },
      });
      conferir(marcada.confirmacaoEnviadaEm !== null, "Envio da confirmação fica marcado no banco");
    }

    // -------------------------------------------------------------- passo 2b
    secao("2b. Pagamento quando o e-mail (SMTP) está fora do ar");
    {
      await pausarMailpit();
      try {
        const pg = await pagar(consultaB.corpo?.consultaId);
        conferir(pg.status === 200, "Pagamento confirma mesmo com SMTP fora", `status ${pg.status}`);
        const c = await prisma.consulta.findUniqueOrThrow({
          where: { id: consultaB.corpo?.consultaId },
          select: { status: true, statusPagamento: true, confirmacaoEnviadaEm: true },
        });
        conferir(
          c.status === "CONFIRMADA" && c.statusPagamento === "PAGO",
          "Consulta confirma apesar de o e-mail falhar",
          `${c.status} / ${c.statusPagamento}`,
        );
        conferir(c.confirmacaoEnviadaEm === null, "Falha de e-mail fica sem marca (vira 'não avisado')");
      } finally {
        await retomarMailpit();
      }
    }

    // Paga a terceira (SMTP de volta) para o teste de lembrete.
    {
      const pg = await pagar(consultaC.corpo?.consultaId);
      conferir(pg.status === 200, "Terceira consulta paga (para o lembrete)", `status ${pg.status}`);
    }
  } else {
    // ---- caminho SEM pagamento (config de produção): confirma direto -----
    secao("2a. Agendamento confirma direto (pagamento desligado)");
    {
      const c = await prisma.consulta.findUniqueOrThrow({
        where: { id: consultaA.corpo?.consultaId },
        select: { status: true, statusPagamento: true, confirmacaoEnviadaEm: true },
      });
      conferir(
        c.status === "AGENDADA" && c.statusPagamento === "ISENTO",
        "Consulta nasce AGENDADA / ISENTA (sem cobrança)",
        `${c.status} / ${c.statusPagamento}`,
      );
      conferir(consultaA.corpo?.confirmacaoEnviada === true, "Resposta informa que a confirmação saiu");
      const m = await esperarEmail(paciente.email, "Confirmação");
      if (conferir(!!m, "Confirmação chega no ato do agendamento")) {
        const corpo = await corpoDe(m!.ID);
        conferir(!corpo.includes("/sala/"), "Confirmação NÃO traz link de sala");
        conferir(corpo.includes("Teleconsulta"), "Confirmação nomeia a modalidade");
      }
      conferir(c.confirmacaoEnviadaEm !== null, "Envio da confirmação fica marcado no banco");
    }

    secao("2b. Agendamento quando o e-mail (SMTP) está fora do ar");
    {
      // E-mail próprio para não estourar a cota de 3 agendamentos por e-mail.
      await pausarMailpit();
      try {
        const r = await req("/api/consultas", {
          method: "POST",
          json: {
            nome: "Paciente SMTP do Roteiro",
            email: "falha.smtp.roteiro@teste.local",
            telefone: "67999992222",
            inicioEm: vagas[3]!,
            modalidade: "TELECONSULTA",
            duracaoMin: 30,
            motivo: "Roteiro: SMTP fora",
            aceitouTermos: true,
          },
        });
        conferir(r.status === 201, "Agendamento é gravado mesmo com SMTP fora", `status ${r.status}`);
        conferir(r.corpo?.confirmacaoEnviada === false, "Resposta admite que o e-mail não saiu");
        const c = await prisma.consulta.findUniqueOrThrow({
          where: { id: r.corpo?.consultaId },
          select: { confirmacaoEnviadaEm: true },
        });
        conferir(c.confirmacaoEnviadaEm === null, "Falha fica sem marca no banco");
      } finally {
        await retomarMailpit();
      }
    }
  }

  // --------------------------------------------------------------- passo 2c
  // O login do paciente é a única porta de entrada dele, e ficou quebrado sem
  // ninguém notar porque a tela anunciava sucesso mesmo com o backend
  // estourando. Este bloco existe para isso não se repetir.
  secao("2c. Magic link do paciente");
  {
    async function pedirLink(endereco: string) {
      const csrf = await req("/api/auth/csrf");
      return req("/api/auth/signin/nodemailer", {
        method: "POST",
        form: {
          csrfToken: csrf.corpo?.csrfToken ?? "",
          email: endereco,
          callbackUrl: `${BASE}/minhas-consultas`,
        },
      });
    }

    const antes = (await caixa()).length;
    const r = await pedirLink(paciente.email);
    conferir(r.status < 400, "Pedido de link não estoura", `status ${r.status}`);

    const m = await esperarEmail(paciente.email, "");
    if (conferir(!!m, "Magic link chega para paciente cadastrado")) {
      const corpo = await corpoDe(m!.ID);
      conferir(
        /\/api\/auth\/callback\/nodemailer\?/.test(corpo),
        "E-mail traz o link de callback do Auth.js",
      );
    }

    const guardado = await prisma.tokenVerificacao.count({
      where: { identifier: paciente.email },
    });
    conferir(guardado >= 1, "Token gravado no banco", `${guardado}`);

    // Endereço que nunca agendou não vira conta nem recebe link.
    const depoisDoPrimeiro = (await caixa()).length;
    await pedirLink("desconhecido.roteiro@teste.local");
    await new Promise((r) => setTimeout(r, 2500));
    conferir(
      (await caixa()).length === depoisDoPrimeiro,
      "Desconhecido NÃO recebe link",
      "evita base de paciente fantasma",
    );
    conferir(
      (await prisma.usuario.count({
        where: { email: "desconhecido.roteiro@teste.local" },
      })) === 0,
      "Desconhecido NÃO vira usuário",
    );

    // A médica não pode entrar por link: isso puliria o segundo fator e daria
    // acesso a todos os prontuários com a caixa de e-mail dela.
    const antesDaMedica = (await caixa()).length;
    await pedirLink(medica.email);
    await new Promise((r) => setTimeout(r, 2500));
    conferir(
      (await caixa()).length === antesDaMedica,
      "MÉDICA não recebe magic link",
      "entraria sem TOTP",
    );

    void antes;
  }

  // ---------------------------------------------------------------- passo 3
  secao("3. Acesso profissional (senha + TOTP)");
  {
    const csrf = await req("/api/auth/csrf");
    const token = csrf.corpo?.csrfToken as string | undefined;
    conferir(!!token, "CSRF obtido");

    const errado = await req("/api/auth/callback/medica", {
      method: "POST",
      form: {
        csrfToken: token ?? "",
        email: medica.email,
        senha: SENHA_TESTE,
        totp: "000000",
        callbackUrl: BASE,
      },
    });
    const sessaoErrada = await req("/api/auth/session");
    conferir(
      !sessaoErrada.corpo?.user,
      "TOTP inválido não abre sessão",
      `callback ${errado.status}`,
    );

    await req("/api/auth/callback/medica", {
      method: "POST",
      form: {
        csrfToken: token ?? "",
        email: medica.email,
        senha: SENHA_TESTE,
        totp: gerarCodigoTotp(totpSecret),
        callbackUrl: BASE,
      },
    });
    const sessao = await req("/api/auth/session");
    conferir(
      sessao.corpo?.user?.papel === "MEDICA",
      "Senha + TOTP corretos abrem sessão de MEDICA",
      sessao.corpo?.user?.papel ?? "sem sessão",
    );
  }

  // ---------------------------------------------------------------- passo 4
  secao("4. Agenda da médica");
  {
    const agenda = await req("/agenda");
    conferir(agenda.status === 200, "GET /agenda responde 200", `status ${agenda.status}`);
    conferir(
      agenda.texto.includes("Paciente Fictício"),
      "Consulta agendada aparece na agenda",
    );
  }

  // ---------------------------------------------------------------- passo 5
  secao("5. Disponibilidade");
  {
    const lista = await req("/api/agenda/disponibilidade");
    const janelas = lista.corpo?.janelas ?? [];
    conferir(
      Array.isArray(janelas) && janelas.length > 0,
      "Janelas do seed listadas",
      `${Array.isArray(janelas) ? janelas.length : "?"}`,
    );

    const base = Array.isArray(janelas) ? janelas[0] : null;
    if (base) {
      const sobreposta = await req("/api/agenda/disponibilidade", {
        method: "POST",
        json: {
          diaSemana: base.diaSemana,
          inicioMin: base.inicioMin + 30,
          fimMin: base.fimMin - 30,
          modalidade: "TELECONSULTA",
          duracaoMin: 30,
          intervaloMin: 10,
        },
      });
      conferir(
        sobreposta.status >= 400,
        "Janela sobreposta é recusada",
        `status ${sobreposta.status}`,
      );
    }
  }

  // --------------------------------------------------------------- passo 5b
  // Dashboard de disponibilidade: horário especial (positivo, por data) e folga
  // (bloqueio de dia inteiro). Ambos precisam mexer na GRADE que o paciente vê.
  secao("5b. Horário especial e folga por data");
  {
    // Data no fuso da médica (Campo Grande, UTC-4); weekday por um meio-dia,
    // que nunca escorrega de dia em conversão de fuso.
    const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" });
    const dowDe = (s: string) => new Date(`${s}T12:00:00`).getDay();

    const disp = await req("/api/agenda/disponibilidade");
    const comJanela = new Set<number>((disp.corpo?.janelas ?? []).map((j: any) => j.diaSemana));

    // conta vagas de UMA data (opcionalmente filtrando modalidade) na grade
    async function vagasEm(data: string, modalidade?: string): Promise<number> {
      const q = modalidade ? `&modalidade=${modalidade}` : "";
      const g = await req(`/api/agenda/horarios?data=${data}${q}`);
      const dia = (g.corpo?.dias ?? []).find((d: any) => d.data === data);
      return dia ? dia.horarios.length : 0;
    }
    // modalidade da primeira vaga de um dia (para o teste de vazamento)
    async function modDoDia(data: string): Promise<string | undefined> {
      const g = await req(`/api/agenda/horarios?data=${data}`);
      const dia = (g.corpo?.dias ?? []).find((d: any) => d.data === data);
      return dia?.horarios?.[0]?.modalidade;
    }
    // a rota transacional única do dashboard
    async function dia(data: string, body: Record<string, unknown>) {
      return req("/api/agenda/dia", { method: "POST", json: { data, ...body } });
    }

    // Acha uma data futura de FOLGA (weekday sem janela) e outra de ATENDIMENTO.
    // Bem à frente (21+ dias) de propósito: assim não cai num dia onde o próprio
    // roteiro marcou consulta near-term, o que faria a folga bater em conflito.
    let dataOff = "", dataOn = "";
    for (let i = 21; i < 55 && (!dataOff || !dataOn); i++) {
      const s = ymd(new Date(Date.now() + i * 86_400_000));
      const dow = dowDe(s);
      if (!dataOff && !comJanela.has(dow)) dataOff = s;
      if (!dataOn && comJanela.has(dow)) dataOn = s;
    }

    // ---- horário especial num dia normalmente de folga ----
    if (conferir(!!dataOff, "Achou um dia sem janela recorrente para o teste", dataOff)) {
      conferir((await vagasEm(dataOff)) === 0, "Dia de folga não oferece vaga antes do especial");

      const criar = await dia(dataOff, {
        acao: "especial",
        janela: { inicioMin: 8 * 60, fimMin: 10 * 60, modalidade: "TELECONSULTA", duracaoMin: 30, intervaloMin: 10 },
      });
      conferir(criar.status === 201, "Horário especial criado", `status ${criar.status}`);
      conferir((await vagasEm(dataOff)) > 0, "Horário especial abre vagas na data (08:00–10:00)");

      await dia(dataOff, { acao: "padrao" });
      conferir((await vagasEm(dataOff)) === 0, "Voltar ao padrão remove o especial");
    }

    // ---- folga num dia normalmente de atendimento ----
    if (conferir(!!dataOn, "Achou um dia de atendimento para o teste", dataOn)) {
      const antes = await vagasEm(dataOn);
      conferir(antes > 0, "Dia de atendimento oferece vagas antes da folga", `${antes} vagas`);

      const folga = await dia(dataOn, { acao: "folga", cancelarConflitos: false });
      conferir(folga.status === 201, "Folga (dia inteiro) criada", `status ${folga.status}`);
      conferir((await vagasEm(dataOn)) === 0, "Folga remove todas as vagas do dia");

      await dia(dataOn, { acao: "padrao" });
      conferir((await vagasEm(dataOn)) > 0, "Voltar ao padrão devolve as vagas");
    }

    // ---- vazamento entre modalidades (achado dos revisores) ----
    // Um especial de UMA modalidade não pode sumir com a recorrente da OUTRA.
    if (dataOn) {
      const modBase = await modDoDia(dataOn); // modalidade recorrente do dia (tele, no seed)
      const modOutra = modBase === "PRESENCIAL" ? "TELECONSULTA" : "PRESENCIAL";
      const recorrenteAntes = await vagasEm(dataOn, modBase);

      await dia(dataOn, {
        acao: "especial",
        janela: { inicioMin: 8 * 60, fimMin: 9 * 60, modalidade: modOutra, duracaoMin: 30, intervaloMin: 0 },
      });
      const recorrenteDepois = await vagasEm(dataOn, modBase);
      const especialVagas = await vagasEm(dataOn, modOutra);

      conferir(
        recorrenteDepois === recorrenteAntes,
        `Especial de ${modOutra} NÃO apaga a recorrente de ${modBase}`,
        `${recorrenteAntes}→${recorrenteDepois}`,
      );
      conferir(especialVagas > 0, `Especial de ${modOutra} aparece na própria modalidade`, `${especialVagas} vagas`);
      conferir(
        (await vagasEm(dataOn)) >= recorrenteAntes + especialVagas,
        "Sem filtro, o dia mostra recorrente + especial (não some vaga)",
      );

      await dia(dataOn, { acao: "padrao" });
    }
  }

  // --------------------------------------------------------- passos 10 e 11
  secao("10. Registro clínico, assinatura e retificação");
  const consultaBId = consultaB.corpo?.consultaId as string;
  let registroId = "";
  {
    const relatorio = {
      queixaPrincipal: "Dor de garganta há 3 dias.",
      historiaMoleastiaAtual: "Início súbito, sem febre aferida.",
      antecedentes: "Nega comorbidades.",
      hipotesesDiagnosticas: "Faringite viral.",
      conduta: "Sintomáticos e retorno se piora.",
      observacoes: null as string | null,
    };

    const criado = await req(`/api/consultas/${consultaBId}/registro`, {
      method: "POST",
      json: relatorio,
    });
    registroId = criado.corpo?.registroId ?? "";
    conferir(criado.status === 201 && !!registroId, "Rascunho manual criado");

    const duplicado = await req(`/api/consultas/${consultaBId}/registro`, {
      method: "POST",
      json: relatorio,
    });
    conferir(
      duplicado.status === 409 && duplicado.corpo?.codigo === "RASCUNHO_EXISTENTE",
      "Segundo rascunho na mesma consulta é recusado",
      `status ${duplicado.status}`,
    );

    const assinado = await req(`/api/prontuario/${registroId}/assinar`, {
      method: "POST",
      json: { relatorio },
    });
    conferir(
      assinado.status === 200 && !!assinado.corpo?.assinadoEm,
      "Registro assinado",
      `CRM ${assinado.corpo?.assinadoPor ?? "?"}`,
    );

    const semMotivo = await req(`/api/prontuario/${registroId}/assinar`, {
      method: "POST",
      json: { relatorio: { ...relatorio, conduta: "Mudou." } },
    });
    conferir(
      semMotivo.status === 409 &&
        semMotivo.corpo?.codigo === "EXIGE_MOTIVO_RETIFICACAO",
      "Reassinar sem motivo é recusado",
      `status ${semMotivo.status}`,
    );

    const retificado = await req(`/api/prontuario/${registroId}/assinar`, {
      method: "POST",
      json: {
        relatorio: { ...relatorio, conduta: "Sintomáticos; retorno em 48h." },
        motivoRetificacao: "Correção do intervalo de retorno combinado.",
      },
    });
    conferir(
      retificado.status === 200 && retificado.corpo?.versao === 2,
      "Retificação cria versão 2",
      `versão ${retificado.corpo?.versao}`,
    );

    const original = await prisma.registroClinico.findUnique({
      where: { id: registroId },
      select: { status: true },
    });
    conferir(
      original?.status === "RETIFICADO",
      "Original preservado como RETIFICADO",
      original?.status ?? "sumiu",
    );

    const consultaConcluida = await prisma.consulta.findUnique({
      where: { id: consultaBId },
      select: { status: true },
    });
    conferir(
      consultaConcluida?.status === "CONCLUIDA",
      "Assinatura conclui a consulta",
      consultaConcluida?.status ?? "?",
    );
  }

  secao("11. Prontuário do paciente");
  {
    const pacienteId = (
      await prisma.consulta.findUniqueOrThrow({
        where: { id: consultaBId },
        select: { pacienteId: true },
      })
    ).pacienteId;

    const pagina = await req(`/pacientes/${pacienteId}`);
    conferir(pagina.status === 200, "Prontuário abre", `status ${pagina.status}`);
    conferir(
      pagina.texto.includes("Sintomáticos"),
      "Registro assinado aparece na evolução",
    );

    const trilha = await prisma.auditoria.count({
      where: { acao: { in: ["ASSINOU_REGISTRO", "RETIFICOU_REGISTRO"] } },
    });
    conferir(trilha >= 2, "Auditoria registrou assinatura e retificação", `${trilha}`);
  }

  // ------------------------------------------------------- lembrete (cron)
  secao("Lembrete automático (cron)");
  const consultaCId = consultaC.corpo?.consultaId as string;
  {
    // Puxa a consulta para dentro da janela do cron (ANTECEDENCIA_MIN = 20 min).
    await prisma.consulta.update({
      where: { id: consultaCId },
      data: { inicioEm: new Date(Date.now() + 15 * 60_000) },
    });

    const semSegredo = await req("/api/cron/lembretes", { method: "POST" });
    conferir(semSegredo.status === 401, "Cron sem segredo devolve 401", `status ${semSegredo.status}`);

    const segredoErrado = await req("/api/cron/lembretes", {
      method: "POST",
      headers: { authorization: "Bearer segredo-errado" },
    });
    conferir(segredoErrado.status === 401, "Cron com segredo errado devolve 401");

    const auth = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const rodada = await req("/api/cron/lembretes", { method: "POST", headers: auth });
    conferir(
      rodada.status === 200 && rodada.corpo?.enviados >= 1,
      "Cron envia o lembrete",
      `enviados ${rodada.corpo?.enviados}, falhas ${rodada.corpo?.falhas}`,
    );

    const m = await esperarEmail(paciente.email, "hoje");
    if (conferir(!!m, "Lembrete chega")) {
      const corpo = await corpoDe(m!.ID);
      conferir(
        corpo.includes(`/sala/${consultaCId}`),
        "Lembrete traz o link da sala da aplicação",
      );
      conferir(
        !corpo.includes("daily.co"),
        "Lembrete NÃO expõe URL da Daily",
        "seria credencial encaminhável",
      );
    }

    const segunda = await req("/api/cron/lembretes", { method: "POST", headers: auth });
    conferir(
      segunda.corpo?.enviados === 0,
      "Segunda rodada não reenvia",
      `enviados ${segunda.corpo?.enviados}`,
    );
  }

  // --------------------------------------------------------------- passo 5c
  secao("5c. Encaixe manual da médica");
  {
    const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" });
    const dataManual = ymd(new Date(Date.now() + 45 * 86_400_000));
    const inicioEm = `${dataManual}T21:00`;
    const emailManual = "encaixe.roteiro@teste.local";

    const criar = await req("/api/consultas/manual", {
      method: "POST",
      json: {
        email: emailManual,
        nome: "Paciente Encaixe do Roteiro",
        telefone: "67999993333",
        inicioEm,
        duracaoMin: 30,
        modalidade: "PRESENCIAL",
        motivo: "Roteiro: encaixe",
        pagamentoNota: "dinheiro",
        avisarPaciente: false,
      },
    });
    const cid = criar.corpo?.consultaId as string;
    conferir(criar.status === 201 && !!cid, "Encaixe manual cria a consulta", `status ${criar.status}`);

    const c = await prisma.consulta.findUniqueOrThrow({
      where: { id: cid },
      select: {
        status: true,
        statusPagamento: true,
        pagamentoNota: true,
        paciente: { select: { usuario: { select: { email: true } } } },
      },
    });
    conferir(
      c.status === "CONFIRMADA" && c.statusPagamento === "ISENTO",
      "Encaixe nasce CONFIRMADA / ISENTA",
      `${c.status} / ${c.statusPagamento}`,
    );
    conferir(c.pagamentoNota === "dinheiro", "Nota de pagamento gravada", c.pagamentoNota ?? "");
    conferir(c.paciente.usuario.email === emailManual, "Paciente novo criado pelo e-mail");

    // Horário livre: mesmo instante de novo = choque, recusado.
    const choque = await req("/api/consultas/manual", {
      method: "POST",
      json: { email: "outro.encaixe@teste.local", nome: "Outro", inicioEm, duracaoMin: 30, modalidade: "PRESENCIAL", avisarPaciente: false },
    });
    conferir(
      choque.status === 409 && choque.corpo?.codigo === "HORARIO_OCUPADO",
      "Choque de horário é recusado (409)",
      `status ${choque.status}`,
    );

    // Paciente novo sem nome é recusado.
    const semNome = await req("/api/consultas/manual", {
      method: "POST",
      json: { email: "sem.nome.encaixe@teste.local", inicioEm: `${dataManual}T22:00`, duracaoMin: 30, modalidade: "TELECONSULTA", avisarPaciente: false },
    });
    conferir(
      semNome.status === 400 && semNome.corpo?.codigo === "NOME_OBRIGATORIO",
      "Paciente novo sem nome é recusado (400)",
      `status ${semNome.status}`,
    );

    // Só médica: sem sessão, a rota recusa.
    const semSessao = await fetch(`${BASE}/api/consultas/manual`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.z", nome: "X", inicioEm: `${dataManual}T23:00`, duracaoMin: 30, modalidade: "TELECONSULTA" }),
      redirect: "manual",
    });
    conferir(semSessao.status === 401, "Encaixe manual exige sessão de médica (401 sem sessão)", `status ${semSessao.status}`);

    // ---- nota de sessão da médica (autosave na sala) ----
    const notaTexto = "PA 120x80, orientado repouso 48h. #teste-nota";
    const putNota = await req(`/api/consultas/${cid}/nota-sessao`, { method: "PUT", json: { nota: notaTexto } });
    conferir(putNota.status === 200, "Nota de sessão: PUT salva (200)", `status ${putNota.status}`);
    const getNota = await req(`/api/consultas/${cid}/nota-sessao`);
    conferir(getNota.corpo?.nota === notaTexto, "Nota de sessão: GET devolve o texto salvo");
    const cNota = await prisma.consulta.findUniqueOrThrow({ where: { id: cid }, select: { notaSessaoMedica: true } });
    conferir(cNota.notaSessaoMedica === notaTexto, "Nota de sessão persistida no banco");
    const putVazio = await req(`/api/consultas/${cid}/nota-sessao`, { method: "PUT", json: { nota: "   " } });
    const cVazio = await prisma.consulta.findUniqueOrThrow({ where: { id: cid }, select: { notaSessaoMedica: true } });
    conferir(putVazio.status === 200 && cVazio.notaSessaoMedica === null, "Nota de sessão: texto vazio grava NULL");

    await prisma.consulta.delete({ where: { id: cid } }).catch(() => {});

    // ---- encaixe COBRANDO via Pix (só com pagamento ligado) ----
    if (pagamentoLigado) {
      const criarPix = await req("/api/consultas/manual", {
        method: "POST",
        json: {
          email: "encaixe.pix.roteiro@teste.local",
          nome: "Paciente Pix Encaixe",
          inicioEm: `${dataManual}T22:00`,
          duracaoMin: 30,
          modalidade: "TELECONSULTA",
          cobranca: "pix",
          valorCent: 15000,
          cpf: "52998224725",
          avisarPaciente: false,
        },
      });
      const pixCid = criarPix.corpo?.consultaId as string;
      conferir(
        criarPix.status === 201 && !!criarPix.corpo?.pix?.copiaCola && criarPix.corpo?.valorCent === 15000,
        "Encaixe manual cobra via Pix (devolve copia-e-cola)",
        `status ${criarPix.status}`,
      );
      conferir(
        !!criarPix.corpo?.pix?.linkPagamento,
        "Encaixe-Pix devolve link de pagamento (invoiceUrl)",
        `link ${criarPix.corpo?.pix?.linkPagamento ?? "ausente"}`,
      );
      const cpix = await prisma.consulta.findUniqueOrThrow({
        where: { id: pixCid },
        select: { status: true, statusPagamento: true, pagamento: { select: { status: true, valorCent: true } } },
      });
      conferir(
        cpix.status === "CONFIRMADA" && cpix.statusPagamento === "PENDENTE" && cpix.pagamento?.valorCent === 15000,
        "Encaixe-Pix nasce CONFIRMADA + PENDENTE com o valor cobrado",
        `${cpix.status} / ${cpix.statusPagamento} / ${cpix.pagamento?.valorCent}`,
      );

      // Pagar (fake) confirma o pagamento; a consulta já era CONFIRMADA.
      const pg = await pagar(pixCid);
      conferir(pg.status === 200, "Pagamento do encaixe-Pix confirma", `status ${pg.status}`);
      const cpix2 = await prisma.consulta.findUniqueOrThrow({ where: { id: pixCid }, select: { statusPagamento: true } });
      conferir(cpix2.statusPagamento === "PAGO", "Após pagar, o encaixe fica PAGO");

      await prisma.consulta.delete({ where: { id: pixCid } }).catch(() => {});
    }
  }

  // --------------------------------------------------------------- passo 5d
  // Consulta presa em EM_ANDAMENTO: a médica sai sem assinar. O estado precisa
  // convergir para CONCLUIDA — na hora (rota /encerrar) e pelo cron (abandonadas).
  secao("5d. Encerramento de consulta (EM_ANDAMENTO)");
  {
    const medica = await prisma.usuario.findFirstOrThrow({ where: { papel: "MEDICA" }, select: { id: true } });
    const pacienteId = (
      await prisma.consulta.findUniqueOrThrow({
        where: { id: consultaB.corpo?.consultaId },
        select: { pacienteId: true },
      })
    ).pacienteId;
    const emAndamento = (inicioEm: Date) =>
      prisma.consulta.create({
        data: {
          pacienteId,
          medicaId: medica.id,
          inicioEm,
          duracaoMin: 30,
          modalidade: "TELECONSULTA",
          status: "EM_ANDAMENTO",
          iniciadaEm: inicioEm,
        },
        select: { id: true },
      });

    // ---- Parte 2: a rota /encerrar conclui na hora e é idempotente ----
    const cEnd = await emAndamento(new Date(Date.now() - 10 * 60_000));
    const enc1 = await req(`/api/consultas/${cEnd.id}/encerrar`, { method: "POST" });
    conferir(enc1.status === 200 && enc1.corpo?.encerrada === true, "Encerrar conclui a consulta EM_ANDAMENTO", `status ${enc1.status}`);
    const dep = await prisma.consulta.findUniqueOrThrow({ where: { id: cEnd.id }, select: { status: true, encerradaEm: true } });
    conferir(dep.status === "CONCLUIDA" && dep.encerradaEm !== null, "Fica CONCLUIDA com encerradaEm");
    const enc2 = await req(`/api/consultas/${cEnd.id}/encerrar`, { method: "POST" });
    conferir(enc2.status === 200 && enc2.corpo?.encerrada === false, "Segunda chamada é idempotente (encerrada:false)", JSON.stringify(enc2.corpo));
    const trilha = await prisma.auditoria.count({ where: { acao: "ENCERROU_CONSULTA", recursoId: cEnd.id } });
    conferir(trilha === 1, "Auditoria registra o encerramento UMA vez", `${trilha}`);

    // ---- Parte 1: o cron encerra a consulta abandonada vencida ----
    const cAband = await emAndamento(new Date(Date.now() - 3 * 3600_000)); // 3h atrás → vencida
    const cRecente = await emAndamento(new Date(Date.now() + 5 * 60_000)); // futura → ainda na janela
    const auth = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const rodada = await req("/api/cron/lembretes", { method: "POST", headers: auth });
    conferir(
      rodada.status === 200 && (rodada.corpo?.encerradas ?? 0) >= 1,
      "Cron encerra consulta abandonada vencida",
      `encerradas ${rodada.corpo?.encerradas}`,
    );
    const depAband = await prisma.consulta.findUniqueOrThrow({ where: { id: cAband.id }, select: { status: true, encerradaEm: true } });
    conferir(depAband.status === "CONCLUIDA" && depAband.encerradaEm !== null, "Abandonada vira CONCLUIDA com encerradaEm");
    const depRecente = await prisma.consulta.findUniqueOrThrow({ where: { id: cRecente.id }, select: { status: true } });
    conferir(depRecente.status === "EM_ANDAMENTO", "EM_ANDAMENTO dentro da janela NÃO é encerrada");

    for (const id of [cEnd.id, cAband.id, cRecente.id]) await prisma.consulta.delete({ where: { id } }).catch(() => {});
  }

  // ------------------------------------------------ expiração de reserva (cron)
  // Só faz sentido com pagamento ligado — sem Pix não existe AGUARDANDO_PAGAMENTO.
  if (pagamentoLigado) {
    secao("Expiração de reserva não paga (cron libera o slot)");
    // E-mail próprio: a cota é 3 agendamentos por e-mail em 10 min, e o paciente
    // principal já gastou as dele em A/B/C.
    const emailExp = "expiracao.roteiro@teste.local";
    async function agendarExp(inicioEm: string, motivo: string) {
      return req("/api/consultas", {
        method: "POST",
        json: {
          nome: "Paciente Expiração do Roteiro",
          email: emailExp,
          telefone: "67999991111",
          inicioEm,
          modalidade: "TELECONSULTA",
          duracaoMin: 30,
          motivo,
          aceitouTermos: true,
        },
      });
    }

    const nova = await agendarExp(vagas[3]!, "Roteiro: expiração");
    conferir(nova.status === 201 && !!nova.corpo?.pix, "Reserva de teste criada (não paga)");
    const novaId = nova.corpo?.consultaId as string;

    // Enquanto a reserva vale, o horário está ocupado.
    const ocupado = await agendarExp(vagas[3]!, "Roteiro: ainda ocupado");
    conferir(
      ocupado.status === 409,
      "Horário fica ocupado enquanto a reserva vale",
      `status ${ocupado.status}`,
    );

    // Força o vencimento da cobrança e roda o cron.
    await prisma.pagamento.update({
      where: { consultaId: novaId },
      data: { expiraEm: new Date(Date.now() - 60_000) },
    });
    const auth = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const rodada = await req("/api/cron/lembretes", { method: "POST", headers: auth });
    conferir(
      rodada.status === 200 && (rodada.corpo?.expiradas ?? 0) >= 1,
      "Cron expira e remove a reserva vencida",
      `expiradas ${rodada.corpo?.expiradas}`,
    );

    const sumiu = await prisma.consulta.findUnique({ where: { id: novaId }, select: { id: true } });
    conferir(sumiu === null, "Reserva não paga é removida (nada de dado clínico órfão)");

    // O horário volta à grade e pode ser reagendado.
    const relivre = await agendarExp(vagas[3]!, "Roteiro: horário liberado");
    conferir(
      relivre.status === 201 && !!relivre.corpo?.pix,
      "Horário liberado pode ser reagendado",
      `status ${relivre.status}`,
    );
    // Limpa a reserva de teste para não sujar contagens seguintes.
    const relivreId = relivre.corpo?.consultaId as string | undefined;
    if (relivreId) {
      await prisma.pagamento.deleteMany({ where: { consultaId: relivreId } });
      await prisma.consulta.delete({ where: { id: relivreId } }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- passo 6
  secao("6. Bloqueio e cancelamento");
  {
    const consultaAId = consultaA.corpo?.consultaId as string;
    const alvo = await prisma.consulta.findUniqueOrThrow({
      where: { id: consultaAId },
      select: { inicioEm: true },
    });

    // Janela no fuso da médica, como a tela envia.
    const emCampoGrande = (d: Date) =>
      new Date(d.getTime() - 4 * 3600_000).toISOString().slice(0, 16);
    const inicio = emCampoGrande(new Date(alvo.inicioEm.getTime() - 30 * 60_000));
    const fim = emCampoGrande(new Date(alvo.inicioEm.getTime() + 60 * 60_000));

    const semConfirmar = await req("/api/agenda/bloqueios", {
      method: "POST",
      json: { inicio, fim, motivo: "Roteiro: congresso", cancelarConflitos: false },
    });
    conferir(
      semConfirmar.status === 409 &&
        semConfirmar.corpo?.codigo === "CONFLITO_CONSULTAS",
      "Bloqueio com conflito não cancela sozinho",
      `status ${semConfirmar.status}`,
    );
    conferir(
      (semConfirmar.corpo?.conflitos ?? []).some((c: any) =>
        c.paciente.includes("Fictício"),
      ),
      "Conflito lista o paciente pelo nome antes de confirmar",
    );

    const confirmado = await req("/api/agenda/bloqueios", {
      method: "POST",
      json: { inicio, fim, motivo: "Roteiro: congresso", cancelarConflitos: true },
    });
    conferir(
      confirmado.status === 201 && confirmado.corpo?.canceladas >= 1,
      "Bloqueio confirmado cancela a consulta",
      `${confirmado.corpo?.canceladas} cancelada(s)`,
    );
    conferir(
      confirmado.corpo?.avisados >= 1,
      "Paciente avisado por e-mail",
      `avisados ${confirmado.corpo?.avisados}`,
    );

    const m = await esperarEmail(paciente.email, "cancelada");
    if (conferir(!!m, "E-mail de cancelamento chega")) {
      const corpo = await corpoDe(m!.ID);
      conferir(
        !corpo.includes("congresso"),
        "Motivo do bloqueio NÃO vaza para o paciente",
        "é anotação interna da agenda",
      );
    }

    const status = await prisma.consulta.findUniqueOrThrow({
      where: { id: consultaAId },
      select: { status: true },
    });
    conferir(status.status === "CANCELADA", "Consulta marcada como CANCELADA");
  }

  // ------------------------------------------------------------- passos 7-9
  secao("7 a 9. Sala, consentimento e IA");
  foraDeAlcance("Passo 7 — sala de vídeo", "exige DAILY_API_KEY real e WebRTC no navegador");
  foraDeAlcance("Passo 8 — recusa de consentimento na sala", "depende da sala aberta");
  foraDeAlcance(
    "Passo 9 — transcrição e nota por IA",
    "exige OPENAI_API_KEY e ANTHROPIC_API_KEY reais, e cobra por chamada",
  );

  // -------------------------------------------------------------------- fim
  console.log("\n" + "─".repeat(64));
  console.log(
    falhas === 0
      ? `\x1b[32m${passos} verificações, todas passaram.\x1b[0m`
      : `\x1b[31m${passos} verificações, ${falhas} falharam.\x1b[0m`,
  );
  if (pendencias.length) {
    console.log(`\n${pendencias.length} passos fora de alcance automatizado:`);
    for (const p of pendencias) console.log(`  • ${p}`);
  }
  console.log(`\nE-mails do roteiro: ${MAILPIT}\n`);

  if (falhas > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("\nRoteiro interrompido:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
