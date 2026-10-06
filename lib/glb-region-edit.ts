/* eslint-disable @typescript-eslint/no-explicit-any -- glTF JSON is validated by inspectGlb before it is decoded here. */
import { Matrix4, Quaternion, Vector3 } from "three";
import { inspectGlb, type GlbSummary } from "./glb-inspect";

type Vec3 = [number, number, number];
export type RegionEditOperation =
  | { kind: "offset"; amountMm: number; falloffMm: number; depthMm: number }
  | { kind: "flatten"; amountMm: number; falloffMm: number; depthMm: number }
  | { kind: "translate"; amountMm: number; direction: Vec3; falloffMm: number; depthMm: number };

export type RegionEditInput = {
  pathMm: Vec3[];
  anchorMm: Vec3;
  normal: Vec3;
  unitScale: number;
  partPositionMm: Vec3;
  operation: RegionEditOperation;
};

export type RegionEditReport = {
  changedVertices: number;
  totalVertices: number;
  maxDisplacementMm: number;
  sourceDimensionsMm: Vec3;
  resultDimensionsMm: Vec3;
  unselectedVerticesUnchanged: true;
};

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const finite = (value: number) => Number.isFinite(value);
const aligned = (value: number) => (value + 3) & ~3;

function checkVec(value: Vec3, label: string) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) throw Error(label + "坐标无效。");
  return new Vector3(...value);
}

function areaContains(point: [number, number], polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function boundaryDistance(point: [number, number], polygon: [number, number][]) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0;
    best = Math.min(best, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
  }
  return best;
}

function glbParts(data: ArrayBuffer) {
  const view = new DataView(data);
  if (data.byteLength < 28 || view.getUint32(0, true) !== GLB_MAGIC) throw Error("模型不是有效 GLB。");
  let cursor = 12, json: Record<string, any> | null = null, binStart = -1, binLength = 0;
  while (cursor < data.byteLength) {
    const size = view.getUint32(cursor, true), type = view.getUint32(cursor + 4, true);
    cursor += 8;
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, cursor, size)));
    if (type === BIN_CHUNK) { binStart = cursor; binLength = size; }
    cursor += size;
  }
  if (!json || binStart < 0) throw Error("GLB 缺少模型数据。");
  return { json, binStart, binLength };
}

function nodeMatrix(node: Record<string, any>) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  );
}

function writeGlb(json: Record<string, any>, bin: Uint8Array) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = aligned(encoded.length), total = 12 + 8 + jsonLength + 8 + bin.length;
  const output = new ArrayBuffer(total), view = new DataView(output), bytes = new Uint8Array(output);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.set(encoded, 20);
  bytes.fill(0x20, 20 + encoded.length, 20 + jsonLength);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, bin.length, true);
  view.setUint32(binHeader + 4, BIN_CHUNK, true);
  bytes.set(bin, binHeader + 8);
  return output;
}

