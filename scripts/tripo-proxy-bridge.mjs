import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { ProxyAgent, fetch } from "undici";

const listenHost = process.env.TRIPO_PROXY_BRIDGE_HOST || "127.0.0.1";
const listenPort = Number(process.env.TRIPO_PROXY_BRIDGE_PORT || 17890);
const localProxy = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8").match(/^\s*TRIPO_PROXY_URL\s*=\s*(.*?)\s*$/m)?.[1]?.trim()
  : "";
const proxyUrl = process.env.TRIPO_PROXY_URL || localProxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const allowedHost = (host) => host === "openapi.tripo3d.ai" || host === "openapi.tripo3d.com"
  || host === "cdn.tripo3d.ai" || host === "cdn.tripo3d.com"
  || host === "tripo-data.rg1.data.tripo3d.com";
const aiEndpoint = (() => {
  try {
    const base = process.env.AI_BASE_URL?.replace(/\/$/, "");
    if (!base) return null;
    const endpoint = new URL(`${base}/chat/completions`);
    return endpoint.protocol === "https:" ? endpoint.href : null;
  } catch { return null; }
})();

function readJson(request, limit = 202 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.byteLength;
      if (size > limit) {
        request.destroy();
        reject(new Error("bridge_request_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("bridge_request_invalid")); }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "tripo-bridge" }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/fetch") {
    response.writeHead(404).end();
    return;
  }
  try {
    const input = await readJson(request);
    const target = new URL(String(input.url));
    const aiRequest = aiEndpoint && target.href === aiEndpoint && input.method === "POST";
    if (target.protocol !== "https:" || (!allowedHost(target.hostname.toLowerCase()) && !aiRequest)) {
      response.writeHead(403).end("forbidden_target");
      return;
    }
    const headers = input.headers && typeof input.headers === "object" ? input.headers : {};
    const body = typeof input.bodyBase64 === "string" ? Buffer.from(input.bodyBase64, "base64")
      : typeof input.body === "string" ? input.body : undefined;
    const upstream = await fetch(target.href, {
      method: typeof input.method === "string" ? input.method : "GET",
      headers,
      body,
      redirect: "manual",
      ...(dispatcher ? { dispatcher } : {}),
      signal: AbortSignal.timeout(120_000),
    });
    const passthrough = {};
    for (const name of ["content-type", "content-length", "location", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) passthrough[name] = value;
    }
    response.writeHead(upstream.status, passthrough);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
    else response.end();
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json", "x-tripo-bridge-error": "1" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.name : "bridge_error" }));
  }
});

server.listen(listenPort, listenHost, () => {
  console.log(`Tripo local proxy bridge listening on http://${listenHost}:${listenPort}`);
});

const shutdown = () => { dispatcher?.close(); server.close(() => process.exit(0)); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
