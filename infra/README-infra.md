# Infraestrutura — www.dralaishahmed.com.br

Site estático em **nginx/EC2**, DNS no **Route 53**, e-mail no **Zoho Mail**.
Canônico: **`https://www.dralaishahmed.com.br`** (a raiz redireciona para o www).

> Esta pasta é de operação. **Não faça upload dela para o servidor web.**

---

## 1. EC2 e Elastic IP

O passo que mais causa dor de cabeça depois:

```powershell
# aloca um IP fixo e associa a instancia
aws ec2 allocate-address --domain vpc
aws ec2 associate-address --instance-id i-0123456789abcdef --allocation-id eipalloc-0123456789abcdef
```

**Sem Elastic IP, o IP público muda a cada stop/start da instância** e o site sai do ar
silenciosamente — o DNS continua apontando para um endereço que não é mais dela.

### Security Group

| Porta | Origem | Motivo |
|---|---|---|
| 80 | `0.0.0.0/0` | HTTP — necessário para o desafio do Let's Encrypt e para o redirect |
| 443 | `0.0.0.0/0` | HTTPS |
| 22 | **apenas o seu IP** | SSH |

SSH aberto para o mundo em servidor de médica é convite para força bruta. Restrinja ao seu IP
(ou use o AWS Systems Manager Session Manager e feche a 22 de vez).

---

## 2. DNS no Route 53

```powershell
# 1) cria a zona e mostra os nameservers para colar no Registro.br
.\route53-setup.ps1 -CreateZone

# 2) confere o que sera criado, sem aplicar
.\route53-setup.ps1 -ElasticIp 12.34.56.78 -WhatIf

# 3) aplica tudo (site + e-mail) depois de criar a conta no Zoho
.\route53-setup.ps1 -ElasticIp 12.34.56.78 `
                    -ZohoVerification "zb12345678.zmverify.zoho.com" `
                    -DkimValue "v=DKIM1; k=rsa; p=MIGfMA0GCSq..."
```

No Registro.br, a única mudança é trocar os nameservers pelos quatro do Route 53.

O script já resolve duas armadilhas: junta SPF e verificação do Zoho **no mesmo registro TXT
da raiz** (senão um sobrescreve o outro) e quebra a chave DKIM em blocos de 255 caracteres,
que é o limite de cada string TXT.

### Conferir

```powershell
nslookup -type=A   www.dralaishahmed.com.br
nslookup -type=MX  dralaishahmed.com.br
nslookup -type=TXT dralaishahmed.com.br
nslookup -type=TXT zmail._domainkey.dralaishahmed.com.br
```

---

## 3. Publicar o site

```bash
sudo mkdir -p /var/www/dralaishahmed
sudo chown -R $USER:$USER /var/www/dralaishahmed
```

Envie **apenas** o conteúdo do site:

```
index.html  politica-de-privacidade.html  termos-de-uso.html
robots.txt  sitemap.xml  assets/
```

**Não envie:** `infra/`, `preview.bat`, `preview-server.js`, `README.md`.
O bloco `deny all` do nginx já bloqueia `.bat`, `.ps1`, `.md`, `.json` e `.log` como rede de
segurança — mas o certo é não subir.

```bash
sudo cp nginx-dralaishahmed.conf /etc/nginx/conf.d/dralaishahmed.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4. HTTPS

**A AWS ACM não serve aqui.** Certificado público do ACM só pode ser instalado em ELB,
CloudFront e API Gateway — não em nginx rodando na instância. Use Let's Encrypt:

```bash
sudo dnf install -y certbot python3-certbot-nginx     # Amazon Linux 2023
# sudo apt install -y certbot python3-certbot-nginx   # Ubuntu

sudo certbot --nginx -d dralaishahmed.com.br -d www.dralaishahmed.com.br
```

Emita para **os dois nomes**: o redirect da raiz só funciona se ela também tiver certificado.

Faça isso **depois** que o DNS propagar — o certbot valida acessando o domínio.

Renovação automática:

```bash
sudo systemctl status certbot-renew.timer
sudo certbot renew --dry-run
```

### HSTS

O cabeçalho `Strict-Transport-Security` está ativo no arquivo. **Confirme que o HTTPS está
funcionando nos dois nomes antes de deixar assim.** Depois de enviado, o navegador recusa
acesso via HTTP pelo tempo do `max-age` (1 ano) — se algo quebrar, não tem como voltar atrás
do lado do visitante. Em caso de dúvida, suba primeiro com `max-age=300`, valide, e só então
aumente.

---

## 5. Segurança

O arquivo do nginx já aplica:

| Cabeçalho | Efeito |
|---|---|
| `Strict-Transport-Security` | Força HTTPS |
| `Content-Security-Policy` | Só permite recursos do próprio domínio |
| `X-Content-Type-Options` | Impede MIME sniffing |
| `X-Frame-Options` | Impede que o site seja embutido em iframe de terceiro |
| `Referrer-Policy` | Não vaza a URL completa para sites externos |
| `Permissions-Policy` | Desliga câmera, microfone e geolocalização |
| `server_tokens off` | Esconde a versão do nginx nas respostas |

A CSP pôde ficar restritiva porque o site **não carrega nada de terceiros**. Se um dia entrar
Google Analytics, Meta Pixel ou fonte externa, a CSP vai bloquear — e aí a decisão de incluir
precisa passar antes pela Política de Privacidade, não só pelo `nginx.conf`.

### Contexto LGPD

Este servidor **não armazena dado de paciente**. O site é estático, sem formulário e sem banco;
a parte clínica toda vive na plataforma própria (subdomínio `consulta`, bloco no nginx). Isso mantém o site estático simples — e é o que
sustenta o que está escrito na Política de Privacidade.

O que sobra sob sua responsabilidade:

- **Log de acesso do nginx guarda IP**, que é dado pessoal. A política declara retenção de
  6 meses (Marco Civil, art. 15). Configure rotação compatível:
  `/etc/logrotate.d/nginx` → `rotate 26` com `weekly`.
- Mantenha o sistema atualizado (`sudo dnf update -y`).
- Snapshot periódico do volume EBS.

### Validação depois de publicar

- SSL Labs — <https://www.ssllabs.com/ssltest/> (meta: nota A)
- Security Headers — <https://securityheaders.com>
- Zoho: mandar e-mail de fora, responder, e confirmar que sai como `contato@`
- Autenticação de e-mail — <https://www.mail-tester.com> (meta: 10/10)

---

## 6. Ordem de execução

1. Registrar o domínio
2. `-CreateZone` → trocar nameservers no Registro.br
3. Elastic IP na instância
4. Criar conta no Zoho, pegar verificação e DKIM
5. Rodar o script com todos os parâmetros
6. Esperar propagação e conferir com `nslookup`
7. Subir os arquivos e o `nginx.conf`
8. Certbot
9. Testar e-mail **antes** de divulgar o endereço
10. Rodar as validações acima
