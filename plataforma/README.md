# Plataforma Clínica — Dra. Laís Caroline Hahmed

Plataforma privada de agendamento e teleconsulta para uma única profissional, com
assistente de anotação clínica por IA.

> **Escopo desta entrega:** estrutura de diretórios, configuração de dependências e
> variáveis de ambiente, e o código dos componentes centrais (schema do banco,
> integração Claude, transcrição, sala de teleconsulta, modal de revisão).

---

## 1. Arquitetura

| Camada | Escolha | Por quê |
|---|---|---|
| Framework | **Next.js 15** (App Router) + TypeScript | Front e back no mesmo projeto; as chaves de API ficam em Server Actions e Route Handlers, nunca no navegador |
| Estilo | **Tailwind CSS 4** | Paleta herdada do site institucional |
| Banco | **PostgreSQL + Prisma** | Prontuário exige integridade referencial e guarda de 20 anos |
| Autenticação | **Auth.js (NextAuth) v5** | Magic link para paciente, senha + 2FA para a médica |
| Vídeo | **Daily.co** (WebRTC) | Melhor DX, salas efêmeras por consulta, controle de gravação no cliente |
| Transcrição | **Amazon Transcribe** (`pt-BR`) | O áudio já está no nosso S3 em `sa-east-1` e nunca sai do Brasil — sem transferência internacional do dado mais cru do sistema |
| Relatório clínico | **Anthropic Claude Opus 5** | Saída estruturada garantida por schema, não por parsing de texto |
| Armazenamento | **AWS S3** (`sa-east-1`) | Já existe conta AWS; áudio com ciclo de vida de exclusão automática |

### Fluxo do assistente de anotação

```
médica clica "Iniciar"
        │
        ▼
 consentimento do paciente ──► negado ──► consulta segue SEM gravação
        │ aceito                              (fluxo normal, sem IA)
        ▼
 MediaRecorder captura o áudio da sessão em background
 (indicador visível para AMBOS os participantes — exigência ética)
        │
        ▼
 médica clica "Encerrar consulta"
        │
        ▼
 upload do áudio ──► S3 (privado, KMS)
        │
        ▼
 Whisper transcreve (pt-BR) ──► ÁUDIO APAGADO DO S3 imediatamente
        │
        ▼
 Claude Opus 5 estrutura a transcrição  ──►  QP / HMA / Antecedentes /
 (output_config.format — schema garantido)     Hipóteses / Conduta
        │
        ▼
 modal de revisão editável ──► médica corrige ──► assina ──► prontuário
                                                   (versão imutável)
```

**Nenhum relatório entra no prontuário sem revisão e assinatura da médica.** O
registro nasce com `status: RASCUNHO` e só vira `ASSINADO` por ação explícita dela.

---

## 2. Estrutura de diretórios

```
plataforma/
├── prisma/
│   └── schema.prisma                    modelo de dados (prontuário, consentimento, auditoria)
├── src/
│   ├── app/
│   │   ├── (publico)/
│   │   │   ├── page.tsx                 perfil profissional
│   │   │   └── agendar/page.tsx         formulário de agendamento
│   │   ├── (paciente)/
│   │   │   ├── minhas-consultas/page.tsx
│   │   │   └── sala/[consultaId]/page.tsx
│   │   ├── (medica)/
│   │   │   ├── agenda/page.tsx          gestão de agenda
│   │   │   ├── pacientes/[id]/page.tsx  prontuário do paciente
│   │   │   └── atendimento/[consultaId]/page.tsx
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── consultas/
│   │       │   ├── route.ts             POST cria agendamento
│   │       │   └── [id]/
│   │       │       ├── sala/route.ts    POST gera token Daily
│   │       │       ├── audio/route.ts   POST upload do áudio (URL pré-assinada)
│   │       │       └── notas/route.ts   POST transcreve + estrutura (o núcleo)
│   │       └── prontuario/
│   │           └── [id]/assinar/route.ts
│   ├── components/
│   │   ├── sala/
│   │   │   ├── SalaTeleconsulta.tsx     UI da videochamada
│   │   │   ├── useGravadorConsulta.ts   hook Web Audio / MediaRecorder
│   │   │   ├── ConsentimentoGravacao.tsx
│   │   │   ├── IndicadorEscuta.tsx      selo "assistente registrando"
│   │   │   └── ModalRevisaoNotas.tsx    revisão editável + assinatura
│   │   ├── agenda/
│   │   └── ui/                          botões, campos, modal (base)
│   ├── lib/
│   │   ├── env.ts                       validação das variáveis de ambiente
│   │   ├── prisma.ts
│   │   ├── auth.ts
│   │   ├── s3.ts
│   │   ├── daily.ts                     criação de sala e token
│   │   └── ia/
│   │       ├── anthropic.ts             cliente Claude
│   │       ├── notas-clinicas.ts        schema + prompt + geração  ◄── núcleo
│   │       └── transcricao.ts           Whisper
│   └── styles/globals.css
├── .env.example
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## 3. Instalação

```bash
cd plataforma
npm install
```

### Dependências principais

```bash
# framework
npm i next@latest react react-dom

