# Site — Dra. Laís Caroline Hahmed

Site institucional estático (HTML + CSS + JS puro), sem frameworks, sem build e
**sem nenhuma requisição a servidores de terceiros** no carregamento — decisão tomada
para reforçar a conformidade com a LGPD.

---

## 1. O que precisa ser preenchido (obrigatório)

### 1.1 Link da plataforma de teleconsulta ✅

O site aponta para a **plataforma própria** (`plataforma/`), que substituiu o
Doctoralia. O endereço fica em `assets/js/main.js`:

```js
PLATAFORMA_TELEMEDICINA: 'https://consulta.dralaishahmed.com.br/agendar',
```

Isso atualiza **todos** os botões do site de uma vez:

| Onde | Botão |
|---|---|
| Cabeçalho | Agendar teleconsulta |
| Hero (topo) | Agendar teleconsulta |
| Seção Telemedicina | Agendar teleconsulta |
| Faixa final de contato | Agendar teleconsulta |

Todos abrem em nova aba com `rel="noopener noreferrer"`. Se o campo ficar
vazio, os botões caem automaticamente no WhatsApp (o site nunca fica com link
quebrado).

> ⚠️ **Para o link funcionar em produção**, o subdomínio precisa existir:
> registro A `consulta` → `15.229.195.141` no DNS, o bloco novo do
> `infra/nginx-dralaishahmed.conf`, a plataforma rodando na instância
> (`npm run build && npm run start` em `plataforma/`, com
> `AUTH_URL=https://consulta.dralaishahmed.com.br` no `.env`) e o certificado
> via certbot. Passo a passo no próprio arquivo do nginx.

### 1.2 Imagem de compartilhamento (opcional)

`assets/img/og-capa.jpg` — 1200 × 630 px. É o que aparece ao enviar o link no WhatsApp/Instagram.

### 1.3 Domínio

Já configurado como `https://www.dralaishahmed.com.br/` em `index.html` (canonical),
`sitemap.xml` e `robots.txt`. Só precisa mexer se o domínio mudar.

---

## 1-B. Identidade visual

A logo original (`logodralaishahmed.jpeg`, monograma LH em círculo, preto sobre branco) foi
processada para uso web. **Os arquivos derivados foram gerados a partir dela — não edite à mão:**

| Arquivo | O que é | Onde aparece |
|---|---|---|
| `logo-lh.png` | Marca preta, **fundo transparente**, recortada no limite exato | Cabeçalho e rodapé de todas as páginas |
| `logo-lh-branco.png` | Mesma marca em branco | Reserva para fundos escuros |
| `favicon.png` | Marca branca sobre quadrado arredondado verde-petróleo | Aba do navegador e ícone no celular |
| `logodralaishahmed.jpeg` | Original, preservado | Fonte para regerar os demais |

O JPEG original **não é usado diretamente** no site: ele tem fundo branco sólido, que apareceria como
um retângulo branco no tema escuro. O PNG transparente é invertido por CSS no tema escuro
(preto puro → branco puro), então a marca funciona nos dois temas com um arquivo só.

### Foto profissional

`assets/img/dra-lais.jpg` — já instalada. Se for trocar, o ideal é **4:5** (ex.: 1040 × 1300 px)
com enquadramento de **cabeça e ombros**, fundo claro e neutro. Se o arquivo sumir, o site cai
no monograma automaticamente, sem imagem quebrada.

Ético (CFM): foto profissional simples. Sem imagens de pacientes, procedimentos ou “antes e depois”.

---

## 2. Estrutura

```
.
├── index.html                     página principal
├── politica-de-privacidade.html   LGPD (Lei 13.709/2018)
├── termos-de-uso.html             condições de uso e limites da telemedicina
├── robots.txt
├── sitemap.xml
└── assets/
    ├── css/style.css
    ├── js/main.js                 ← link da plataforma fica aqui
    └── img/
        ├── logodralaishahmed.jpeg  original da logo (fonte)
        ├── logo-lh.png             marca transparente — usada no site
        ├── logo-lh-branco.png      versão branca (reserva)
        ├── favicon.png             ícone da aba
        ├── dra-lais.jpg            foto profissional
        └── og-capa.jpg             (a adicionar)
```

---

## 3. Conformidade com a ética médica (CFM)

O texto foi escrito seguindo o Código de Ética Médica (Res. CFM 2.217/2018), a Res. CFM 1.974/2011
e o Manual de Publicidade Médica. O que foi observado:

- CRM-MS 16563 visível no cabeçalho, no hero, no rodapé e nas páginas legais;
- responsável técnica pelo conteúdo identificada no rodapé;
- **nenhum anúncio de especialidade** — a seção de atendimento fala em *motivos de consulta*, e há
  aviso explícito de atuação em medicina geral, sem RQE vinculado ao registro;
