param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}

$repoRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$domain = 'www.3dprinthub.cn'
$domainUrl = "http://$domain/"
$fallbackUrl = "http://127.0.0.1:8787/"
$appPort = 8787
$proxyPort = 80
$runtimeDir = Join-Path $repoRoot '.sites-runtime'
$launcherLog = Join-Path $runtimeDir 'launcher.log'
$appLog = Join-Path $runtimeDir 'local-demo.out.log'
$appErrorLog = Join-Path $runtimeDir 'local-demo.error.log'
$buildLog = Join-Path $runtimeDir 'local-build.out.log'
$buildErrorLog = Join-Path $runtimeDir 'local-build.error.log'
$buildFailedMarker = Join-Path $runtimeDir 'local-build.incomplete'
$proxyLog = Join-Path $runtimeDir 'local-domain-proxy.out.log'
$proxyErrorLog = Join-Path $runtimeDir 'local-domain-proxy.error.log'
$servicesLog = Join-Path $runtimeDir 'demo-services.out.log'
$servicesErrorLog = Join-Path $runtimeDir 'demo-services.error.log'
$servicesScript = Join-Path $repoRoot 'scripts/start-demo-services.mjs'
$launcherMutex = New-Object System.Threading.Mutex($false, 'Local\Zaowu3DPrintHubLauncher')
$ownsMutex = $false
$previousDemoMode = $env:LOCAL_DEMO_MODE
$buildWarning = $null

function Write-Step([int]$Number, [string]$Message) {
  Write-Output ("[{0}/5] {1}" -f $Number, $Message)
}

function Write-LauncherLog([string]$Level, [string]$Message) {
  try {
    if (-not (Test-Path -LiteralPath $runtimeDir)) {
      New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    }
    $line = "{0} [{1}] {2}`r`n" -f (Get-Date).ToUniversalTime().ToString('o'), $Level, $Message
    [IO.File]::AppendAllText($launcherLog, $line, [Text.UTF8Encoding]::new($false))
  } catch {
    # Logging must never prevent the launcher from recovering the application.
  }
}

function Get-RemainingTimeout([datetime]$Deadline, [int]$MaximumSeconds) {
  $remaining = [int][Math]::Ceiling(($Deadline - (Get-Date)).TotalSeconds)
  if ($remaining -le 0) { return 0 }
  return [Math]::Min($remaining, $MaximumSeconds)
}

function Assert-LauncherPrerequisites {
  $requiredFiles = @(
    (Join-Path $repoRoot 'package.json'),
    (Join-Path $repoRoot 'scripts/check-build-freshness.mjs'),
    (Join-Path $repoRoot 'scripts/local-domain-proxy.mjs'),
    (Join-Path $repoRoot 'node_modules/wrangler/bin/wrangler.js')
  )
  foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
      throw "启动所需文件缺失：$requiredFile"
    }
  }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { throw '未找到 Node.js，请先安装 Node.js 22 或更高版本。' }
  $nodeVersion = & $node.Source -p 'process.versions.node' 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) { throw 'Node.js 无法正常执行。' }
  $majorVersion = 0
  if (-not [int]::TryParse(([string]$nodeVersion -split '\.')[0], [ref]$majorVersion) -or $majorVersion -lt 22) {
    throw "Node.js 版本过低（当前 $nodeVersion），需要 22 或更高版本。"
  }
}

function Get-Listener([int]$Port) {
  $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
  foreach ($line in (& "$env:SystemRoot\System32\netstat.exe" -ano -p TCP 2>$null)) {
    if ($line -match $pattern) {
      return [pscustomobject]@{ LocalPort = $Port; OwningProcess = [int]$Matches[1] }
    }
  }
  return $null
}

function Wait-ForListener([int]$Port, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Get-Listener $Port) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

function Get-HttpStatus([string]$Url, [int]$TimeoutSeconds, [string]$HostHeader = '') {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { throw 'Windows curl.exe 不可用，无法执行启动健康检查。' }
  $arguments = @(
    '--noproxy', '*',
    '--silent', '--show-error',
    '--output', 'NUL',
    '--write-out', '%{http_code}',
    '--connect-timeout', '4',
    '--max-time', [string]$TimeoutSeconds
  )
  if ($HostHeader) { $arguments += @('--header', "Host: $HostHeader") }
  $arguments += $Url
  $output = & $curl.Source @arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return 0 }
  $status = 0
  if ([int]::TryParse([string]($output | Select-Object -Last 1), [ref]$status)) { return $status }
  return 0
}

