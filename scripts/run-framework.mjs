import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localTripoProxy } from "./sites-env.mjs";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");

// Node reads NODE_USE_ENV_PROXY before startup. Re-exec once so local
// Miniflare/Vite fetches can use the Windows proxy configured for this project.
if (localTripoProxy && process.env.SITES_LOCAL_PROXY_BOOTSTRAPPED !== "1") {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), command, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      HTTPS_PROXY: process.env.HTTPS_PROXY || localTripoProxy,
      https_proxy: process.env.https_proxy || localTripoProxy,
      NODE_USE_ENV_PROXY: "1",
      SITES_LOCAL_PROXY_BOOTSTRAPPED: "1",
    },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Serve topology checks from the same origin. Vinext currently rewrites
// new URL(worker, import.meta.url) to a file:// URL in production.
const { build: buildWorker } = await import("esbuild");
await buildWorker({
  entryPoints: [fileURLToPath(new URL("../workers/topology.worker.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../public/topology-worker.js", import.meta.url)),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  logLevel: "silent",
});

const managedLinux = readExecutionProfile() === "managed-linux";

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
