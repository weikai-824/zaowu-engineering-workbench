[CmdletBinding()]
param(
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}

$repoRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$cadLauncher = Join-Path $repoRoot 'scripts\start-local-cad-executor.ps1'
$cadLog = Join-Path $repoRoot '.sites-runtime\local-cad-executor.out.log'

function Wait-ForClose {
  if (-not $NoPause) { [void](Read-Host '按 Enter 关闭此窗口（本机 CAD 执行器会继续运行）') }
}

try {
  if (-not (Test-Path -LiteralPath $cadLauncher -PathType Leaf)) {
    throw "本机 CAD 启动文件缺失：$cadLauncher"
  }

  Clear-Host
  Write-Host '正在生成本机 CAD 的 8 位配对码……' -ForegroundColor Cyan

  $cadOutput = @(& $cadLauncher -Restart -Background 2>&1)

  $match = [regex]::Match([string]::Join(' ', $cadOutput), '8 位配对码\s+(\d{8})(?!\d)')
  $pairCode = if ($match.Success) { $match.Groups[1].Value } else { $null }
  if ($pairCode -notmatch '^\d{8}$') { throw "没有读到有效的 8 位配对码，请查看：$cadLog" }

  $clipboardReady = $false
  try {
    Set-Clipboard -Value $pairCode
    $clipboardReady = $true
  } catch {}

  Clear-Host
  Write-Host '本次 8 位配对码：' -ForegroundColor Green
  Write-Host "    $pairCode" -ForegroundColor Yellow
  Write-Host $(if ($clipboardReady) { '    已复制，网页里直接按 Ctrl+V。' } else { '    未能自动复制，请手动输入上面的数字。' }) -ForegroundColor DarkGray
  Write-Host '    10 分钟内有效；再次双击此脚本会生成新码。' -ForegroundColor DarkGray
  Write-Host ''
  Wait-ForClose
  exit 0
} catch {
  Write-Host ''
  Write-Host '启动失败：' -ForegroundColor Red -NoNewline
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "工程目录：$repoRoot" -ForegroundColor DarkGray
  Wait-ForClose
  exit 1
}