function Get-HttpBody([string]$Url, [int]$TimeoutSeconds) {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { throw 'Windows curl.exe 不可用，无法执行启动健康检查。' }
  $arguments = @(
    '--noproxy', '*',
    '--silent', '--show-error', '--fail',
    '--connect-timeout', '4',
    '--max-time', [string]$TimeoutSeconds,
    $Url
  )
  $output = & $curl.Source @arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return [string]::Join("`n", @($output))
}

function Test-App([int]$TimeoutSeconds) {
  $rootUrl = "http://127.0.0.1:$appPort/"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $requestTimeout = Get-RemainingTimeout $deadline 5
  if ($requestTimeout -le 0) { return $false }
  $status = Get-HttpStatus $rootUrl $requestTimeout
  if ($status -lt 200 -or $status -ge 400) { return $false }

  $requestTimeout = Get-RemainingTimeout $deadline 5
  if ($requestTimeout -le 0) { return $false }
  $html = Get-HttpBody $rootUrl $requestTimeout
  if ([string]::IsNullOrWhiteSpace($html)) { return $false }

  $assetPattern = "(?i)(?:src|href)\s*=\s*[`"']([^`"']+\.(?:js|css)(?:\?[^`"']*)?(?:#[^`"']*)?)[`"']"
  $matches = [regex]::Matches($html, $assetPattern)
  if ($matches.Count -eq 0) { return $false }

  $assetPaths = @(
    foreach ($match in $matches) {
      $reference = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value)
      try {
        $assetUri = [Uri]::new([Uri]$rootUrl, $reference)
        $assetUri.PathAndQuery
      } catch {
        return $false
      }
    }
  ) | Sort-Object -Unique

  foreach ($assetPath in $assetPaths) {
    $requestTimeout = Get-RemainingTimeout $deadline 4
    if ($requestTimeout -le 0) { return $false }
    $assetStatus = Get-HttpStatus "http://127.0.0.1:$appPort$assetPath" $requestTimeout
    if ($assetStatus -lt 200 -or $assetStatus -ge 400) { return $false }
  }
  return $true
}

function Test-Proxy([int]$TimeoutSeconds) {
  $status = Get-HttpStatus "http://127.0.0.1:$proxyPort/" $TimeoutSeconds $domain
  return $status -eq 200
}

function Get-ProcessInfo([int]$ProcessId) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Find-OwnedAppRoot($Listener) {
  if (-not $Listener) { return $null }
  $current = Get-ProcessInfo $Listener.OwningProcess
  $workerFallback = $null
  for ($depth = 0; $depth -lt 10 -and $current; $depth++) {
    $command = [string]$current.CommandLine
    $normalizedCommand = $command.Replace('/', '\')
    $belongsToRepo = $command.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $isDev = $belongsToRepo -and $normalizedCommand -like '*scripts\run-framework.mjs*'
    $isPreview = $belongsToRepo -and $normalizedCommand -like '*wrangler*' -and $normalizedCommand -like '*dist\server\wrangler.json*'
    $isWorker = $belongsToRepo -and $current.Name -eq 'workerd.exe' -and $normalizedCommand -like "*socket-addr=entry=127.0.0.1:$appPort*"
    if ($isWorker) { $workerFallback = $current }
    if ($isDev -or $isPreview) { return $current }
    if (-not $current.ParentProcessId) { break }
    $current = Get-ProcessInfo $current.ParentProcessId
  }
  return $workerFallback
}

function Test-PreviewProcess($ProcessInfo) {
  if (-not $ProcessInfo) { return $false }
  $command = [string]$ProcessInfo.CommandLine
  $normalizedCommand = $command.Replace('/', '\')
  $isWrangler = $normalizedCommand -like '*wrangler*' -and $normalizedCommand -like '*dist\server\wrangler.json*'
  $isWorker = $ProcessInfo.Name -eq 'workerd.exe' -and $normalizedCommand -like "*socket-addr=entry=127.0.0.1:$appPort*"
  return $isWrangler -or $isWorker
}

function Find-OwnedProxy($Listener) {
  if (-not $Listener) { return $null }
  $owner = Get-ProcessInfo $Listener.OwningProcess
  if ($owner -and $owner.Name -eq 'node.exe' -and $owner.CommandLine -like '*local-domain-proxy.mjs*') { return $owner }
  return $null
}

function Test-ProxyFresh($ProcessInfo) {
  if (-not $ProcessInfo -or -not $ProcessInfo.CreationDate) { return $false }
  $source = Get-Item -LiteralPath (Join-Path $repoRoot 'scripts/local-domain-proxy.mjs')
  return $source.LastWriteTimeUtc -le ([datetime]$ProcessInfo.CreationDate).ToUniversalTime()
}

function Stop-ProcessTree([int]$ProcessId) {
  & taskkill.exe /PID $ProcessId /T /F >$null 2>&1
  Start-Sleep -Milliseconds 600
}

function Stop-AppListener {
  $listener = Get-Listener $appPort
  if (-not $listener) { return }
  $root = Find-OwnedAppRoot $listener
  if (-not $root) {
    $owner = Get-ProcessInfo $listener.OwningProcess
    throw "本机 $appPort 端口已被其他程序占用：$($owner.Name) (PID $($listener.OwningProcess))。"
  }
  Stop-ProcessTree $root.ProcessId
  $deadline = (Get-Date).AddSeconds(12)
  while ((Get-Listener $appPort) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Get-Listener $appPort) { throw "无法停止失效的工程台服务（端口 $appPort）。" }
}

function Stop-ProxyListener {
  $listener = Get-Listener $proxyPort
  if (-not $listener) { return }
  $owner = Find-OwnedProxy $listener
  if (-not $owner) {
    $process = Get-ProcessInfo $listener.OwningProcess
    throw "本机 $proxyPort 端口已被其他程序占用：$($process.Name) (PID $($listener.OwningProcess))。"
  }
  Stop-ProcessTree $owner.ProcessId
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Listener $proxyPort) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Get-Listener $proxyPort) { throw "无法停止失效的域名转发服务（端口 $proxyPort）。" }
}

