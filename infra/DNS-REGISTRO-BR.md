# DNS no Registro.br — `dralaishahmed.com.br`

Guia de preenchimento do **Editar Zona** (DNS grátis do Registro.br).

- **Site:** nginx em EC2, IP fixo (Elastic IP) — canônico `https://www.dralaishahmed.com.br`
- **E-mail:** Zoho Mail — `contato@dralaishahmed.com.br`

> Não é preciso trocar nameserver. Como o nginx tem IP fixo, o DNS do próprio
> Registro.br atende tudo. O Route 53 só seria necessário com CloudFront.

---

## Como a tela funciona

O formulário tem 3 ou 4 campos:

| Campo | O que significa |
|---|---|
| **Tipo** | `A`, `MX`, `TXT`, `CNAME`… |
| **Nome** | O prefixo. A tela mostra `.dralaishahmed.com.br` fixo ao lado — o que você digitar vira prefixo disso |
| **Prioridade** | Só aparece para `MX`. É um campo separado |
| **Dados / Valor** | O conteúdo do registro |

**A regra que mais confunde:** para valer no domínio raiz (`dralaishahmed.com.br`, sem
prefixo), o campo **Nome fica VAZIO**. Não escreva o domínio ali — isso geraria
`dralaishahmed.com.br.dralaishahmed.com.br`.

Se o formulário não aceitar vazio, use `@`.

---

## Resumo — as 9 entradas

| # | Tipo | Nome | Prio. | Dados | Quando |
|---|---|---|---|---|---|
| 1 | MX | *(vazio)* | 10 | `mx.zoho.com` | agora |
| 2 | MX | *(vazio)* | 20 | `mx2.zoho.com` | agora |
| 3 | MX | *(vazio)* | 50 | `mx3.zoho.com` | agora |
| 4 | TXT | *(vazio)* | — | `v=spf1 include:zoho.com ~all` | agora |
| 5 | A | *(vazio)* | — | `SEU.ELASTIC.IP.AQUI` | com o EC2 pronto |
| 6 | A | `www` | — | `SEU.ELASTIC.IP.AQUI` | com o EC2 pronto |
| 7 | TXT | *(vazio)* | — | `zoho-verification=zb******.zmverify.zoho.com` | com a conta Zoho |
| 8 | TXT | `zmail._domainkey` | — | `v=DKIM1; k=rsa; p=...` | com a conta Zoho |
| 9 | TXT | `_dmarc` | — | `v=DMARC1; p=none; rua=mailto:contato@dralaishahmed.com.br` | depois do DKIM |

---

## Fase 1 — E-mail: entrega e remetente

Pode fazer já. Não depende de servidor nem de conta criada.

### ☐ 1 a 3 — Registros MX

Três entradas separadas, todas com Nome vazio. Mude só a prioridade e o servidor:

```
Tipo: MX   |   Nome: (vazio)   |   Prioridade: 10   |   Dados: mx.zoho.com
Tipo: MX   |   Nome: (vazio)   |   Prioridade: 20   |   Dados: mx2.zoho.com
Tipo: MX   |   Nome: (vazio)   |   Prioridade: 50   |   Dados: mx3.zoho.com
```

Prioridade menor = tentado primeiro. Os outros dois são reserva.

> **Confira o data center.** Esses valores são do Zoho nos EUA (`.com`). Se ao criar a conta
> você escolher outra região, os nomes mudam (`mx.zoho.eu`, etc.). O painel do Zoho mostra os
> corretos em **Tools & Settings**. MX errado = nenhum e-mail entra.

### ☐ 4 — SPF

Diz quais servidores podem enviar e-mail em nome do domínio. Sem isso, a mensagem dela cai em spam.

```
Tipo: TXT   |   Nome: (vazio)   |   Dados: v=spf1 include:zoho.com ~all
```

> **Só pode existir UM SPF.** Vários registros TXT na raiz é normal e permitido — o que não
> pode é dois começando com `v=spf1`. Se um dia outro serviço pedir SPF, junte numa linha só:
> `v=spf1 include:zoho.com include:outro.com ~all`

---

## Fase 2 — Site

Depende da instância EC2 com **Elastic IP** associado.

### ☐ 5 e 6 — Registros A

```
Tipo: A   |   Nome: (vazio)   |   Dados: 12.34.56.78     <- raiz
Tipo: A   |   Nome: www       |   Dados: 12.34.56.78     <- www
```

Mesmo IP nos dois. O redirecionamento da raiz para o `www` é feito pelo nginx, não pelo DNS.

> **Precisa ser Elastic IP.** IP público comum de EC2 muda a cada stop/start, e o site sai do ar
> apontando para um endereço que não é mais dela.