- a seção Trajetória descreve **atuação assistencial e habilidades clínicas**, com os preceptores
  nomeados e seus CRMs. As atribuições de acompanhamento foram mantidas de propósito: são
  verificáveis, agregam credibilidade e evitam que o texto sugira prática autônoma como especialista;
- **nenhum nome de especialidade é usado como rótulo**. "Otorrinolaringologia" virou "queixas de
  ouvido, nariz e garganta"; "Pediatria" virou "saúde da criança"; "Psiquiatria" virou "saúde mental".
  Os itens são apresentados como *habilidades desenvolvidas*, não como áreas de titulação;
- os dados estruturados **não declaram `medicalSpecialty`** — usam `knowsAbout` (temas de
  conhecimento). A propriedade `medicalSpecialty` é lida pelo Google como afirmação de titulação e
  não deve ser usada sem RQE. Se alguém for mexer no JSON-LD, não reintroduza esse campo;
- sem promessa de resultado, sem “antes e depois”, sem depoimentos de pacientes, sem preços,
  sem sensacionalismo e sem concorrência desleal;
- aviso de urgência/emergência (SAMU 192) na seção de telemedicina e nos termos de uso;
- referência à Lei 14.510/2022 e à Res. CFM 2.314/2022 no que diz respeito à teleconsulta.

> Recomendação: antes de publicar, submeta o texto final à **Comissão de Divulgação de Assuntos
> Médicos (CODAME)** do CRM-MS. É o procedimento padrão e evita questionamentos posteriores.

---

## 4. Conformidade com a LGPD

- **Zero rastreadores**: sem Google Analytics, sem Meta Pixel, sem Google Fonts, sem CDNs.
  As fontes são as do próprio sistema operacional.
- `localStorage` usado apenas para preferência de tema e ciência do aviso de privacidade —
  nada sai do dispositivo do visitante.
- Aviso de privacidade discreto no rodapé da tela, exibido uma vez.
- Política de Privacidade completa: controladora, encarregada (DPO), bases legais do art. 7º e do
  art. 11 (dado sensível de saúde), prazos de guarda do prontuário (20 anos — Res. CFM 1.821/2007 e
  Lei 13.787/2018), compartilhamento, segurança e os direitos do art. 18.
- A teleconsulta ocorre em **plataforma própria** (`plataforma/`), e a política nomeia os
  **operadores** de tecnologia (Daily.co, AWS São Paulo, Anthropic) com a finalidade de cada um —
  transparência do art. 9º da LGPD. O assistente de anotação só roda com consentimento expresso,
  colhido dentro da consulta, e o áudio é apagado após a transcrição.

**Se um dia forem adicionados analytics ou formulário de contato**, será necessário: banner de
consentimento com opção de recusa, atualização da tabela de dados na política e revisão das bases legais.

---

## 5. Publicação

Qualquer hospedagem estática serve. Basta enviar a pasta inteira:

- **Netlify / Vercel / Cloudflare Pages** — arrastar a pasta, HTTPS automático e gratuito;
- **GitHub Pages** — subir o repositório e ativar Pages;
- **Hospedagem tradicional (cPanel)** — enviar os arquivos para `public_html/` via FTP.

Requisito: **HTTPS obrigatório** (a política de privacidade o declara).

### Ver o site localmente

**Jeito mais simples:** dois cliques em **`preview.bat`**. Ele sobe um servidor local e já abre o
navegador em `http://127.0.0.1:4173/`. Para parar, feche a janela preta.

Pelo terminal, o equivalente é:

```powershell
node preview-server.cjs
```

**Sem servidor:** dois cliques em `index.html`. Funciona, mas o Chrome aplica restrições a arquivos
locais — prefira o `preview.bat` para avaliar de verdade.

> `preview.bat` e `preview-server.cjs` são só para desenvolvimento. **Não precisam ser enviados
> para a hospedagem** (não fazem mal se forem, mas são inúteis lá).

---

## 6. Recursos já incluídos

- Responsivo (celular, tablet e desktop) com menu mobile acessível;
- Tema claro/escuro automático, com alternador manual e sem “piscada” ao carregar;
- Acessibilidade: link “pular para o conteúdo”, foco visível, `aria-*`, contraste adequado e
  respeito a `prefers-reduced-motion`;
- SEO: meta description, Open Graph, `sitemap.xml`, `robots.txt` e dados estruturados
  `schema.org/Physician`;
- Botão flutuante de WhatsApp e versão para impressão (o currículo sai limpo em PDF via Ctrl+P).

