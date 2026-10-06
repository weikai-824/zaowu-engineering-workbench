[CmdletBinding()]
param(
  [string]$CadPython = $env:ZAOWU_CAD_PYTHON,
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA 'Zaowu\cad-executor-state'),
  [int]$Port = 8837,
  [switch]$Restart,
  [switch]$Background
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}

$repoRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$relay = Join-Path $repoRoot 'public\executor\local_cad_relay.py'
$runner = Join-Path $repoRoot 'public\cad\run_cad.py'
$runtimeDir = Join-Path $repoRoot '.sites-runtime'
$outLog = Join-Path $runtimeDir 'local-cad-executor.out.log'
$errorLog = Join-Path $runtimeDir 'local-cad-executor.error.log'

foreach ($requiredFile in @($relay, $runner)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "CAD 执行器文件缺失：$requiredFile"
  }
}

if (-not $CadPython) {
  $CadPython = @(
    (Join-Path $repoRoot 'cad-env\Scripts\python.exe'),
    'D:\ProgramData\anaconda3\envs\zaowu-cad\python.exe'
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $CadPython -or -not (Test-Path -LiteralPath $CadPython)) {
  throw '未找到 CAD Python。请设置 ZAOWU_CAD_PYTHON，或用 -CadPython 指定已安装 CadQuery 的 python.exe。'
}
$existing = Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($existing.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $owner -or ([string]$owner.CommandLine).IndexOf($relay, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "端口 $Port 不是由当前工程的执行器占用，拒绝停止 PID $($existing.OwningProcess)。"
  }
  if (-not $Restart) {
    Write-Output "本机建模程序已经在运行：PID $($existing.OwningProcess)，端口 $Port。"
    exit 0
  }
  Stop-Process -Id $existing.OwningProcess -Force
  $stopDeadline = (Get-Date).AddSeconds(8)
  while ((Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue) -and (Get-Date) -lt $stopDeadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "旧执行器未能释放端口 $Port。"
  }
}

& $CadPython -c 'import cadquery, cryptography' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'CAD Python 缺少 cadquery 或 cryptography，请按执行器说明安装锁定依赖。' }
if (-not (Test-Path -LiteralPath $runtimeDir)) { New-Item -ItemType Directory -Path $runtimeDir | Out-Null }
if (-not (Test-Path -LiteralPath $StateDir)) { New-Item -ItemType Directory -Path $StateDir | Out-Null }

$arguments = @(
  $relay,
  '--origin', 'http://127.0.0.1',
  '--registration-origin', 'http://www.3dprinthub.cn',
  '--state-dir', $StateDir,
  '--cad-python', $CadPython,
  '--cad-runner', $runner,
  '--port', [string]$Port,
  '--label', 'CAD-工作站'
)

if (-not $Background) {
  Write-Output '执行器启动后会显示 8 位 pairCode；保持此窗口打开。'
  & $CadPython @arguments
  exit $LASTEXITCODE
}

$process = Start-Process -FilePath $CadPython -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errorLog -PassThru
$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 300
  $listener = Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
} while (-not $listener -and -not $process.HasExited -and (Get-Date) -lt $deadline)

if (-not $listener) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  $detail = Get-Content -LiteralPath $errorLog -Raw -ErrorAction SilentlyContinue
  throw "执行器未能监听 $Port。$detail"
}
$listenerOwner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
if (-not $listenerOwner -or ([string]$listenerOwner.CommandLine).IndexOf($relay, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  throw "端口 $Port 在启动过程中被其他程序占用，已停止本次执行器。"
}
$line = Get-Content -LiteralPath $outLog -First 1 -ErrorAction SilentlyContinue
if (-not $line) { throw "执行器已监听 $Port，但启动信息未写入 $outLog。" }
$startup = try { $line | ConvertFrom-Json } catch { throw "执行器启动信息格式无效，请查看 $outLog。" }
if (-not $startup.pairCode -or -not $startup.port) { throw "执行器启动信息不完整，请查看 $outLog。" }
Write-Output ("执行器已在后台启动：PID {0}，端口 {1}，8 位配对码 {2}" -f $listener.OwningProcess, $startup.port, $startup.pairCode)
Write-Output ("配对码 10 分钟内有效。错误日志：{0}" -f $errorLog)