function Get-BuildState([switch]$IgnoreFailedMarker) {
  if (-not $IgnoreFailedMarker -and (Test-Path -LiteralPath $buildFailedMarker)) { return 2 }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $output = @(& $node (Join-Path $repoRoot 'scripts/check-build-freshness.mjs') 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -notin @(0, 1, 2)) {
    $detail = [string]($output | Select-Object -Last 1)
    throw "无法判断演示版本是否需要重建（退出码 $exitCode）：$detail"
  }
  return $exitCode
}

function Build-Demo {
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  Write-LauncherLog 'INFO' 'Building the local demo.'
  [IO.File]::WriteAllText($buildFailedMarker, (Get-Date).ToUniversalTime().ToString('o'))
  $completed = $false
  try {
    $process = Start-Process -FilePath $npm -ArgumentList @('run', 'build') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $buildLog -RedirectStandardError $buildErrorLog -PassThru
    # Windows PowerShell 5.1 may lose ExitCode after a redirected child exits
    # unless its native process handle is captured while it is still running.
    $process.Handle | Out-Null
    if (-not $process.WaitForExit(180000)) {
      Stop-ProcessTree $process.Id
      throw "演示版本构建超过 3 分钟。请查看：$buildErrorLog"
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "演示版本构建失败（退出码 $($process.ExitCode)）。请查看：$buildErrorLog" }
    if ((Get-BuildState -IgnoreFailedMarker) -ne 0) { throw "演示版本构建失败。请查看：$buildErrorLog" }
    $completed = $true
    Write-LauncherLog 'INFO' 'Local demo build completed.'
  } finally {
    if ($completed) { Remove-Item -LiteralPath $buildFailedMarker -Force -ErrorAction SilentlyContinue }
  }
}

function Start-Preview {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $sitesEnvUrl = [System.Uri]::new((Join-Path $repoRoot 'scripts/sites-env.mjs')).AbsoluteUri
  $arguments = @(
    '--import', $sitesEnvUrl,
    (Join-Path $repoRoot 'node_modules/wrangler/bin/wrangler.js'),
    'dev',
    '--config', (Join-Path $repoRoot 'dist/server/wrangler.json'),
    '--local',
    '--persist-to', (Join-Path $repoRoot '.wrangler/state'),
    '--ip', '127.0.0.1',
    '--inspector-port', '0',
    '--port', [string]$appPort
  )
  $process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $appLog -RedirectStandardError $appErrorLog -PassThru
  return $process
}

function Start-Proxy {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $process = Start-Process -FilePath $node -ArgumentList @('scripts/local-domain-proxy.mjs') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $proxyLog -RedirectStandardError $proxyErrorLog -PassThru
  return $process
}