---

## Fase 3 — Autenticação do e-mail

Estes dois valores **são gerados na conta do Zoho** e são únicos. Não existem antes disso.

### ☐ 7 — Verificação do domínio

Aparece na tela "adicionar domínio" do Zoho:

```
Tipo: TXT   |   Nome: (vazio)   |   Dados: zoho-verification=zb******.zmverify.zoho.com
```

Depois de salvar, volte ao Zoho e clique em **Verificar**.

### ☐ 8 — DKIM

Assina digitalmente cada e-mail enviado. Gere em **Email Authentication → DKIM**:

```
Tipo: TXT   |   Nome: zmail._domainkey   |   Dados: v=DKIM1; k=rsa; p=MIGfMA0GCSq...
```

No campo Nome digite só `zmail._domainkey` — o resto do domínio o painel completa.

> **Não pule.** Domínio novo sem DKIM vai para spam com frequência alta. E-mail de médica
> que não chega é problema real.
>
> Cole a chave em **uma linha só**, sem quebra e sem espaço extra. Se o campo cortar, veja
> "Problemas comuns" abaixo.

### ☐ 9 — DMARC

Define o que fazer com mensagem que falhe na checagem:

```
Tipo: TXT   |   Nome: _dmarc   |   Dados: v=DMARC1; p=none; rua=mailto:contato@dralaishahmed.com.br
```

`p=none` é modo observação — não bloqueia nada, só relata. É o certo para começar. Depois de
algumas semanas sem problema, dá para endurecer para `p=quarantine`.

---

## Conferir

Depois de salvar tudo, espere a propagação (minutos a algumas horas) e rode no PowerShell:

```powershell
nslookup -type=A   dralaishahmed.com.br
nslookup -type=A   www.dralaishahmed.com.br
nslookup -type=MX  dralaishahmed.com.br
nslookup -type=TXT dralaishahmed.com.br
nslookup -type=TXT zmail._domainkey.dralaishahmed.com.br
nslookup -type=TXT _dmarc.dralaishahmed.com.br
```

O que esperar:

- `A` → o Elastic IP, nos dois nomes
- `MX` → os três `mx*.zoho.com` com as prioridades
- `TXT` da raiz → SPF **e** verificação do Zoho (dois registros, normal)
- `zmail._domainkey` → a chave DKIM
- `_dmarc` → a política

### Teste final do e-mail

1. Mande uma mensagem de fora (Gmail, por exemplo) para `contato@dralaishahmed.com.br`
2. Confirme que chegou
3. **Responda** e confirme que o remetente saiu como `contato@dralaishahmed.com.br`
4. Rode um teste em <https://www.mail-tester.com> — meta: **10/10**

Só divulgue o endereço depois que os quatro passarem.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| E-mail não chega | MX ausente, ou do data center errado |
| E-mail chega mas cai em spam | Falta SPF ou DKIM |
| Zoho não verifica o domínio | TXT de verificação ainda não propagou — espere e tente de novo |
| Formulário recusa o TXT | Tente com aspas: `"v=spf1 include:zoho.com ~all"` |
| Formulário recusa o MX | Tente com ponto no final: `mx.zoho.com.` |
| Campo do DKIM corta a chave | A string TXT tem limite de 255 caracteres. Quebre em pedaços entre aspas, separados por espaço: `"v=DKIM1; k=rsa; p=PRIMEIRA_PARTE" "SEGUNDA_PARTE"` |
| Site não abre | `A` errado, ou porta 80/443 fechada no Security Group |
| Abre sem HTTPS | Certbot ainda não rodou — veja `README-infra.md` |

---

## O que NÃO fazer

- ❌ Não escreva `dralaishahmed.com.br` no campo **Nome** — ele já é o sufixo
- ❌ Não crie `CNAME` na raiz — é inválido e derruba o e-mail junto
- ❌ Não crie dois registros começando com `v=spf1`
- ❌ Não coloque `www` nos registros MX — e-mail é sempre na raiz
- ❌ Não junte prioridade e servidor no mesmo campo (`10 mx.zoho.com`) — a prioridade tem caixa própria

---

## Ordem sugerida

1. ☐ Entradas **1 a 4** (MX + SPF) — pode ser agora
2. ☐ Subir a EC2, associar Elastic IP
3. ☐ Entradas **5 e 6** (A) → site no ar por HTTP
4. ☐ Certbot → HTTPS
5. ☐ Criar conta Zoho → entrada **7** → verificar
6. ☐ Gerar DKIM → entradas **8 e 9**
7. ☐ Criar as caixas `contato@`, `lais@`, `privacidade@`
8. ☐ Testar e-mail ponta a ponta
9. ☐ Divulgar