# banco e auth
npm i @prisma/client next-auth@beta @auth/prisma-adapter
npm i -D prisma

# IA
npm i @anthropic-ai/sdk openai zod

# vídeo
npm i @daily-co/daily-js @daily-co/daily-react jotai

# storage
npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# estilo e utilidades
npm i tailwindcss @tailwindcss/postcss date-fns
npm i -D typescript @types/node @types/react
```

### Banco

```bash
npx prisma migrate dev --name init
npx prisma generate
```

---

## 4. Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha. O arquivo `src/lib/env.ts`
valida tudo na inicialização — **a aplicação não sobe com variável faltando**,
o que evita descobrir a chave ausente no meio de uma consulta.

| Variável | Onde obter | Observação |
|---|---|---|
| `DATABASE_URL` | Seu Postgres (RDS, Neon, Supabase) | Exija SSL |
| `AUTH_SECRET` | `npx auth secret` | |
| `AUTH_URL` | URL da aplicação | |
| `EMAIL_SERVER` | SMTP próprio ou Resend/SES/Postmark | Magic link do paciente; formato `smtp://usuario:senha@host:587` |
| `EMAIL_FROM` | Remetente verificado no domínio | ex.: `contato@dralaishahmed.com.br` |
| `ANTHROPIC_API_KEY` | console.anthropic.com | **Peça retenção zero (ZDR) à Anthropic antes de produção** |
| `DAILY_API_KEY` | dashboard.daily.co | Plano com HIPAA/BAA se disponível |
| `DAILY_DOMAIN` | dashboard.daily.co | ex.: `dralais.daily.co` |
| `AWS_REGION` | `sa-east-1` | São Paulo — dado de saúde no Brasil |
| `AWS_S3_BUCKET_AUDIO` | Bucket privado dedicado | Ciclo de vida: expirar em 1 dia |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM com permissão mínima | Só `PutObject`/`GetObject`/`DeleteObject` nesse bucket |
| `CRM_MEDICA` | `CRM-MS 16563` | Aparece nos documentos gerados |

> ⚠️ **Antes de atender paciente real**, dois contratos precisam existir:
> DPA com a Anthropic (com retenção zero) e contrato de operador com a Daily.
> Sem isso, a transferência internacional de dado de saúde não tem base legal
> (LGPD art. 33).
>
> Eram três. A migração do Whisper para a Amazon Transcribe eliminou a OpenAI:
> o áudio agora é transcrito dentro de `sa-east-1` e nunca sai do país. O que
> ainda atravessa a fronteira é o **texto** da transcrição, indo para a
> Anthropic — menos cru que a voz do paciente, mas ainda dado de saúde.

---

## 5. Segurança e LGPD embutidas no código

| Medida | Onde |
|---|---|
| Gravação bloqueada sem consentimento registrado | `ConsentimentoGravacao.tsx` + `Consentimento` no schema |
| Indicador de escuta visível aos dois participantes | `IndicadorEscuta.tsx` |
| Áudio apagado logo após transcrever | `api/consultas/[id]/notas/route.ts` |
| Áudio transcrito **dentro do Brasil** (`sa-east-1`) | `lib/ia/transcricao.ts` |
| JSON da transcrição apagado do S3 após leitura | `lib/ia/transcricao.ts` |
| Bucket com ciclo de vida de 1 dia (rede de segurança) | configurar no S3 |
| Prontuário imutável após assinatura | `RegistroClinico.status` + `assinadoEm` |
| Trilha de auditoria de todo acesso a prontuário | model `Auditoria` |
| Guarda de 20 anos | nenhuma rota expõe `DELETE` de prontuário |
| Nota de IA marcada como tal | `RegistroClinico.origemIA` |