function Start-DemoServices {
  $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { ([string]$_.CommandLine).IndexOf($servicesScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    Select-Object -First 1
  if ($running) { return $null }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $process = Start-Process -FilePath $node -ArgumentList @($servicesScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $servicesLog -RedirectStandardError $servicesErrorLog -PassThru
  $process.Handle | Out-Null
  return $process
}

function Find-ChromiumBrowser {
  $candidates = @(
    [pscustomobject]@{ Name = 'Microsoft Edge'; Key = 'edge'; Path = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' },
    [pscustomobject]@{ Name = 'Microsoft Edge'; Key = 'edge'; Path = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' },
    [pscustomobject]@{ Name = 'Microsoft Edge'; Key = 'edge'; Path = (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe') },
    [pscustomobject]@{ Name = 'Google Chrome'; Key = 'chrome'; Path = 'C:\Program Files\Google\Chrome\Application\chrome.exe' },
    [pscustomobject]@{ Name = 'Google Chrome'; Key = 'chrome'; Path = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' },
    [pscustomobject]@{ Name = 'Google Chrome'; Key = 'chrome'; Path = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe') }
  )
  return $candidates | Where-Object { $_.Path -and (Test-Path -LiteralPath $_.Path -PathType Leaf) } | Select-Object -First 1
}

function Open-DemoBrowser {
  $browser = Find-ChromiumBrowser
  if (-not $browser) {
    Write-LauncherLog 'WARN' 'No supported Chromium browser was found; opening the loopback URL with the default browser.'
    Start-Process $fallbackUrl | Out-Null
    return [pscustomobject]@{ Url = $fallbackUrl; UsedFallback = $true }
  }

  $profile = Join-Path $env:TEMP ("3dprinthub-local-demo-{0}-v3" -f $browser.Key)
  $hostResolverRule = "--host-resolver-rules=`"MAP $domain 127.0.0.1, EXCLUDE localhost`""
  try {
    $process = Start-Process -FilePath $browser.Path -ArgumentList @(
      "--user-data-dir=$profile",
      $hostResolverRule,
      '--no-proxy-server',
      '--no-first-run',
      '--start-maximized',
      '--new-window',
      $domainUrl
    ) -PassThru
    Start-Sleep -Milliseconds 750
    $process.Refresh()
    if ($process.HasExited -and $process.ExitCode -ne 0) {
      throw "$($browser.Name) 启动后异常退出（退出码 $($process.ExitCode)）。"
    }
    return [pscustomobject]@{ Url = $domainUrl; UsedFallback = $false }
  } catch {
    Write-LauncherLog 'WARN' ("Chromium launch failed; using the loopback URL. {0}" -f $_.Exception.Message)
    Start-Process $fallbackUrl | Out-Null
    return [pscustomobject]@{ Url = $fallbackUrl; UsedFallback = $true }
  }
}

try {
  try { $ownsMutex = $launcherMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) {
    Write-Output '工程台正在由另一个窗口启动，本次点击不再重复执行。'
    Write-LauncherLog 'INFO' 'Ignored a duplicate launcher invocation.'
    exit 0
  }

  if (-not (Test-Path -LiteralPath $runtimeDir)) { New-Item -ItemType Directory -Path $runtimeDir | Out-Null }
  Write-LauncherLog 'INFO' 'Launcher started.'
  Assert-LauncherPrerequisites
  $env:LOCAL_DEMO_MODE = 'true'

  Write-Step 1 '检查演示版本'
  $buildState = Get-BuildState
  $buildCompleted = $false
  if ($buildState -ne 0) {
    Write-Output '      源码已有更新，正在构建当前演示版本，通常需要 20–60 秒…'
    # workerd keeps the built bundle open on Windows. Stop only this checkout's
    # verified preview before vinext replaces dist/; otherwise clean-output can
    # fail with EPERM even though the source and build are valid.
    if (Get-Listener $appPort) { Stop-AppListener }
    Build-Demo
    $buildCompleted = $true
    Write-Output '      演示版本构建完成。'
  } else {
    Write-Output '      演示版本已是最新。'
  }

  Write-Step 2 '检查工程台服务'
  $appListener = Get-Listener $appPort
  if ($buildCompleted -and $appListener) {
    Stop-AppListener
    $appListener = $null
  }
  $appRoot = Find-OwnedAppRoot $appListener
  $canReuse = $appListener -and $appRoot -and (Test-PreviewProcess $appRoot) -and (Test-App 6)
  if (-not $canReuse -and $appListener) { Stop-AppListener }

  if ($canReuse) {
    Write-Output '      已复用正在运行的演示服务。'
  } else {
    $preview = Start-Preview
    if (-not (Wait-ForListener $appPort 35)) {
      if (-not $preview.HasExited) { Stop-ProcessTree $preview.Id }
      throw "演示服务未能监听 $appPort 端口。请查看：$appErrorLog"
    }
    if ($preview.HasExited) {
      throw "演示服务启动后提前退出。请查看：$appErrorLog"
    }
  }

  Write-Step 3 '检查首页响应'
  if (-not (Test-App 20)) {
    Stop-AppListener
    throw "演示服务已启动但首页无响应。请查看：$appErrorLog"
  }
  Write-Output '      首页已就绪。'

  Write-Step 4 '检查本地域名转发'
  $proxyListener = Get-Listener $proxyPort
  $proxyOwner = Find-OwnedProxy $proxyListener
  if ($proxyListener -and -not $proxyOwner) {
    $owner = Get-ProcessInfo $proxyListener.OwningProcess
    throw "本机 $proxyPort 端口已被其他程序占用：$($owner.Name) (PID $($proxyListener.OwningProcess))。"
  }
  if ($proxyListener -and ((-not (Test-Proxy 5)) -or (-not (Test-ProxyFresh $proxyOwner)))) {
    Stop-ProxyListener
    $proxyListener = $null
  }
  if (-not $proxyListener) {
    $proxy = Start-Proxy
    if (-not (Wait-ForListener $proxyPort 12) -or -not (Test-Proxy 8)) {
      if ($proxy -and -not $proxy.HasExited) { Stop-ProcessTree $proxy.Id }
      throw "本地域名转发器启动失败。请查看：$proxyErrorLog"
    }
  }
  Write-Output '      本地域名转发已就绪。'

  Write-Step 5 '在后台启动生成与返工服务'
  try {
    $services = Start-DemoServices
    if ($services) {
      Start-Sleep -Milliseconds 150
      $services.Refresh()
      if ($services.HasExited -and $services.ExitCode -ne 0) {
        Write-Output "      部分可选服务未就绪，不影响工程台打开。详情：$servicesLog"
      } elseif ($services.HasExited) {
        Write-Output "      可选服务检查已完成。详情：$servicesLog"
      } else {
        Write-Output "      后台初始化已开始，不再阻塞工程台。详情：$servicesLog"
      }
    } else {
      Write-Output '      后台初始化正在运行，不重复启动。'
    }
  } catch {
    Write-Output '      可选服务未能启动，不影响工程台打开。'
    Write-LauncherLog 'WARN' ("Optional services could not be started. {0}" -f $_.Exception.Message)
  }
  if ($NoBrowser) {
    Write-Output "工程台已就绪：$domainUrl"
    Write-LauncherLog 'INFO' 'Launcher completed without opening a browser.'
    exit 0
  }
  $browserResult = Open-DemoBrowser
  if ($browserResult.UsedFallback) {
    Write-Output "启动成功（已使用本机地址回退）：$($browserResult.Url)"
  } else {
    Write-Output "启动成功：$($browserResult.Url)"
  }
  if ($buildWarning) { Write-Output "注意：新版本构建失败，本次打开的是仍可用的旧版本。详情：$buildErrorLog" }
  Write-LauncherLog 'INFO' ("Launcher completed. URL={0}" -f $browserResult.Url)
} catch {
  Write-LauncherLog 'ERROR' ("{0} | {1}" -f $_.Exception.Message, $_.ScriptStackTrace)
  Write-Output ''
  Write-Output ("启动失败：{0}" -f $_.Exception.Message)
  Write-Output "启动器日志：$launcherLog"
  Write-Output "应用日志：$appErrorLog"
  Write-Output "构建日志：$buildErrorLog"
  Write-Output "代理日志：$proxyErrorLog"
  Write-Output "可选服务日志：$servicesLog"
  exit 1
} finally {
  if ($null -eq $previousDemoMode) {
    Remove-Item Env:LOCAL_DEMO_MODE -ErrorAction SilentlyContinue
  } else {
    $env:LOCAL_DEMO_MODE = $previousDemoMode
  }
  if ($ownsMutex) {
    try { $launcherMutex.ReleaseMutex() } catch {}
  }
  $launcherMutex.Dispose()
}
