[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}

$repoRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$launcher = Join-Path $repoRoot 'scripts/open-local-domain.ps1'
$cadLauncher = Join-Path $repoRoot 'scripts/start-local-cad-executor.ps1'
$repairLauncher = Join-Path $repoRoot 'scripts/start-repair-demo.ps1'
$nodeScripts = @(
  (Join-Path $repoRoot 'scripts/check-build-freshness.mjs'),
  (Join-Path $repoRoot 'scripts/start-demo-services.mjs'),
  (Join-Path $repoRoot 'scripts/local-domain-proxy.mjs')
)

foreach ($script in @($launcher, $cadLauncher, $repairLauncher)) {
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) {
    throw "PowerShell 语法检查失败：$script - $($errors[0].Message)"
  }
}

$node = Get-Command node.exe -ErrorAction Stop
foreach ($script in $nodeScripts) {
  & $node.Source --check $script
  if ($LASTEXITCODE -ne 0) { throw "Node.js 语法检查失败：$script" }
}

& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcher -NoBrowser
if ($LASTEXITCODE -ne 0) { throw '启动器无浏览器冒烟检查失败。' }

$curl = Get-Command curl.exe -ErrorAction Stop
$status = & $curl.Source --noproxy '*' --silent --show-error --output NUL `
  --write-out '%{http_code}' --connect-timeout 4 --max-time 8 `
  --header 'Host: www.3dprinthub.cn' 'http://127.0.0.1/'
if ($LASTEXITCODE -ne 0 -or [string]$status -ne '200') {
  throw "本地域名转发冒烟检查失败（HTTP $status）。"
}

Write-Output '本地启动器检查通过：脚本语法、核心服务、首页和域名转发均正常。'