---

## 6. Primeira execução

```bash
cd plataforma
npm install

cp .env.example .env           # preencha antes de seguir
docker compose up -d --wait    # Postgres de desenvolvimento (porta 5432)
npx prisma migrate dev --name init
npm run db:seed                # cria a médica + disponibilidade de exemplo
npm run medica:senha           # define senha e mostra o segredo TOTP (uma vez)

npm run dev
```

> **`.env`, não `.env.local`.** O Prisma CLI lê apenas `.env`; o Next.js lê os
> dois. Um arquivo só evita `DATABASE_URL` divergente entre o app e as migrations
> — que se manifesta como migration aplicada no banco errado.

O `docker-compose.yml` sobe um Postgres **de desenvolvimento**: sem TLS e com
senha trivial. Produção pede banco gerenciado com `sslmode=require` e backup —
veja a seção 5 e a lista de pendências.

`npm run medica:senha` pede a senha no terminal com eco desligado e exibe a
chave do autenticador **uma única vez**. Confirme que o aplicativo gera código
antes de fechar o terminal — sem isso o acesso profissional não abre.

### Roteiro de teste

```bash
docker compose up -d --wait   # Postgres + Mailpit
npm run dev                   # noutro terminal
npm run roteiro
```

`npm run roteiro` executa automaticamente os passos 1 a 6, 10 e 11 da tabela
abaixo, mais os três e-mails e o cron de lembretes — 44 verificações, pela HTTP,
com o login real da médica (senha + TOTP). Os e-mails caem no Mailpit
(**http://localhost:8025**) e não saem da máquina.

Ele **se recusa a rodar** se `DATABASE_URL` ou `EMAIL_SERVER` não apontarem para
`localhost`: o roteiro cria paciente fictício, cancela consulta e dispara e-mail.

O passo 7 tem roteiro próprio, porque depende da conta real da Daily:

```bash
npm run teste:sala -- <consultaId>
```

Ele prova tudo que antecede o vídeo — a sala nasce **privada, com no máximo 2
participantes e `enable_recording: ""`**, o token é individual (`ud`/`o`/`er`) e
a janela de acesso devolve 425 antes da hora e 410 depois. O vídeo abrindo de
fato ainda exige navegador com câmera.

Os passos 8 e 9 continuam manuais: dependem da sala aberta e das chaves da
OpenAI e da Anthropic.


| # | Caminho | O que verificar |
|---|---|---|
| 1 | `/` → `/agendar` | Grade carrega, horários no fuso do navegador |
| 2 | Agendar como paciente | Cria consulta; repetir o mesmo horário deve dar 409 |
| 3 | `/entrar` (aba profissional) | Senha + TOTP |
| 4 | `/agenda` | Consulta aparece no dia certo |
| 5 | `/agenda/disponibilidade` | Contagem de encaixes bate; sobreposição é recusada |
| 6 | `/agenda/bloqueios` | Bloqueio com conflito lista os pacientes antes de confirmar |
| 7 | `/atendimento/[id]` → entrar | Vídeo abre; consentimento aparece para o paciente |
| 8 | Recusar consentimento | Consulta segue; gravação não inicia |
| 9 | Aceitar e encerrar | Transcrição → rascunho → modal de revisão |
| 10 | Assinar | Vira ASSINADO; nova tentativa exige motivo de retificação |
| 11 | `/pacientes/[id]` | Registro na evolução, com selo de origem IA |

> Passos 9 e 10 consomem API da OpenAI e da Anthropic. Para testar o resto sem
> custo, recuse o consentimento no passo 8 e use
> `/atendimento/[id]/registro` para redigir manualmente.

---

## 7. Estado de implementação

**Pronto:** schema, autenticação (magic link + senha/TOTP), agendamento público,
agenda da médica, disponibilidade, bloqueios, sala de teleconsulta, consentimento,
gravação, transcrição, geração de notas por IA, revisão e assinatura, retificação,
prontuário, auditoria, **checkout de pagamento (Pix, scaffold)**.

**Pagamento da consulta — Pix-first, provedor abstraído (29/08/2026):** o
agendamento agora nasce `AGUARDANDO_PAGAMENTO` e só vira `CONFIRMADA` quando o
Pix é pago; o e-mail de confirmação saiu do `POST /api/consultas` e passou para
o webhook. Provedor atrás da interface `ProvedorPagamento`
(`src/lib/pagamento/`), com adaptador `fake` de dev (Pix e QR falsos
determinísticos + rota `POST /api/pagamentos/fake/pagar` que simula o webhook,
como o Mailpit faz com e-mail). Plugar Asaas/Mercado Pago depois = escrever UM
arquivo adaptador + chaves no `.env` (`PAGAMENTO_PROVEDOR`), sem tocar em
schema/rotas/front/cron. Janela de reserva de 20 min; o cron
(`api/cron/lembretes`) varre reservas vencidas e as REMOVE — apagar a consulta
não-paga é o que libera o slot, já que o lock é a constraint `@@unique` que não
some com `CANCELADA` (a consulta nunca-paga não tem dado clínico). Preço por
modalidade em `Usuario.valorTeleconsultaCent`/`valorPresencialCent` (centavos,
placeholder R$300), editável em `/configuracoes`. Fluxo coberto pelo
`npm run roteiro` (70 verificações: cria Pix pendente → segura o slot → paga →
CONFIRMADA/PAGO + e-mail → idempotência do webhook → auditoria → expiração
libera o slot). **Provedor Asaas escrito (30/08/2026):** `src/lib/pagamento/asaas.ts`
implementa a interface contra a API v3 do Asaas (customer com cpfCnpj → cobrança
Pix → `pixQrCode`; webhook autenticado pelo header `asaas-access-token`; refund).
`case "ASAAS"` no `index.ts`; envs `ASAAS_API_KEY`/`ASAAS_AMBIENTE`/`ASAAS_WEBHOOK_TOKEN`
no `env.ts` (com fail-fast se ASAAS selecionado sem chaves). Decisão: **Asaas exige
CPF do PAGADOR** → o formulário coleta CPF (campo `exigeCpf` na interface do provedor;
`lib/cpf.ts` valida) só quando `PAGAMENTO_ATIVO` E o provedor pede; a conta Asaas é
PJ (CNPJ da médica) para NFS-e. **Falta:** criar a conta Asaas (sandbox e depois
produção — ação da Laís/Igor, não posso criar conta), testar E2E no sandbox com a
chave, apontar o webhook no painel, e NFS-e (Fase B).

**Dashboard de disponibilidade (30/08/2026):** a tela `/agenda/disponibilidade`
virou um painel visual (padrão dos apps de agenda), reaproveitando as rotas e a
lógica de encaixes/conflito já existentes. Dois níveis: (1) **horário semanal**
recorrente — grade de dias com liga/desliga, cada janela mostrando quantos
encaixes gera; (2) **calendário** por data, onde a médica clica um dia para dar
**folga** (bloqueio de dia inteiro — reusa o fluxo de conflito/cancelamento/e-mail
dos bloqueios, motivo "Folga") ou abrir um **horário especial** que substitui o
padrão só naquela data (sábado extra, plantão). Modelo novo `DisponibilidadeData`
(migration `disponibilidade_por_data`); `lib/agenda.ts` passou a honrar o especial
(substitui a janela recorrente do dia). Rotas: GET de disponibilidade agora devolve
`{janelas, datas, folgas}`; POST/DELETE `/api/agenda/disponibilidade/data` para o
especial; a folga vai pela rota de bloqueios. Coberto pelo `npm run roteiro` (seção
5b: especial abre vaga em dia de folga, folga zera as vagas do dia, ambos revertem).

**Revisão + deploy do pagamento e do dashboard (30/08/2026, NO AR):** 4 revisores
(disponibilidade/fuso, componente, segurança/prod-safety, pagamento) acharam 8
problemas reais, todos corrigidos antes do deploy: (1) pagamento agora tem flag
`PAGAMENTO_ATIVO` (DESLIGADO por padrão) + fail-closed no `env.ts` (o app se recusa
a subir com provedor FAKE em produção) — o agendamento em prod confirma direto (como
antes), o Pix fica dormente até plugar um provedor real; (2) o horário especial
substitui só a MESMA modalidade (não sumia mais vaga presencial); (3) as transições
por-data viraram UMA rota transacional (`POST /api/agenda/dia`) — o cliente não
orquestra mais vários fetches, então um erro no meio não deixa dia de folga
agendável; (4) confirmação de pagamento agora é atômica (reserva + consulta +
auditoria numa transação); (5,6) o cron de expiração guarda `pagamento.status != PAGO`
(fecha corrida com o webhook e libera slot de cobrança FALHOU); (7) `fake/pagar`
travado também por `NODE_ENV=production`; (8) dashboard com `try/finally`, "hoje" no
fuso da clínica, e polling que olha `pagamento.status`. Verificado com `npm run
roteiro` nos DOIS modos (pagamento off = 70 verificações, on = 83). Deploy: migrations
`pagamento_consulta` + `disponibilidade_por_data` aplicadas em prod (backup antes),
build + restart. Servidor em `Etc/UTC` (evita a armadilha de DST na geração de grade).

**Navegação, aviso de antecedência e encaixe manual (30/08/2026, NO AR):** barra
de navegação do painel (`NavMedica`, layout de `(medica)`) com a página ativa
destacada e "Sair" — some na sala de vídeo; "Sair" também para o paciente
(`NavPaciente`). A tela de disponibilidade agora tem link na barra (antes era
órfã). O editor de horário especial avisa quando as vagas caem dentro da
antecedência mínima de 2h (não apareceriam para o paciente). Novo **encaixe
manual da médica**: botão "Nova consulta" na agenda → `POST /api/consultas/manual`
(só médica) agenda um paciente direto, em horário livre (ignora a regra de 2h e a
grade), nasce CONFIRMADA e ISENTA com uma nota de como foi pago
(`Consulta.pagamentoNota`, migration `consulta_encaixe_manual`); acha o paciente
por e-mail ou cria; a única trava é não chocar com outra consulta. **Cobrar via
Pix no encaixe (31/08/2026):** com o pagamento ligado, o "Nova consulta" ganha a
opção de COBRAR um valor à escolha da médica via Pix — a consulta nasce
CONFIRMADA + statusPagamento PENDENTE (não AGUARDANDO_PAGAMENTO, então o cron não
a expira), gera o copia-e-cola + QR (pede o CPF do paciente) para a médica enviar,
e o webhook marca PAGO quando ele paga. Preço-base público fica em
`/configuracoes`; o encaixe é onde ela cobra valores avulsos (ou isento). Coberto
pelo roteiro (5c). **Webhook Asaas provado E2E pela rede (túnel cloudflared →
sandbox → PAGO automático) em 31/08/2026, e a feature + o adaptador Asaas estão
DEPLOYADOS em produção — porém INERTES: `PAGAMENTO_ATIVO` continua OFF no `.env`
de prod, então a opção "cobrar via Pix" não aparece e o fluxo público/isento
segue idêntico. Ligar o Pix em prod = passo de go-live (afeta também o funil
público).**

**Financeiro / DRE gerencial (31/08/2026, NO AR):** tela `/financeiro` (aba nova no
painel) com DRE mensal por regime de caixa — Receita (Pix + Dinheiro/encaixe, de
`Pagamento` PAGO) − Despesas por categoria = Resultado. Model `Despesa` + enum
`MetodoPagamento.DINHEIRO` (migration `financeiro_despesas`); o encaixe isento ganhou
"Valor recebido" que vira receita. Export CSV pro contador. `calcularDRE` em
`lib/financeiro-dados.ts` é a fonte única (tela + CSV). Passou por 3 revisores
(lógica/segurança/UX) antes de fechar; correções: inputs de dinheiro `type=text` com
parser BR (vírgula), CSV anti-formula-injection, validação de data, form full-width,
delete em 2 cliques, receita ignora CANCELADA/FALTOU. É gerencial, não a DRE fiscal
(essa é do contador).

**Base operacional + Sentry + Fase A (31/08/2026, NO AR):** (1) **Backup offsite** — o
`dralais-backup.sh` noturno agora sobe o dump pro S3 (`s3://dralais-audios-2026/backups/`,
provado restaurável); disco do EC2 crescido 8→16 GB + swap 4 GB. (2) **`/api/health`**
(checa o banco) para monitor de uptime. (3) **Sentry** — captura erro de servidor
(`instrumentation.ts` + `onRequestError`); o plugin de build `withSentryConfig` foi
REMOVIDO porque o build não fecha no EC2 de 1 GB — deploy passou a ser **buildar local
(cache do webpack off) + enviar o `.next`** (`tar --exclude=.next/cache | ssh`). (4)
**Mojibake** do `notas/route.ts` corrigido. (5) **Fase A dos documentos clínicos** —
notas manuais da médica na sala (`Consulta.notaSessaoMedica`, autosave), que reaparecem
como apoio no registro pós-consulta. **Fase B — atestado** (`Atestado`, enum `TipoAtestado`,
migration `atestado`): espelha a receita (rascunho→assinado→retificado, modelos prontos em
`lib/documentos/modelos-atestado.ts`, editor, via impressa A4 `window.print`, atalho "Gerar
atestado" na tela de registro). **Fase C — solicitação de exames** (`SolicitacaoExame`,
enum `CategoriaExame` SANGUE/IMAGEM/OUTROS, migration `solicitacao_exame`, NO AR
31/08/2026): mesmo padrão — a médica marca exames comuns (`lib/documentos/exames-comuns.ts`,
17 pré-cadastrados por categoria) e/ou digita os próprios, escreve indicação clínica e
assina; rascunho→assinado→retificado; via impressa A4 agrupada por categoria; atalho
"Solicitar exames" na barra Documentos da tela de registro (ao lado de atestado). Rotas
`/api/exames` (POST cria/reusa rascunho) + `/api/exames/[id]/assinar` (3 caminhos) + páginas
`/exames/[id]` e `/exames/[id]/imprimir`. Coberto pelo roteiro (5c). **Fase D — entrega por
link na área do paciente** (NO AR, sem migration): o paciente vê seus documentos assinados
em `/minhas-consultas` (chips por consulta) e abre `/documentos/[tipo]/[id]` — mesmo layout
A4 que a médica imprime, agora em componentes compartilhados (`@/components/documentos/{Receita,
Atestado,Exames}Impress*`, fonte única — as 3 páginas de impressão da médica foram refatoradas
p/ usá-los). Posse por `paciente.usuarioId === sessao.user.id` (id de outro → `notFound`, nunca
403); rascunho nunca servido; abertura audita `EXPORTOU_DADOS`. A médica dispara por e-mail:
botão "Enviar ao paciente" na tela do documento assinado → `POST /api/documentos/[tipo]/[id]/enviar`
(médica-only, rate-limit, só ASSINADO, audita EXPORTOU_DADOS) → `notificarDocumento` →
`enviarDocumentoDisponivel` (link `AUTH_URL/documentos/...`, rota com sessão, nunca URL pública).
Coberto pelo roteiro (5c/D). Documentos clínicos: **Fases A–D completas**.

**Integração CFM — Prescrição Eletrônica, Fase 1 (SIMULAÇÃO, DORMENTE atrás de
`CFM_ATIVO`, não deployada):** groundwork para assinar receita com validade legal
(ICP-Brasil) pela Prescrição Eletrônica do CFM — cobre branca e controlada. A lib
oficial do CFM é **frontend** (iframe + postMessage; a médica assina no iframe do
CFM), e **não está publicada no npm** hoje (é carregada em runtime de `CFM_SCRIPT_URL`).
Construído, ancorado na API real e testado (`npm run teste:cfm`): flags no `env.ts`
(`CFM_ATIVO`/`CFM_AMBIENTE`/`CFM_SCRIPT_URL` + credenciais opcionais, fail-safe só liga
SIMULAÇÃO sem credencial), `src/lib/cfm/*` (tipos, mapeamento Receita→CFM, token OAuth
cacheado), `GET /api/cfm/token-prescricao`, `POST /api/receita/[id]/emitir-cfm` (grava
`assinaturaProvedor=CFM`/`assinaturaRef`/`documentoUrl`, idempotente, auditado), e o
botão `BotaoEmitirCfm` na `/receita/[id]` (só quando `CFM_ATIVO`). **Com `CFM_ATIVO`
OFF (padrão) nada muda** — o fluxo IMPRESSA+imprimir segue único. Falta para ligar:
obter o bundle da lib do CFM, liberar a CSP para o domínio do CFM, e as credenciais
de homologação/produção (processo com o CFM). Atestado via Atesta CFM = próximo passo.

**Consulta presa em "Em andamento" — convergência (bug corrigido):** a consulta
entra em `EM_ANDAMENTO` quando a médica abre a sala, e a única saída limpa era
assinar o registro — então sair sem assinar (fechar a aba, "voltar à agenda",
voltar do navegador, cair a conexão) a deixava `EM_ANDAMENTO` para sempre. Duas
correções: (1, garante convergência) o cron (`api/cron/lembretes`) varre
`EM_ANDAMENTO` cuja janela (`inicioEm + duracaoMin + FOLGA`) passou e marca
`CONCLUIDA` + `encerradaEm` — `updateMany` idempotente, não regride quem assinou;
(2, caminho limpo) `POST /api/consultas/[id]/encerrar` (médica dona, idempotente,
auditado com `ENCERROU_CONSULTA`), chamado best-effort ao clicar "Encerrar
consulta" na sala. `FOLGA_ENCERRAMENTO_MIN=30` vive em `lib/agenda.ts`, usado pela
UI (`naoEncerrada`) e pelo cron para não divergirem. Marcar `CONCLUIDA` preserva o
aviso de "registro pendente" na agenda. Migration `encerrou_consulta_auditoria`.
Coberto pelo roteiro (5d).

**Funil de agendamento endurecido (28/08/2026):** revisão focada em conversão de
tráfego pago. Grade distingue erro-de-carga de ausência-de-vaga (não expulsa mais
quem tem vaga num 429/500); `enviar` sem trava de duplo-toque e sem botão preso;
tela de sucesso honesta no guard 202; auto-scroll ao passo 2 no mobile; horário
PRESENCIAL sempre no fuso da clínica. Backend: valida antes de debitar cota (typo
não bloqueia), limite por IP afrouxado para CGNAT + cota por e-mail, envio de
e-mail com timeout de 8s, `fuso` validado como zona IANA (não 500 mais), janela
de horários = horizonte de 60 dias. nginx `dralais_agendar` 6→20 r/m. Detalhes no
memory `projeto-dra-lais`.

**Falta antes de atender paciente real:**

- ☑ E-mail transacional — confirmação, lembrete com link da sala e aviso de
  cancelamento, cobertos por `npm run roteiro`. Falta só apontar o
  `EMAIL_SERVER` para o SMTP de produção (hoje aponta para o Mailpit local)
- ☐ Agendador que chame `POST /api/cron/lembretes` a cada 15 min em produção
  (cron do EC2 ou systemd timer), com `Authorization: Bearer $CRON_SECRET`
- ☐ **Retomar transcrição órfã.** O job da Transcribe é disparado pelo
  navegador da médica e acompanhado por ele. Se ela fechar a aba no meio, o job
  roda na AWS mas ninguém busca o resultado: o rascunho não é criado e — pior —
  o áudio não é apagado do S3. O `POST /api/consultas/[id]/notas` já é
  idempotente e retoma de onde parou, então basta o cron de lembretes varrer
  `Transcricao` com `jobNome` preenchido e `texto` vazio
- ☑ **Receita gerada por IA (Fase 1).** A IA rascunha a prescrição estruturada
  na mesma chamada do relatório; a médica revisa/edita/assina em `/receita/[id]`
  e imprime a via (branca). Controlado é detectado e sinalizado. **Fase 2
  pendente:** assinatura ICP-Brasil qualificada + dispensação de controlado via
  Memed/CFM (a médica já tem e-CPF; a receita estruturada alimenta o Memed).
  Falta preencher `ENDERECO_MEDICA` no `.env` de produção (endereço do receituário)
- ☐ DPA com Anthropic (retenção zero) e Daily — **bloqueante legal**
- ☐ `npm run vocabulario:aws` — registrar o vocabulário customizado da
  Transcribe (nomes de medicação e posologia). Sem ele a transcrição roda, só
  erra mais onde erro custa caro
- ☐ `proxy_read_timeout` no nginx: o pipeline é assíncrono e cada requisição é
  curta, mas confirme que não há proxy cortando antes de 60s
- ☐ Backup e política de retenção de 20 anos no banco
- ☐ Refatoração: unificar campos de `EditorRegistro` e `ModalRevisaoNotas`
- ☐ ESLint: `next lint` foi descontinuado no Next 15.5 e o projeto não tem
  config de ESLint — o build avisa e segue. Migrar para a CLI do ESLint 9
  (`eslint.config.mjs`)
- ☐ `prisma.config.ts`: a chave `package.json#prisma` sai no Prisma 7
