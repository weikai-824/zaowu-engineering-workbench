// 临时安装引导脚本：绕开 git-bash 的 npm shim 重定向问题。
// 设置 npm_execpath 后直接调用项目自带的 install-ci.mjs。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const npmCli = "D:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

process.env.npm_execpath = npmCli;
process.env.npm_node_execpath = process.execPath;

const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./install-ci.mjs", import.meta.url))],
  { stdio: "inherit", cwd: projectRoot, env: process.env },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
