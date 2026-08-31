<#
  Route 53 - zona e registros de dralaishahmed.com.br
  Site em nginx/EC2 (IP fixo) + e-mail no Zoho Mail.

  Pre-requisitos:
    - AWS CLI v2 instalada e configurada (aws configure)
    - Elastic IP ja alocado e associado a instancia EC2

  Uso tipico (duas etapas):

    # 1) cria a zona e mostra os nameservers para colar no Registro.br
    .\route53-setup.ps1 -CreateZone

    # 2) depois de criar a conta no Zoho, cria todos os registros
    .\route53-setup.ps1 -ElasticIp 12.34.56.78 `
                        -ZohoVerification "zb12345678.zmverify.zoho.com" `
                        -DkimValue "v=DKIM1; k=rsa; p=MIGfMA0GCSq..."

  Rode -WhatIf primeiro para conferir o JSON sem aplicar nada.
#>

[CmdletBinding()]
param(
  [string] $Domain = 'dralaishahmed.com.br',
  [switch] $CreateZone,
  [string] $ElasticIp,
  [string] $ZohoVerification,
  [string] $DkimValue,
  [string] $DmarcRua = 'contato@dralaishahmed.com.br',
  [int]    $Ttl = 300,
  [switch] $WhatIf
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- utilidades
function Assert-AwsCli {
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI nao encontrada. Instale a v2 e rode "aws configure".'
  }
}

function Get-HostedZoneId {
  param([string] $Name)
  $json = aws route53 list-hosted-zones-by-name --dns-name $Name --max-items 1 | ConvertFrom-Json
  $zone = $json.HostedZones | Where-Object { $_.Name -eq "$Name." } | Select-Object -First 1
  if ($zone) { return ($zone.Id -replace '/hostedzone/', '') }
  return $null
}

# ------------------------------------------------------------- criar a zona
if ($CreateZone) {
  Assert-AwsCli
  $existing = Get-HostedZoneId -Name $Domain
  if ($existing) {
    Write-Host "Zona ja existe: $existing" -ForegroundColor Yellow
    $zoneId = $existing
  } else {
    $ref = "dralais-" + [guid]::NewGuid().ToString('N').Substring(0, 12)
    $res = aws route53 create-hosted-zone --name $Domain --caller-reference $ref | ConvertFrom-Json
    $zoneId = $res.HostedZone.Id -replace '/hostedzone/', ''
    Write-Host "Zona criada: $zoneId" -ForegroundColor Green
  }

  $ns = (aws route53 get-hosted-zone --id $zoneId | ConvertFrom-Json).DelegationSet.NameServers
  Write-Host ''
  Write-Host '  Cole estes nameservers no Registro.br:' -ForegroundColor Cyan
  Write-Host '  ------------------------------------------------'
  $ns | ForEach-Object { Write-Host "   $_" }
  Write-Host ''
  Write-Host '  A propagacao pode levar algumas horas.' -ForegroundColor DarkGray
  Write-Host ''
  return
}

# ------------------------------------------------------- validar parametros
if (-not $ElasticIp) { throw 'Informe -ElasticIp (o IP fixo da instancia EC2) ou use -CreateZone.' }
if ($ElasticIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "ElasticIp invalido: $ElasticIp" }

Assert-AwsCli
$zoneId = Get-HostedZoneId -Name $Domain
if (-not $zoneId) { throw "Hosted zone de $Domain nao encontrada. Rode antes: .\route53-setup.ps1 -CreateZone" }
Write-Host "Hosted zone: $zoneId" -ForegroundColor Green

# ------------------------------------------------------------- construir os
#                                                                 registros
$changes = @()

function New-Change {
  param([string] $Name, [string] $Type, [string[]] $Values, [int] $RecordTtl = $Ttl)
  return @{
    Action            = 'UPSERT'
    ResourceRecordSet = @{
      Name            = $Name
      Type            = $Type
      TTL             = $RecordTtl
      ResourceRecords = @($Values | ForEach-Object { @{ Value = $_ } })
    }
  }
}

# --- site: raiz e www apontando para o nginx (IP fixo) ---
$changes += New-Change -Name $Domain          -Type 'A' -Values @($ElasticIp)
$changes += New-Change -Name "www.$Domain"    -Type 'A' -Values @($ElasticIp)

# --- e-mail: entrega (Zoho, data center .com) ---
$changes += New-Change -Name $Domain -Type 'MX' -Values @(
  '10 mx.zoho.com',
  '20 mx2.zoho.com',
  '50 mx3.zoho.com'
) -RecordTtl 3600

# --- e-mail: SPF (+ verificacao do dominio, se informada) ---
# Atencao: SPF e verificacao compartilham o TXT da raiz. Precisam ir no MESMO
# registro, senao um sobrescreve o outro.
$rootTxt = @('"v=spf1 include:zoho.com ~all"')
if ($ZohoVerification) {
  $v = $ZohoVerification -replace '^zoho-verification=', ''
  $rootTxt += "`"zoho-verification=$v`""
}
$changes += New-Change -Name $Domain -Type 'TXT' -Values $rootTxt

# --- e-mail: DKIM ---
if ($DkimValue) {
  # TXT tem limite de 255 caracteres por string; chaves DKIM costumam passar
  # disso e precisam ser quebradas em pedacos concatenados.
  $clean = $DkimValue -replace '"', ''
  $parts = @()
  for ($i = 0; $i -lt $clean.Length; $i += 255) {
    $len = [Math]::Min(255, $clean.Length - $i)
    $parts += '"' + $clean.Substring($i, $len) + '"'
  }
  $changes += New-Change -Name "zmail._domainkey.$Domain" -Type 'TXT' -Values @($parts -join ' ')
}

# --- e-mail: DMARC ---
$changes += New-Change -Name "_dmarc.$Domain" -Type 'TXT' `
  -Values @("`"v=DMARC1; p=none; rua=mailto:$DmarcRua`"") -RecordTtl 3600

# ------------------------------------------------------------------ aplicar
$batch = @{
  Comment = "Site nginx/EC2 + e-mail Zoho - $Domain"
  Changes = $changes
} | ConvertTo-Json -Depth 10

$file = Join-Path $env:TEMP "r53-$($Domain -replace '\.','-').json"
$batch | Out-File -FilePath $file -Encoding utf8

Write-Host ''
Write-Host "Change batch gravado em: $file" -ForegroundColor DarkGray
Write-Host ''
Write-Host $batch
Write-Host ''

if ($WhatIf) {
  Write-Host 'WhatIf ativo - nada foi aplicado.' -ForegroundColor Yellow
  return
}

$resp = aws route53 change-resource-record-sets --hosted-zone-id $zoneId --change-batch "file://$file" | ConvertFrom-Json
Write-Host ("Aplicado. Status: {0} (id {1})" -f $resp.ChangeInfo.Status, $resp.ChangeInfo.Id) -ForegroundColor Green
Write-Host ''
Write-Host 'Conferir depois da propagacao:' -ForegroundColor Cyan
Write-Host "  nslookup -type=A   $Domain"
Write-Host "  nslookup -type=MX  $Domain"
Write-Host "  nslookup -type=TXT $Domain"
Write-Host "  nslookup -type=TXT zmail._domainkey.$Domain"
Write-Host ''
