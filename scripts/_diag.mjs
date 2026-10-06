// 临时诊断脚本：用 Node 直接检查 node_modules 真实状态
import { readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
const nm = path.join(root, "node_modules");

if (!existsSync(nm)) {
  console.log("node_modules NOT EXISTS");
  process.exit(1);
}

const entries = readdirSync(nm);
console.log("node_modules 存在");
console.log("顶层条目总数:", entries.length);

const checks = [
  "typescript/bin/tsc.js",
  "typescript/lib/typescript.js",
  "vite/bin/vite.js",
  "vinext/dist/cli.js",
  "wrangler/bin/wrangler.js",
  "next/package.json",
  "react/package.json",
  "zod/package.json",
  ".package-lock.json",
  ".bin",
];

console.log("\n关键路径检查:");
for (const c of checks) {
  const p = path.join(nm, c);
  if (existsSync(p)) {
    const st = statSync(p);
    console.log(`  OK   ${c} (${st.isDirectory() ? "dir" : st.size + "B"})`);
  } else {
    console.log(`  MISS ${c}`);
  }
}

// 统计顶层目录数 + 文件数
let dirs = 0, files = 0, scoped = 0;
for (const e of entries) {
  try {
    if (e.startsWith("@")) { scoped++; continue; }
    const st = statSync(path.join(nm, e));
    if (st.isDirectory()) dirs++; else files++;
  } catch {}
}
console.log(`\n统计: 目录=${dirs} 文件=${files} scope包=${scoped}`);

// 采样 scoped 包
const scopedNames = entries.filter(e => e.startsWith("@"));
console.log("scope 目录:", scopedNames.join(", ").slice(0, 300));
