// 判断 dist/ 是否还跟当前源码树对得上，供一键启动脚本决定要不要重建。
//
// 退出码：0 = 产物是最新的（可以跳过构建）
//         1 = 源码比产物新（需要重新构建）
//         2 = 从来没构建过，或产物不完整
//
// 为什么需要它：npm run start 跑的是 dist 快照，不热更新。改完 app/ 下的代码
// 不重建就会一直看到旧界面；而每次都无条件构建又要白等约 50 秒。
//
// 输出刻意只用 ASCII：调用方是 chcp 936 的 GBK 批处理控制台，node 往控制台写
// UTF-8 中文会显示成乱码，所以中文提示一律交给批处理自己 echo。
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const serverDir = path.join(root, "dist/server");
const clientDir = path.join(root, "dist/client");
const artifact = path.join(serverDir, "wrangler.json");
const requiredArtifacts = [
  "dist/server/wrangler.json",
  "dist/server/index.js",
  "dist/server/BUILD_ID",
  "dist/server/vinext-client-assets.js",
  "dist/server/.vite/manifest.json",
  "dist/client/vinext-client-entry-manifest.json",
  "dist/client/.vite/manifest.json",
];

// 这些目录/文件里任何一处变新，都视为产物过期。
const WATCH_DIRS = ["app", "components", "lib", "db", "workers", "build", "hooks", "scripts"];
const WATCH_FILES = ["package.json", "package-lock.json", "vite.config.ts", "next.config.ts", "tsconfig.json"];
const WATCH_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|css|json|sql)$/;
const SKIP_FILES = new Set([
  path.normalize("scripts/check-build-freshness.mjs"),
  path.normalize("scripts/local-domain-proxy.mjs"),
  path.normalize("scripts/start-demo-services.mjs"),
]);

function report(tag, detail) {
  console.log(detail ? `${tag}: ${detail}` : tag);
}

function incomplete(detail) {
  report("INCOMPLETE", detail);
  process.exit(2);
}

function requireNonEmptyFile(relative) {
  try {
    const stats = statSync(path.join(root, relative));
    if (!stats.isFile() || stats.size === 0) incomplete(relative);
    return stats;
  } catch {
    incomplete(relative);
  }
}

function readJson(relative) {
  requireNonEmptyFile(relative);
  try {
    return JSON.parse(readFileSync(path.join(root, relative), "utf8"));
  } catch {
    incomplete(`${relative} (invalid json)`);
  }
}

function resolveClientAsset(reference) {
  if (typeof reference !== "string" || reference.length === 0) return null;
  const pathname = reference.split(/[?#]/, 1)[0].replace(/^[\\/]+/, "");
  const candidate = path.resolve(clientDir, pathname);
  const relative = path.relative(clientDir, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return { candidate, relative: path.join("dist/client", relative) };
}

function requireClientAsset(reference) {
  const resolved = resolveClientAsset(reference);
  if (!resolved) incomplete("invalid client asset path");
  try {
    const stats = statSync(resolved.candidate);
    if (!stats.isFile() || stats.size === 0) incomplete(resolved.relative);
  } catch {
    incomplete(resolved.relative);
  }
}

for (const relative of requiredArtifacts) requireNonEmptyFile(relative);

const wrangler = readJson("dist/server/wrangler.json");
if (typeof wrangler?.assets?.directory !== "string") {
  incomplete("dist/server/wrangler.json (missing assets.directory)");
}
const configuredClientDir = path.resolve(serverDir, wrangler.assets.directory);
const sameClientDir = process.platform === "win32"
  ? configuredClientDir.toLowerCase() === clientDir.toLowerCase()
  : configuredClientDir === clientDir;
if (!sameClientDir) incomplete("dist/server/wrangler.json (unexpected assets.directory)");

const clientEntry = readJson("dist/client/vinext-client-entry-manifest.json");
requireClientAsset(clientEntry?.appBrowserEntry);

readJson("dist/server/.vite/manifest.json");
readJson("dist/client/.vite/manifest.json");

// vinext 在 client 构建完成后才写入这份映射。把其中声明的每个 JS/CSS
// 都对回磁盘，防止“server 已写出、client 仍为空”被误判为可启动。
let clientAssets;
try {
  const source = readFileSync(path.join(serverDir, "vinext-client-assets.js"), "utf8");
  const match = /^\s*export\s+default\s+([\s\S]*?);?\s*$/.exec(source);
  if (!match) throw new Error("missing default export");
  clientAssets = JSON.parse(match[1]);
} catch {
  incomplete("dist/server/vinext-client-assets.js (invalid manifest)");
}

const referencedAssets = new Set();
const collectAssets = (value) => {
  if (typeof value === "string") {
    if (/\.(?:js|css)(?:[?#].*)?$/i.test(value)) referencedAssets.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssets(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectAssets(item);
  }
};
collectAssets(clientAssets);
if (referencedAssets.size === 0) incomplete("dist/server/vinext-client-assets.js (no assets)");
for (const reference of referencedAssets) requireClientAsset(reference);

const builtAt = statSync(artifact).mtimeMs;

let newestAt = 0;
let newestFile = null;
const remember = (candidate, at) => {
  if (at > newestAt) {
    newestAt = at;
    newestFile = candidate;
  }
};

for (const file of WATCH_FILES) {
  try {
    remember(file, statSync(path.join(root, file)).mtimeMs);
  } catch {
    // 可选文件，不存在就跳过
  }
}

const stack = WATCH_DIRS.map((name) => path.join(root, name));
while (stack.length > 0) {
  const dir = stack.pop();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      stack.push(full);
    } else if (WATCH_EXT.test(entry.name)) {
      const relative = path.relative(root, full);
      if (!SKIP_FILES.has(relative)) remember(relative, statSync(full).mtimeMs);
    }
  }
}

if (newestAt > builtAt) {
  // 路径理论上都是 ASCII；真出现中文名就退化成占位符，避免乱码污染提示。
  report("STALE", /^[\x20-\x7e]+$/.test(newestFile) ? newestFile : "(path has non-ascii)");
  process.exit(1);
}

report("UP-TO-DATE");
process.exit(0);
