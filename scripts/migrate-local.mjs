import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "./sites-env.mjs";

const configPath = path.join(projectRoot, "dist", "server", "wrangler.json");
const statePath = path.join(projectRoot, ".wrangler", "state");
const migrationDir = path.join(projectRoot, "drizzle");
const checkOnly = process.argv.includes("--check");

function fail(message) {
  console.error(`Local D1 ${checkOnly ? "check" : "migration"} failed: ${message}`);
  process.exitCode = 1;
}

if (!existsSync(configPath)) {
  fail("dist/server/wrangler.json is missing; run npm run build first.");
} else {
  const wrangler = "./node_modules/wrangler/bin/wrangler.js";
  const baseArgs = [
    "d1", "execute", "DB", "--local", "--config", configPath,
    "--persist-to", statePath,
  ];

  function execute(args, capture = false) {
    const result = spawnSync(process.execPath, [
      "--import", "./scripts/sites-env.mjs",
      wrangler, ...baseArgs, ...args,
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error((result.stderr || "Wrangler exited with a non-zero status.").trim());
    }
    return result.stdout ?? "";
  }

  function query(sql) {
    const output = execute(["--command", sql, "--json"], true).trim();
    const parsed = JSON.parse(output);
    return parsed.flatMap((item) => item.results ?? []);
  }

  try {
    const migrationFiles = readdirSync(migrationDir)
      .filter((name) => /^\d+_.+\.sql$/i.test(name))
      .sort();
    if (!migrationFiles.length) throw new Error("No Drizzle SQL migrations were found.");

    const migrationTable = "__site_creator_migrations";
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    if (!checkOnly) {
      execute(["--command", `CREATE TABLE IF NOT EXISTS ${migrationTable} (migration_id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`]);
    }

    const tables = new Set(query("SELECT name FROM sqlite_master WHERE type='table'")
      .map((row) => row.name));
    const applied = new Set(tables.has(migrationTable)
      ? query(`SELECT migration_id FROM ${migrationTable}`).map((row) => row.migration_id)
      : []);

    for (const filename of migrationFiles) {
      const migrationId = filename.slice(0, -4);
      const sql = readFileSync(path.join(migrationDir, filename), "utf8");
      const requiredTables = [...sql.matchAll(/CREATE TABLE\s+`([^`]+)`/gi)]
        .map((match) => match[1]);
      if (!requiredTables.length) throw new Error(`${filename} has no CREATE TABLE marker.`);
      const present = requiredTables.filter((name) => tables.has(name));

      if (applied.has(migrationId)) {
        console.log(`already tracked: ${filename}`);
        continue;
      }
      if (present.length === requiredTables.length) {
        if (!checkOnly) {
          execute(["--command", `INSERT INTO ${migrationTable} (migration_id, applied_at) VALUES (${quote(migrationId)}, ${quote(new Date().toISOString())})`]);
        }
        console.log(`already applied, recorded: ${filename}`);
        continue;
      }
      if (present.length) {
        throw new Error(`${filename} has a partial schema (${present.join(", ")}); refusing to replay it.`);
      }
      if (checkOnly) {
        console.log(`pending: ${filename}`);
        continue;
      }

      console.log(`applying: ${filename}`);
      execute(["--file", path.join(migrationDir, filename)]);
      execute(["--command", `INSERT INTO ${migrationTable} (migration_id, applied_at) VALUES (${quote(migrationId)}, ${quote(new Date().toISOString())})`]);
      requiredTables.forEach((name) => tables.add(name));
    }

    const finalTables = new Set(query("SELECT name FROM sqlite_master WHERE type='table'").map((row) => row.name));
    const expected = migrationFiles.flatMap((filename) => {
      const sql = readFileSync(path.join(migrationDir, filename), "utf8");
      return [...sql.matchAll(/CREATE TABLE\s+`([^`]+)`/gi)].map((match) => match[1]);
    });
    const missing = expected.filter((name) => !finalTables.has(name));
    if (missing.length) throw new Error(`Missing tables after migration check: ${missing.join(", ")}`);
    console.log(checkOnly ? "Local D1 schema is ready." : "Local D1 migrations are up to date.");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
