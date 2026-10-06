import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const runtimeRoot = process.env.SITES_RUNTIME_ROOT || path.join(projectRoot, ".sites-runtime");

function localEnv(name) {
  try {
    const line = readFileSync(path.join(projectRoot, ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((value) => new RegExp(`^\\s*${name}\\s*=`).test(value));
    return line?.replace(new RegExp(`^\\s*${name}\\s*=`), "").trim()
      .replace(/^(['"])(.*)\\1$/, "$2") || "";
  } catch {
    return "";
  }
}

// Local Node/Miniflare fetch does not automatically inherit Windows' Internet
// Settings proxy. Keep the proxy opt-in and local-only; production secrets do
// not need this setting.
export const localTripoProxy = process.env.TRIPO_PROXY_URL || localEnv("TRIPO_PROXY_URL");
export const localDemoMode = process.env.LOCAL_DEMO_MODE || localEnv("LOCAL_DEMO_MODE");
if (localDemoMode) process.env.LOCAL_DEMO_MODE ||= localDemoMode;

// The generated Wrangler config lives under dist/server, so its default
// dotenv search path is not the project root. Load the local server-side
// provider and Agent service settings from the existing ignored .env.local file.
for (const name of ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_VISION_MODEL", "AI_PROVIDER", "TRIPO_API_KEY", "TRIPO_REGION", "TRIPO_DOWNLOAD_HOSTS", "TRIPO_PROXY_URL", "TRIPO_PROXY_BRIDGE_URL", "AGENT_SERVICE_URL", "AGENT_SERVICE_TOKEN", "AGENT_TOOL_GATEWAY_TOKEN"]) {
  const value = process.env[name] || localEnv(name);
  if (value) process.env[name] ||= value;
}

const tripoProxy = localTripoProxy;
if (tripoProxy) {
  process.env.TRIPO_PROXY_URL ||= tripoProxy;
  // TRIPO_PROXY_URL is consumed explicitly by lib/tripo-provider.ts. Do not
  // promote this provider-specific setting to HTTPS_PROXY: doing so routes
  // product-to-Agent localhost requests through the Tripo proxy as well, and
  // a stale proxy then makes every Agent request wait for the full timeout.
  const localBypass = ["127.0.0.1", "localhost", "www.3dprinthub.cn"];
  for (const name of ["NO_PROXY", "no_proxy"]) {
    const entries = new Set(
      (process.env[name] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    for (const value of localBypass) entries.add(value);
    process.env[name] = [...entries].join(",");
  }
}

process.env.CLOUDFLARE_CF_FETCH_ENABLED ||= "false";
process.env.WRANGLER_SEND_METRICS ||= "false";
process.env.WRANGLER_WRITE_LOGS ||= "false";
process.env.WRANGLER_LOG_PATH ||= path.join(runtimeRoot, "wrangler/logs");
process.env.WRANGLER_REGISTRY_PATH ||= path.join(runtimeRoot, "wrangler/dev-registry");
process.env.MINIFLARE_REGISTRY_PATH ||= path.join(runtimeRoot, "wrangler/registry");

process.chdir(projectRoot);
for (const directory of [
  path.dirname(process.env.WRANGLER_LOG_PATH),
  process.env.WRANGLER_REGISTRY_PATH,
  process.env.MINIFLARE_REGISTRY_PATH,
]) {
  mkdirSync(directory, { recursive: true });
}
