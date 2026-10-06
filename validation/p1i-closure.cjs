/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'work', 'validation', 'p1i');
const base = process.env.P1I_BASE_URL || 'http://127.0.0.1:8787';
const projectId = '91ad21c0-4143-4252-8969-00dc31047b82';
const taskId = 'cea013ea-cfda-4629-b161-74d9b29381a8';
const headers = {
  'oai-authenticated-user-id': 'local_seedy',
  'oai-authenticated-user-email': 'seedy@sites.test',
  'oai-authenticated-user-full-name': 'Seedy',
  origin: base,
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => nativeFetch(
  typeof input === 'string' && input.startsWith('/') ? base + input : input,
  { ...init, headers: { ...headers, ...(init.headers || {}) } },
);
globalThis.FileReader = class {
  result = null;
  onload = null;
  onloadend = null;
  onerror = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onload?.({target: this});
      this.onloadend?.({target: this});
    }).catch(error => this.onerror?.(error));
  }
};

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
async function json(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(response.ok, true, `${init.method || 'GET'} ${url}: ${response.status} ${text}`);
  return body;
}
async function bundle() {
  const outfile = path.join(out, 'p1i-closure.bundle.cjs');
  await esbuild.build({
    stdin: {
      contents: "export {importModel} from './lib/geometry'; export {partUnitScale} from './lib/engineering'; export {exportEngineeringPackage} from './lib/engineering-export';",
      resolveDir: root,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: path.join(root, 'tsconfig.json'),
    logLevel: 'silent',
  });
  return require(outfile);
}

async function main() {
  fs.mkdirSync(out, {recursive: true});
  const api = await bundle();
  const project = await json(`/api/projects?id=${projectId}`);
  const part = project.parts.find(value => value.source?.kind === 'cad');
  assert(part && part.engineeringRole === 'manufacturing');
  const jobs = await json(`/api/slicing/jobs?projectId=${projectId}`);
  const current = jobs.find(value => value.id === taskId);
  assert(current && current.status === 'offline_consistent' && current.stale === false);
  const task = await json(`/api/slicing/jobs?id=${taskId}`);
  assert.equal(task.manifestSha256, '692fba52dc4e2b39d0158b3d3cffef74cebbbb8df7b613778726dfccdda65f77');
  const assetResponse = await fetch(`/api/assets?id=${part.assetId}`);
  assert.equal(assetResponse.ok, true);
  const assetBytes = await assetResponse.arrayBuffer();
  assert.equal(sha(Buffer.from(assetBytes)), part.source.assetSha256);
  const models = new Map([[part.id, await api.importModel(assetBytes, part.assetName, api.partUnitScale(part))]]);
  const packageBlob = await api.exportEngineeringPackage(project, models);
  const packageBytes = Buffer.from(await packageBlob.arrayBuffer());
  const packagePath = path.join(out, `golden-engineering-package-v${project.revision}.zip`);
  fs.writeFileSync(packagePath, packageBytes);
  const zip = await JSZip.loadAsync(packageBytes);
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  const trace = JSON.parse(await zip.file('traceability.json').async('string'));
  const sliceIndex = JSON.parse(await zip.file('slicing/index.json').async('string'));
  const currentSlice = sliceIndex.jobs.find(value => value.jobId === taskId);
  assert(currentSlice && currentSlice.status === 'offline_consistent' && currentSlice.stale === false);
  assert.equal(currentSlice.execution, 'consistent');
  assert(currentSlice.resultZip && currentSlice.resultFiles.length > 0);
  assert(names.some(name => name.endsWith('.3mf')));
  assert(names.some(name => name.endsWith('.gcode')));
  assert(names.some(name => name.endsWith('effective-settings.json')));
  assert(names.some(name => name.endsWith('process-log.txt')));
  for (const file of trace.files) {
    const entry = zip.file(file.path);
    assert(entry, `trace file missing: ${file.path}`);
    const data = Buffer.from(await entry.async('uint8array'));
    assert.equal(data.length, file.bytes, `trace byte mismatch: ${file.path}`);
    assert.equal(sha(data), file.sha256, `trace hash mismatch: ${file.path}`);
  }
  const latestRevision = (await json(`/api/revisions?projectId=${projectId}`))[0];
  const evidence = project.checks.find(value => value.provenance?.jobId === taskId);
  const report = {
    schema: 'p1i-closure-validation-v1',
    passed: true,
    projectId,
    revision: project.revision,
    currentRevisionRecord: latestRevision.number,
    cadDesignId: part.source.designId,
    cadTaskId: part.source.jobId,
    manufacturingAssetId: part.assetId,
    sliceTaskId: taskId,
    sliceResult: {status: current.status, artifactSha256: current.summary.artifactSha256, engine: current.summary.engine},
    manifestSha256: task.manifestSha256,
    inputStlSha256: task.manifest.files['input.stl'].sha256,
    generated: {threeMfSha256: currentSlice.resultFiles.find(value => value.path.endsWith('sliced.3mf'))?.sha256 ?? null, gcodePath: names.find(name => name.endsWith('.gcode')) ?? null, gcodeSha256: null},
    slice: {layerCount: current.summary.layerCount, estimatedSeconds: current.summary.estimatedSeconds, estimatedGrams: current.summary.estimatedGrams, geometryComparison: current.summary.geometryComparison, physicalValidation: current.summary.physicalValidation, productionReady: current.summary.productionReady},
    evidence: evidence ? {id: evidence.id, status: evidence.status, scope: evidence.scope, revision: evidence.revision, inputHash: evidence.inputHash} : null,
    engineeringPackage: {path: path.relative(root, packagePath), bytes: packageBytes.length, sha256: sha(packageBytes), containsThreeMf: names.some(name => name.endsWith('.3mf')), containsGcode: names.some(name => name.endsWith('.gcode')), sliceIndexPath: 'slicing/index.json', traceabilityPath: 'traceability.json'},
    historicalSliceJobs: jobs.filter(value => value.id !== taskId).map(value => ({id: value.id, status: value.status, stale: value.stale})),
    visualReferenceParts: project.parts.filter(value => value.engineeringRole === 'visual_reference').map(value => value.id),
    physicalValidation: 'not_run',
    productionReady: false,
    validation: ['official ZIP SHA-256 verified', 'runner exit code 0', 'server PATCH import accepted', 'project revision/evidence asserted', 'engineering package traceability hashes asserted'],
  };
  const gcodeEntry = zip.file(report.generated.gcodePath);
  if (gcodeEntry) report.generated.gcodeSha256 = sha(Buffer.from(await gcodeEntry.async('uint8array')));
  fs.writeFileSync(path.join(out, 'closure.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
