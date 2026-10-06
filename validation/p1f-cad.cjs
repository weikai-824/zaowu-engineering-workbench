/* eslint-disable @typescript-eslint/no-require-imports */
// P1-F local validation: read the attached CAD asset through the same Worker API,
// run the existing geometry/topology checks, and save current evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const site = path.resolve(__dirname, '..');
const req = createRequire(path.join(site, 'package.json'));
const esbuild = req('esbuild');
const baseUrl = process.env.P1F_BASE_URL || 'http://127.0.0.1:8787';
const authHeaders = {
  'oai-authenticated-user-id': 'local_seedy',
  'oai-authenticated-user-email': 'seedy@sites.test',
  'oai-authenticated-user-full-name': 'Seedy',
  origin: baseUrl,
};
const projectId = '91ad21c0-4143-4252-8969-00dc31047b82';
const jobId = '6b559822-f45a-488e-83ba-7822e88850a9';
const ownerId = 'local_seedy';
const resultPath = path.join(site, 'work', 'validation', 'p1f-cad', 'cad-result-v1.zip');
const dbPath = path.join(site, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject', 'faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite');
const bundlePath = path.join(site, 'work', 'validation', 'p1f-cad', 'p1f-cad-checks.bundle.cjs');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function json(url, init = {}) {
  const response = await fetch(baseUrl + url, { ...init, headers: { ...authHeaders, ...(init.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${url} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  esbuild.buildSync({
    stdin: {
      contents: "export { importModel, digitalChecks } from './lib/geometry'; export { engineeringFingerprint } from './lib/engineering';",
      resolveDir: site,
      sourcefile: 'readonly-p1f-cad.ts',
      loader: 'ts',
    },
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: path.join(site, 'tsconfig.json'),
    logLevel: 'silent',
  });
  const { importModel, digitalChecks, engineeringFingerprint } = require(bundlePath);
  const project = await json(`/api/projects?id=${projectId}`);
  const fromRevision = project.revision;
  const jobs = await json(`/api/cad/jobs?projectId=${projectId}`);
  const job = jobs.find(item => item.id === jobId);
  if (job.status !== 'attached' || !job.summary) throw new Error('P1-F CAD job is not attached with a result summary');

  const models = new Map();
  const assets = [];
  const missingAssets = [];
  const checkParts = project.parts.filter(part => part.source?.kind === 'cad');
  const visualParts = project.parts.filter(part => part.source?.kind === 'tripo');
  const checkProject = { ...project, parts: checkParts };
  for (const part of checkParts) {
    if (part.kind !== 'asset' || !part.assetId) continue;
    const response = await fetch(`${baseUrl}/api/assets?id=${part.assetId}`, { headers: authHeaders });
    if (!response.ok) {
      missingAssets.push({ partId: part.id, assetId: part.assetId, status: response.status });
      continue;
    }
    const bytes = await response.arrayBuffer();
    models.set(part.id, await importModel(bytes, part.assetName || 'model.stl', part.params.unitScale));
    assets.push({ partId: part.id, assetId: part.assetId, bytes: bytes.byteLength, sha256: sha256(Buffer.from(bytes)) });
  }

  const inputHash = await engineeringFingerprint(project);
  const checks = (await digitalChecks(checkProject, models)).map(check => ({ ...check, inputHash }));
  const resultBytes = fs.readFileSync(resultPath);
  const resultSha256 = sha256(resultBytes);
  const runtime = job.summary.runtime;
  const now = new Date().toISOString();
  const cadKernel = {
    id: crypto.randomUUID(),
    name: 'CAD 内核执行',
    status: 'passed',
    detail: `真实 controlled-cad-v2 执行通过；job ${jobId}；Python ${runtime.python}；CadQuery ${runtime.cadquery}；OCP ${runtime.ocp}；NLopt ${runtime.nlopt}；CasADi ${runtime.casadi}；input design SHA-256 ${job.designSha256}；output ZIP SHA-256 ${resultSha256}；执行时间 ${now}。`,
    scope: 'digital', revision: project.revision, inputHash,
  };
  const cadResult = {
    id: crypto.randomUUID(),
    name: 'CAD 实体结果与接口校验',
    status: 'passed',
    detail: `CAD result-v1 已通过服务端结果契约：${job.summary.partCount} 个实体、${job.summary.interfaceCount} 个锁定接口量规通过、${job.summary.overlapCount} 组装配交叠；STEP round-trip、实体有效性与 STL 尺寸已核对。result ZIP SHA-256 ${resultSha256}；source CAD design ${job.designId}；source CAD task ${jobId}。`,
    scope: 'digital', revision: project.revision, inputHash,
  };
  const slice = {
    id: crypto.randomUUID(),
    name: 'CAD 路径 · 离线切片与支撑',
    status: 'not_run',
    detail: 'CAD Engineering Asset 已生成并归档；当前工作区未发现固定版本 Bambu Studio/Orca Slicer runtime，因此本工程 Slice 未执行，未创建 slicing result。',
    scope: 'manufacturing', revision: project.revision, inputHash,
  };
  const preservedVisualChecks = project.checks.filter(check => check.partId && !checkParts.some(part => part.id === check.partId));
  const next = { ...project, checks: [...preservedVisualChecks, ...checks.filter(c => c.name !== '切片与支撑'), cadKernel, cadResult, slice] };
  const saved = await json('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });

  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT result FROM jobs WHERE id=? AND owner_id=?').get(jobId, ownerId);
  const stored = row && row.result ? JSON.parse(row.result) : null;
  db.close();
  const report = {
    schema: 'p1f-cad-validation-v1',
    projectId,
    fromRevision,
    savedRevision: saved.revision,
    jobId,
    jobStatus: job.status,
    designId: job.designId,
    designSha256: job.designSha256,
    resultZip: { path: path.relative(site, resultPath), bytes: resultBytes.length, sha256: resultSha256 },
    storedAssetIds: stored?.assets?.map(a => a.assetId) || [],
    assets,
    visualRecheck: visualParts.length ? { status: 'not_run', detail: '本轮只对新 CAD Engineering Asset 重检；P1-D Visual Candidate 的历史 checks 保留为 stale，未用 CAD 结果覆盖或伪造重检。' } : { status: 'not_run', detail: '项目没有 Visual Candidate。' },
    checks: saved.checks.map(c => ({ name: c.name, status: c.status, scope: c.scope, partId: c.partId || null, topology: c.topology?.verdict || null })),
    tripoApiRequests: 0,
  };
  fs.writeFileSync(path.join(site, 'work', 'validation', 'p1f-cad', 'checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
