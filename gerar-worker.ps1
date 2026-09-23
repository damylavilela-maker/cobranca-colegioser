# Junta o site inteiro (pasta public) em um unico arquivo: dist\worker-completo.js
# Esse arquivo e o que se cola no editor do Worker na Cloudflare.
# Como usar: clique com o botao direito neste arquivo > "Executar com o PowerShell".
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$pub = Join-Path $raiz "public"
$dist = Join-Path $raiz "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Ler($nome) { [System.IO.File]::ReadAllText((Join-Path $pub $nome), [System.Text.Encoding]::UTF8) }
function JsString($s) { ConvertTo-Json -InputObject $s -Compress }

$arquivos = @(
  @{ caminho = "/index.html"; nome = "index.html"; tipo = "text/html; charset=utf-8" },
  @{ caminho = "/app.js";     nome = "app.js";     tipo = "text/javascript; charset=utf-8" },
  @{ caminho = "/styles.css"; nome = "styles.css"; tipo = "text/css; charset=utf-8" }
)
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("// Painel de Cobranca - Colegio Ser. Arquivo gerado por gerar-worker.ps1 em " + (Get-Date -Format "dd/MM/yyyy HH:mm") + ". Nao edite aqui: edite a pasta public e gere de novo.")
[void]$sb.AppendLine("const ARQUIVOS_EMBUTIDOS = {")
foreach ($a in $arquivos) {
  [void]$sb.AppendLine("  " + (JsString $a.caminho) + ": { tipo: " + (JsString $a.tipo) + ", conteudo: " + (JsString (Ler $a.nome)) + " },")
}
[void]$sb.AppendLine("};")
[void]$sb.AppendLine("")
[void]$sb.Append([System.IO.File]::ReadAllText((Join-Path $raiz "src\worker.js"), [System.Text.Encoding]::UTF8))
$saida = Join-Path $dist "worker-completo.js"
[System.IO.File]::WriteAllText($saida, $sb.ToString(), $utf8)
Write-Host ("Gerado: " + $saida + " (" + [math]::Round((Get-Item $saida).Length / 1KB) + " KB)")
