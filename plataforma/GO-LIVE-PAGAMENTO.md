# Go-live do pagamento (Pix) — checklist

Checklist para ligar o pagamento real na plataforma. Escrito para o **Asaas** (provedor
recomendado), mas o roteiro vale para qualquer provedor — só mudam os nomes das chaves.

**Princípio:** sandbox e produção são contas separadas. O go-live **não reescreve código** —
é trocar configuração, reapontar o webhook e fazer um teste com dinheiro real. Os dados do
sandbox **não** migram; produção começa vazia.

**Rede de segurança:** o `env.ts` tem um *fail-closed* — o app **não sobe** em produção se
`PAGAMENTO_ATIVO=true` mas o provedor ainda for `FAKE`. Não dá para ir "meio pra produção"
por engano.

---

## Fase 0 — Pré-requisitos (ANTES do dia)

### Código (Igor) — feito com antecedência, no sandbox
- [ ] Adaptador `src/lib/pagamento/asaas.ts` escrito, implementando `ProvedorPagamento`
- [ ] `case "ASAAS"` descomentado em `src/lib/pagamento/index.ts`
- [ ] Variáveis `ASAAS_*` adicionadas ao schema de `src/lib/env.ts`
- [ ] **Decisão do CPF resolvida** — o Asaas exige `cpfCnpj` do *pagador*: ou coletar CPF no
      formulário de agendamento, ou trocar para Mercado Pago (Pix sem CPF)
- [ ] Testado ponta a ponta no **sandbox** (cobrança nasce → webhook via túnel ngrok →
      consulta vira `CONFIRMADA` → e-mail sai). Roteiro no modo ON (`PAGAMENTO_ATIVO=true`)
      passando
- [ ] Preço definido em `/configuracoes` (`valorTeleconsultaCent` / `valorPresencialCent`)

### Conta / negócio (Laís) — precisa dela presente
- [ ] Conta Asaas de **produção** criada como **PJ** (CNPJ da `LAIS CAROLINE HAHMED LTDA`)
- [ ] Conta **verificada/aprovada** (documentos + identidade do responsável)
- [ ] **Chave Pix / conta bancária** cadastrada (onde o dinheiro cai)
- [ ] **API Key de produção** em mãos (diferente da chave de sandbox)
- [ ] *(opcional, pode ficar para depois)* NFS-e habilitada no Asaas — exige inscrição
      municipal e dados fiscais

---

## Fase 1 — Virar a chave (dia do go-live)

### `.env` de PRODUÇÃO (no EC2 — cuidado com UTF-8: editar com `[IO.File]::WriteAllText`, nunca `Set-Content` sem `-Encoding`)
- [ ] `PAGAMENTO_PROVEDOR=ASAAS`
- [ ] `ASAAS_BASE_URL=https://api.asaas.com/v3`  ← **produção**, não `api-sandbox`
- [ ] `ASAAS_API_KEY=<chave de produção>`
- [ ] `ASAAS_WEBHOOK_TOKEN=<um segredo que você inventa>`
- [ ] `PAGAMENTO_ATIVO=true`
- [ ] Conferir que **não sobrou nenhum valor de sandbox**

### Painel do Asaas (produção) → Integrações → Webhooks
- [ ] Webhook apontando para `https://consulta.dralaishahmed.com.br/api/pagamentos/webhook`
- [ ] Token de autenticação = **o mesmo** valor de `ASAAS_WEBHOOK_TOKEN`
- [ ] Eventos marcados: `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`

### Deploy + restart
- [ ] **Backup do banco antes** (`pg_dump`, guardar em local seguro)
- [ ] Deploy do código com o adaptador, se ainda não estava no servidor:
      `tar` (sem `node_modules`/`.next`/`.env`) → `scp` →
      `npm ci && npx prisma migrate deploy && rm -rf .next && npm run build`
      *(a instância tem 1 GB de RAM + swap; o `rm -rf .next` antes do build evita apertar memória)*
- [ ] `sudo systemctl restart dralais-plataforma`
- [ ] **Confirmar que o serviço SUBIU** (`systemctl status`). Se não subir, o fail-closed
      pegou uma inconsistência — revise as variáveis do `.env`

---

## Fase 2 — Smoke test com dinheiro real (ANTES de abrir ao público)
- [ ] Agendar uma teleconsulta de teste
- [ ] Pagar o **Pix real de valor baixo** (você mesmo, R$1–5)
- [ ] Conferir a cadeia inteira: QR aparece → paga → **webhook chega no domínio real** →
      consulta vira `CONFIRMADA` → e-mail de confirmação sai
- [ ] Conferir no painel do Asaas que **o dinheiro entrou**
- [ ] Conferir a auditoria `REGISTROU_PAGAMENTO`
- [ ] Limpar/estornar a consulta de teste

---

## Fase 3 — Monitorar as primeiras horas
- [ ] Acompanhar os primeiros agendamentos reais
- [ ] Confirmar que **reserva não paga expira** (cron) e **libera o slot**
- [ ] Olhar logs / erros do serviço

---

## Plano de recuo (reversível a qualquer momento)
Se algo der errado, **desligar é seguro e instantâneo**:
- [ ] No `.env` de produção: `PAGAMENTO_ATIVO=false`
- [ ] `sudo systemctl restart dralais-plataforma`

Com o pagamento OFF, o agendamento volta ao **ramo sem-pagamento** (consulta nasce
`AGENDADA` + `ISENTO`, e-mail direto) — exatamente como funciona hoje. Nada quebra.

---

## Observações
- O código **não muda** entre sandbox e produção — só as variáveis e o webhook.
- O webhook do provedor **só chega em produção** (precisa de URL pública). Em dev/local,
  usar o adaptador `fake` ou um túnel `ngrok`.
- Enquanto o pagamento estiver dormente, o **encaixe manual** da médica (`/api/consultas/manual`)
  continua funcionando normal, com `pagamentoNota` para registrar "como foi pago".
- Este checklist cobre só o **pagamento**. Os outros itens de "antes de paciente real"
  (backup automático, observabilidade, DPAs) estão no dossiê/README §7 e são independentes.
