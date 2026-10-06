/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const bundle = path.join(root, 'work/validation/glb-region-edit.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'lib/glb-region-edit.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
});
const { editGlbRegion } = require(bundle);

function data(name) {
  const source = fs.readFileSync(path.join(root, 'work/validation/glb-fixtures', name));
  return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
}
function positions(buffer) {
  const view = new DataView(buffer);
  const jsonSize = view.getUint32(12, true);
  const binary = 28 + jsonSize;
  return Array.from({ length: 8 }, (_, index) =>
    Array.from({ length: 3 }, (_, axis) => view.getFloat32(binary + index * 12 + axis * 4, true)));
}

const original = data('G01_box.glb');
const pathMm = [
  [-10, -50, 30], [10, -50, 30], [30, -50, 30],
  [30, 10, 30], [10, 10, 30], [-10, 10, 30],
];
const input = {
  pathMm,
  anchorMm: [10, -20, 30],
  normal: [0, 0, 1],
  unitScale: 1000,
  partPositionMm: [0, 0, 0],
  operation: { kind: 'offset', amountMm: 2, falloffMm: 5, depthMm: 5 },
};
const { bytes, report } = editGlbRegion(original, input);
const before = positions(original), after = positions(bytes);
assert.equal(report.changedVertices, 4);
assert.equal(report.unselectedVerticesUnchanged, true);
assert.equal(report.maxDisplacementMm, 2);
assert.deepEqual(report.sourceDimensionsMm.map(Math.round), [20, 40, 30]);
assert.deepEqual(report.resultDimensionsMm.map(Math.round), [20, 40, 32]);
for (let index = 0; index < 8; index++) {
  if (before[index][1] === 0) assert.deepEqual(after[index], before[index]);
  else assert.ok(Math.abs(after[index][1] - before[index][1] - 0.002) < 1e-6);
}
assert.throws(() => editGlbRegion(data('G10_shared_mesh.glb'), input), /复用/);
assert.throws(() => editGlbRegion(original, {
  ...input, pathMm: input.pathMm.map(([x, y, z]) => [x + 1000, y, z]),
}), /没有足够网格顶点/);
console.log(JSON.stringify({
  schema: 'glb-region-edit-v1',
  changedVertices: report.changedVertices,
  unselectedVerticesUnchanged: report.unselectedVerticesUnchanged,
  resultDimensionsMm: report.resultDimensionsMm,
  passed: true,
}));
