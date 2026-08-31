# Publicar o site na EC2

**Status: site já publicado e funcionando por HTTP.** Falta o DNS e o HTTPS.

---

## Os dois servidores — não confundir

| Site | Elastic IP | Instância | Observação |
|---|---|---|---|
| **Dra. Laís** | **`15.229.195.141`** | `i-055e8cd090d946eb7` | Ubuntu 26.04, dedicada |
| Bonafé Advogados | `18.230.185.35` | `i-0f45bae7bdf89b345` | outra instância |

Ambos são Elastic IP: não mudam mais com stop/start.

| Item | Valor |
|---|---|
| Região | `sa-east-1b` |
| Chave SSH | `dralaishahmed.pem` (em `Downloads`) |
| Usuário | `ubuntu` |
| Pasta do site | `/var/www/dralaishahmed` |
| nginx | 1.28.3 |
| Config | `/etc/nginx/sites-available/dralaishahmed` |

Acesso:

```powershell
ssh -i "$env:USERPROFILE\Downloads\dralaishahmed.pem" ubuntu@15.229.195.141
```

---

## ✅ O que já foi feito

- nginx e certbot instalados
- Site enviado para `/var/www/dralaishahmed`
- Config instalada e validada (`nginx -t` OK)
- `default_server` do Ubuntu removido — o site da Dra. Laís é o padrão
- Permissões corrigidas (pastas `755`, arquivos `644`, grupo `www-data`)
- Redirect da raiz para `www` funcionando (301)
- Bloqueio de `.md`, `.bat`, `.ps1`, `.json`, `.conf` ativo (403)

Testes com todos os itens em **200**: as 3 páginas, `robots.txt`, `sitemap.xml`,
CSS, JS, logo, foto e favicon.

---

## ☐ 1. DNS no Registro.br

`dralaishahmed.com.br` → **Editar Zona**:

| Tipo | Nome | Dados |
|---|---|---|
| A | *(vazio)* | `15.229.195.141` |
| A | `www` | `15.229.195.141` |

> ⚠️ **Não use `18.230.185.35` aqui** — esse IP é do site do escritório.

Conferir:

```powershell
nslookup -type=A www.dralaishahmed.com.br
```

### Enquanto o DNS não propaga

Dá para ver o site agora, pelo IP direto:

```
http://15.229.195.141/
```

---

## ☐ 2. HTTPS

Só depois do DNS resolver. O certbot valida acessando o domínio.

```bash
sudo certbot --nginx -d dralaishahmed.com.br -d www.dralaishahmed.com.br
```

Emita para **os dois nomes** — sem certificado na raiz, o redirect para o `www`
quebra com aviso de segurança no navegador.

Renovação automática:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

### Depois de validar

Ative o HSTS em `/etc/nginx/sites-available/dralaishahmed`, descomentando:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Deixei comentado de propósito: uma vez enviado, o navegador do visitante recusa
HTTP nesse domínio por um ano e **não há como desfazer do lado dele**.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## ☐ 3. Fechar o SSH

O security group `sg-0d2ca0a8b7a49f3dc` (`launch-wizard-6`) libera a porta 22
para `0.0.0.0/0`. Com IP fixo e máquina ligada 24/7, varredura automatizada
encontra isso em horas.

```powershell
$MEU_IP = (Invoke-RestMethod "https://checkip.amazonaws.com").Trim()

aws ec2 revoke-security-group-ingress --region sa-east-1 `
  --group-id sg-0d2ca0a8b7a49f3dc --protocol tcp --port 22 --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress --region sa-east-1 `
  --group-id sg-0d2ca0a8b7a49f3dc --protocol tcp --port 22 --cidr "$MEU_IP/32"
```

---

## ☐ 4. Retenção de log (LGPD)

O log do nginx guarda IP, que é dado pessoal. A Política de Privacidade do site
declara **6 meses** (Marco Civil, art. 15). Alinhe o servidor ao documento:

```bash
sudo nano /etc/logrotate.d/nginx     # weekly + rotate 26
```

---

## Atualizar o site depois

Sempre que mudar algo local:

```powershell
$KEY  = "$env:USERPROFILE\Downloads\dralaishahmed.pem"
$SRV  = "ubuntu@15.229.195.141"
$PROJ = "C:\Users\igor_\Desktop\DraLaisCarolineHahmed"

scp -i $KEY "$PROJ\index.html" "$PROJ\politica-de-privacidade.html" `
            "$PROJ\termos-de-uso.html" "$PROJ\robots.txt" "$PROJ\sitemap.xml" `
            "${SRV}:/var/www/dralaishahmed/"
scp -i $KEY -r "$PROJ\assets" "${SRV}:/var/www/dralaishahmed/"

# scp cria pastas com modo 700 — sempre reaplique as permissoes:
ssh -i $KEY $SRV "sudo find /var/www/dralaishahmed -type d -exec chmod 755 {} \; ; sudo find /var/www/dralaishahmed -type f -exec chmod 644 {} \; ; sudo chown -R ubuntu:www-data /var/www/dralaishahmed"
```

> A linha de permissões **não é opcional**. O `scp -r` cria diretório `700`, que o
> nginx não consegue atravessar — o HTML abre e todo o CSS/imagem some. Foi
> exatamente o que aconteceu no primeiro envio.

**Nunca envie:** `infra/`, `preview.bat`, `preview-server.js`, `README.md`.

---

## Validar no final

- <https://www.ssllabs.com/ssltest/> — meta **A**
- <https://securityheaders.com> — meta **A**
- `https://dralaishahmed.com.br` deve redirecionar para `www`
- As duas páginas legais devem abrir
