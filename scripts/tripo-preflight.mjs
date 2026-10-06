import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function envFile() {
  if (!existsSync(".env.local")) return {};
  return Object.fromEntries(readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^(['"])(.*)\1$/, "$2")]));
}

const values = envFile();
const key = values.TRIPO_API_KEY?.trim();
const region = values.TRIPO_REGION?.trim() || "global";
const checkedAt = new Date().toISOString();
const report = (status, details = {}) => {
  console.log(JSON.stringify({ status, region, checkedAt, ...details }));
  process.exitCode = status === "callable" ? 0 : 1;
};

async function requestBalance(origin) {
  if (process.platform !== "win32") {
    const response = await fetch(`${origin}/account/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, body: response.ok ? await response.json() : null };
  }

  // Windows PowerShell can use the host's configured network path when Node's
  // undici fetch cannot see it. The key is passed only through the child env.
  const script = [
    "$ErrorActionPreference='Stop'",
    "try {",
    "  $r=Invoke-WebRequest -Uri $env:TRIPO_PREFLIGHT_URL -Headers @{Authorization=('Bearer '+$env:TRIPO_PREFLIGHT_KEY);Accept='application/json'} -Method Get -MaximumRedirection 0 -TimeoutSec 20",
    "  Write-Output ('PREFLIGHT_STATUS='+$r.StatusCode)",
    "  Write-Output $r.Content",
    "} catch {",
    "  $status=$_.Exception.Response.StatusCode.value__",
    "  if($status){ Write-Output ('PREFLIGHT_STATUS='+$status) } else { throw }",
    "}",
  ].join(";");
  const result = spawnSync("pwsh.exe", [
    "-NoProfile", "-NonInteractive", "-Command", script,
  ], {
    encoding: "utf8",
    env: { ...process.env, TRIPO_PREFLIGHT_URL: `${origin}/account/balance`, TRIPO_PREFLIGHT_KEY: key },
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error("powershell_request_failed");
  const output = result.stdout.trim();
  const marker = output.indexOf("PREFLIGHT_STATUS=");
  if (marker < 0) throw new Error("missing_http_status");
  const lineEnd = output.indexOf("\n", marker);
  const statusMarker = "PREFLIGHT_STATUS=";
  const status = Number(output.slice(marker + statusMarker.length, lineEnd < 0 ? undefined : lineEnd).trim());
  const bodyText = lineEnd < 0 ? "" : output.slice(lineEnd + 1).trim();
  return { status, body: bodyText ? JSON.parse(bodyText) : null };
}

if (!key) {
  report("not_configured", { message: "TRIPO_API_KEY is absent from .env.local." });
} else if (!['global', 'china'].includes(region)) {
  report("configuration_error", { message: "TRIPO_REGION must be global or china." });
} else {
  const origin = region === "china"
    ? "https://openapi.tripo3d.com/v3"
    : "https://openapi.tripo3d.ai/v3";
  try {
    const response = await requestBalance(origin);
    if (response.status === 401 || response.status === 403) {
      report("invalid_key", { httpStatus: response.status });
    } else if (response.status < 200 || response.status >= 300) {
      report(response.status >= 500 ? "provider_unreachable" : "provider_rejected", { httpStatus: response.status });
    } else {
      const body = response.body;
      const balance = body?.data?.balance;
      const frozen = body?.data?.frozen;
      if (body?.code !== 0 || !Number.isFinite(balance) || !Number.isFinite(frozen)) {
        report("provider_response_error", { httpStatus: response.status });
      } else if (balance <= frozen || balance <= 0) {
        report("quota_insufficient", { httpStatus: response.status, balance, frozen });
      } else {
        report("callable", { httpStatus: response.status, balance, frozen });
      }
    }
  } catch (error) {
    report("provider_unreachable", { message: error instanceof Error ? error.name : "network_error" });
  }
}