/** Deterministically edit only vertices under a captured three-dimensional region. */
export function editGlbRegion(data: ArrayBuffer, input: RegionEditInput): { bytes: ArrayBuffer; report: RegionEditReport } {
  const source: GlbSummary = inspectGlb(data);
  if (input.pathMm.length < 6 || input.pathMm.length > 128) throw Error("圈选路径需要 6 至 128 个三维点。");
  const origin = checkVec(input.anchorMm, "圈选锚点");
  const normal = checkVec(input.normal, "表面法向").normalize();
  const position = checkVec(input.partPositionMm, "零件位置");
  if (normal.lengthSq() < 0.9 || !finite(input.unitScale) || input.unitScale <= 0) throw Error("模型单位或圈选法向无效。");
  const operation = input.operation;
  if (!finite(operation.amountMm) || Math.abs(operation.amountMm) > 50 ||
      !finite(operation.falloffMm) || operation.falloffMm < 0.1 || operation.falloffMm > 50 ||
      !finite(operation.depthMm) || operation.depthMm < 0.1 || operation.depthMm > 100) throw Error("改形尺寸超出受控范围。");
  const direction = operation.kind === "translate" ? checkVec(operation.direction, "位移方向").normalize() : normal;
  if (direction.lengthSq() < 0.9) throw Error("位移方向无效。");
  const path = input.pathMm.map((point) => checkVec(point, "圈选路径"));
  const u = path[1].clone().sub(path[0]).projectOnPlane(normal).normalize();
  if (u.lengthSq() < 0.9) throw Error("圈选区域无法确定编辑平面。");
  const v = new Vector3().crossVectors(normal, u).normalize();
  const polygon = path.map((point): [number, number] => {
    const relative = point.clone().sub(origin);
    return [relative.dot(u), relative.dot(v)];
  });
  const polygonArea = Math.abs(polygon.reduce((sum, a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0)) / 2;
  if (polygonArea < 1) throw Error("圈选区域小于 1 平方毫米，请扩大后重试。");

  const copy = data.slice(0), parts = glbParts(copy), { json, binStart, binLength } = parts;
  const view = new DataView(copy), changedAccessors = new Set<number>(), accessorMatrices = new Map<number, string>();
  let changedVertices = 0, totalVertices = 0, maxDisplacementMm = 0;
  const updatePrimitive = (primitive: Record<string, any>, world: Matrix4) => {
    const accessorIndex = primitive.attributes?.POSITION;
    const accessor = json.accessors[accessorIndex], bufferView = json.bufferViews[accessor?.bufferView];
    if (!accessor || !bufferView || accessor.type !== "VEC3" || accessor.componentType !== 5126 || accessor.sparse) {
      throw Error("该网格的位置数据不支持受控改形。");
    }
    const matrixKey = world.elements.map((item) => item.toFixed(8)).join(",");
    const priorMatrix = accessorMatrices.get(accessorIndex);
    if (priorMatrix && priorMatrix !== matrixKey) throw Error("同一网格在不同位置被复用，请先拆分实例后改形。");
    accessorMatrices.set(accessorIndex, matrixKey);
    if (changedAccessors.has(accessorIndex)) {
      delete primitive.attributes.NORMAL;
      delete primitive.attributes.TANGENT;
      return;
    }
    changedAccessors.add(accessorIndex);
    const inverse = world.clone().invert(), stride = bufferView.byteStride ?? 12;
    const base = binStart + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let primitiveChanged = false;
    for (let index = 0; index < accessor.count; index++) {
      const address = base + index * stride, local = new Vector3(
        view.getFloat32(address, true), view.getFloat32(address + 4, true), view.getFloat32(address + 8, true),
      );
      const gltfWorld = local.clone().applyMatrix4(world);
      const point = new Vector3(gltfWorld.x, -gltfWorld.z, gltfWorld.y).multiplyScalar(input.unitScale).add(position);
      const relative = point.clone().sub(origin), planeDistance = relative.dot(normal);
      const projected: [number, number] = [relative.dot(u), relative.dot(v)];
      let next = point;
      if (Math.abs(planeDistance) <= operation.depthMm && areaContains(projected, polygon)) {
        const distance = boundaryDistance(projected, polygon);
        const ratio = Math.min(1, distance / operation.falloffMm);
        const weight = ratio * ratio * (3 - 2 * ratio);
        const displacement = operation.kind === "flatten"
          ? (operation.amountMm - planeDistance) * weight
          : operation.amountMm * weight;
        if (Math.abs(displacement) > 1e-5) {
          next = point.clone().addScaledVector(direction, displacement);
          changedVertices++;
          primitiveChanged = true;
          maxDisplacementMm = Math.max(maxDisplacementMm, Math.abs(displacement));
          const editedGltfWorld = next.clone().sub(position).divideScalar(input.unitScale);
          const editedLocal = new Vector3(editedGltfWorld.x, editedGltfWorld.z, -editedGltfWorld.y).applyMatrix4(inverse);
          view.setFloat32(address, editedLocal.x, true);
          view.setFloat32(address + 4, editedLocal.y, true);
          view.setFloat32(address + 8, editedLocal.z, true);
        }
      }
      for (let axis = 0; axis < 3; axis++) {
        const component = view.getFloat32(address + axis * 4, true);
        min[axis] = Math.min(min[axis], component);
        max[axis] = Math.max(max[axis], component);
      }
      totalVertices++;
    }
    accessor.min = min;
    accessor.max = max;
    if (primitiveChanged) {
      delete primitive.attributes.NORMAL;
      delete primitive.attributes.TANGENT;
    }
  };
  const walk = (nodeIndex: number, parent: Matrix4) => {
    const node = json.nodes[nodeIndex] as Record<string, any>;
    const world = parent.clone().multiply(nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh] as Record<string, any>;
      for (const primitive of mesh.primitives as Record<string, any>[]) updatePrimitive(primitive, world);
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes ?? []) walk(root, new Matrix4());
  if (changedVertices < 3 || maxDisplacementMm < 0.01) throw Error("圈选区域内没有足够网格顶点被改动，请扩大区域或调整尺寸。");
  const bytes = writeGlb(json, new Uint8Array(copy, binStart, binLength));
  const result = inspectGlb(bytes);
  return { bytes, report: {
    changedVertices, totalVertices, maxDisplacementMm,
    sourceDimensionsMm: source.dimensionsMm.map((value) => value * input.unitScale / 1000) as Vec3,
    resultDimensionsMm: result.dimensionsMm.map((value) => value * input.unitScale / 1000) as Vec3,
    unselectedVerticesUnchanged: true,
  } };
}
