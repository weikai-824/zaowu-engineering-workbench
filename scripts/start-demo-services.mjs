import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_DIR = resolve(ROOT, ".sites-runtime");
const LOCK_FILE = resolve(RUNTIME_DIR, "demo-services.lock");
const STATUS_FILE = resolve(RUNTIME_DIR, "demo-services.status.json");
const DIAGNOSTIC_LOG = resolve(RUNTIME_DIR, "demo-services.diagnostic.log");
const LOCK_MAX_AGE_MS = 10 * 60 * 1000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

mkdirSync(RUNTIME_DIR, { recursive: true });

const issues = [];
const info = (message) => console.log(message);
const errorMessage = (error) => error instanceof Error ? error.message : String(error);

function recordDiagnostic(context, detail) {
  if (!detail) return;
  try {
    appendFileSync(
      DIAGNOSTIC_LOG,
      `${new Date().toISOString()} [${context}]\n${detail.trim()}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics are best effort and must not stop service recovery.
  }
}

function addIssue(message, detail = "") {
  issues.push(message);
  recordDiagnostic(message, detail);
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(
        LOCK_FILE,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        { encoding: "utf8", flag: "wx" },
      );
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let current = null;
      try {
        current = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      } catch {
        // A malformed or partially written lock is stale.
      }
      const startedAt = Date.parse(current?.startedAt ?? "");
      const isRecent = Number.isFinite(startedAt) && Date.now() - startedAt < LOCK_MAX_AGE_MS;
      if (isRecent && isProcessRunning(Number(current?.pid))) {
        info("生成与返工服务正在由另一个后台任务检查，本次不重复执行。");
        return false;
      }
      rmSync(LOCK_FILE, { force: true });
    }
  }
  throw new Error("无法取得可选服务启动锁。");
}

function releaseLock() {
  try {
    const current = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
    if (Number(current?.pid) === process.pid) rmSync(LOCK_FILE, { force: true });
  } catch {
    // The next invocation can recover a missing or stale lock.
  }
}

function readEnvironment(file, label) {
  if (!existsSync(file)) {
    addIssue(`${label}配置文件缺失。`);
    return null;
  }
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch (error) {
    addIssue(`${label}配置无法读取。`, errorMessage(error));
    return null;
  }
}

async function healthy(url, timeoutMs = 3000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHttp(url, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  do {
    if (await healthy(url)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  } while (Date.now() < deadline);
  return false;
}

async function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolveConnection) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnection(connected);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForPort(host, port, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  do {
    if (await canConnect(host, port)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  } while (Date.now() < deadline);
  return false;
}

async function startDetached(name, command, args, environment = {}) {
  const stdout = openSync(resolve(RUNTIME_DIR, `${name}.out.log`), "a");
  const stderr = openSync(resolve(RUNTIME_DIR, `${name}.error.log`), "a");
  try {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...environment },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdout, stderr],
    });
    const started = await new Promise((resolveStarted) => {
      child.once("spawn", () => resolveStarted(true));
      child.once("error", (error) => {
        addIssue(`${name} 启动失败，请查看 .sites-runtime 日志。`, errorMessage(error));
        resolveStarted(false);
      });
    });
    if (started) child.unref();
    return started;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function runCommand(command, args, timeoutMs) {
  return spawnSync(command, args, {
    cwd: ROOT,
    windowsHide: true,
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

function commandDetail(result) {
  return [result.error && errorMessage(result.error), result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n");
}

async function ensureTripoBridge(product) {
  if (!product?.TRIPO_PROXY_BRIDGE_URL) {
    addIssue("三维生成桥接地址未配置。");
    return;
  }
  let bridge;
  try {
    bridge = new URL(product.TRIPO_PROXY_BRIDGE_URL);
  } catch (error) {
    addIssue("三维生成桥接地址格式无效。", errorMessage(error));
    return;
  }
  if (!LOCAL_HOSTS.has(bridge.hostname)) {
    addIssue("Tripo 桥接地址不是本机地址，需确认配置。");
    return;
  }
  const healthUrl = `${bridge.origin}/health`;
  if (!await healthy(healthUrl)) {
    const started = await startDetached(
      "tripo-bridge",
      process.execPath,
      [resolve(ROOT, "scripts/tripo-proxy-bridge.mjs")],
      { TRIPO_PROXY_BRIDGE_PORT: bridge.port || "17890" },
    );
    if (!started) return;
  }
  if (await waitForHttp(healthUrl, 12)) info("三维生成连接已启动。");
  else addIssue("三维生成连接未启动，请查看 tripo-bridge.error.log。");
}

function dockerIsReady() {
  const result = runCommand("docker", ["info", "--format", "{{.ServerVersion}}"], 5000);
  if (result.status === 0) return true;
  recordDiagnostic("Docker is unavailable", commandDetail(result));
  return false;
}

async function ensureAgentService(product, agent) {
  if (!product?.AGENT_SERVICE_URL || !agent) {
    addIssue("返工 Agent 配置缺失。");
    return;
  }

  let service;
  let database;
  try {
    service = new URL(product.AGENT_SERVICE_URL);
    database = new URL(agent.AGENT_DATABASE_URL);
  } catch (error) {
    addIssue("返工 Agent 地址或数据库地址格式无效。", errorMessage(error));
    return;
  }
  if (!LOCAL_HOSTS.has(service.hostname)) {
    addIssue("Agent 地址不是本机地址，需确认配置。");
    return;
  }
  if (
    !product.AGENT_SERVICE_TOKEN
    || !product.AGENT_TOOL_GATEWAY_TOKEN
    || product.AGENT_SERVICE_TOKEN !== agent.AGENT_SERVICE_TOKEN
    || product.AGENT_TOOL_GATEWAY_TOKEN !== agent.AGENT_GATEWAY_TOKEN
  ) {
    addIssue("Agent 两端连接凭据缺失或不一致。");
    return;
  }

  const liveUrl = `${service.origin}/health/live`;
  const readyUrl = `${service.origin}/health/ready`;
  if (await healthy(readyUrl)) {
    info("返工 Agent 已就绪。");
    return;
  }
  if (await healthy(liveUrl)) {
    if (await waitForHttp(readyUrl, 12)) info("返工 Agent 已就绪。");
    else addIssue("返工 Agent 已启动但尚未就绪，请查看 agent-service.error.log。");
    return;
  }

  const databasePort = Number(database.port || "5432");
  if (!Number.isInteger(databasePort) || databasePort <= 0 || databasePort > 65535) {
    addIssue("返工 Agent 数据库端口无效。");
    return;
  }
  let databaseReady = await canConnect(database.hostname, databasePort);
  const isBundledDatabase = LOCAL_HOSTS.has(database.hostname) && databasePort === 55432;
  if (!databaseReady && isBundledDatabase) {
    if (!dockerIsReady()) {
      addIssue("任务数据库未启动；请打开 Docker Desktop，工程台其他功能仍可使用。");
      return;
    }
    const result = runCommand(
      "docker",
      ["compose", "-f", "services/agent/compose.yml", "up", "-d", "--wait"],
      60000,
    );
    if (result.status !== 0) {
      addIssue("任务数据库启动失败，请查看 demo-services.diagnostic.log。", commandDetail(result));
      return;
    }
    databaseReady = await waitForPort(database.hostname, databasePort, 15);
  }
  if (!databaseReady) {
    addIssue("返工 Agent 数据库不可连接；已跳过 Agent 启动。");
    return;
  }

  const python = resolve(ROOT, "services/agent/.venv/Scripts/python.exe");
  if (!existsSync(python)) {
    addIssue("Agent Python 环境缺失，请先运行 npm run agent:sync。");
    return;
  }
  const servicePort = service.port || (service.protocol === "https:" ? "443" : "80");
  const started = await startDetached(
    "agent-service",
    python,
    ["-m", "zaowu_agent.main", "--port", servicePort],
  );
  if (!started) return;
  if (await waitForHttp(readyUrl, 30)) info("返工 Agent 已就绪。");
  else addIssue("返工 Agent 尚未就绪，请查看 agent-service.error.log。");
}

async function cadIsHealthy() {
  try {
    const response = await fetch("http://127.0.0.1:8837/status", {
      headers: { Origin: "http://127.0.0.1" },
      signal: AbortSignal.timeout(3000),
    });
    return response.status === 401
      && response.headers.get("server")?.startsWith("AI3DLocalExecutor/") === true;
  } catch {
    return false;
  }
}

async function ensureCadExecutor() {
  if (await cadIsHealthy()) {
    info("本机建模程序正在运行；请在网页恢复连接或使用配对码连接。");
    return;
  }
  const result = runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolve(ROOT, "scripts/start-local-cad-executor.ps1"),
      "-Background",
    ],
    90000,
  );
  if (result.status === 0 || await cadIsHealthy()) {
    const output = result.stdout?.trim();
    info(output || "本机建模程序已启动。");
    return;
  }
  addIssue(
    "本机建模程序未启动，请检查 CAD Python 环境；详情见 demo-services.diagnostic.log。",
    commandDetail(result),
  );
}

function writeStatus() {
  try {
    writeFileSync(
      STATUS_FILE,
      `${JSON.stringify({ updatedAt: new Date().toISOString(), ok: issues.length === 0, issues }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    recordDiagnostic("Unable to write service status", errorMessage(error));
  }
}

async function main() {
  const product = readEnvironment(resolve(ROOT, ".env.local"), "工程台");
  const agent = readEnvironment(resolve(ROOT, "services/agent/.env"), "返工 Agent");
  await ensureTripoBridge(product);
  await ensureAgentService(product, agent);
  await ensureCadExecutor();
}

let ownsLock = false;
try {
  ownsLock = acquireLock();
  if (ownsLock) await main();
} catch (error) {
  addIssue("可选服务初始化发生异常。", errorMessage(error));
} finally {
  if (ownsLock) {
    writeStatus();
    releaseLock();
  }
}

for (const issue of issues) info(`待处理：${issue}`);
if (issues.length > 0) process.exitCode = 1;
