"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Check, Compass, ScanLine, RotateCcw, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { assembly, type ModelMap } from "@/lib/geometry";
import { isVisualReference, type Project } from "@/lib/engineering";
import type { TopologyReport } from "@/lib/topology";
import type { DesignFeedbackAnchor } from "@/lib/design-feedback";
import { boundDesignRegionPath } from "@/lib/region-path";

type ContentMode = "manufacturing" | "visual" | "compare";
type RenderMode = "default" | "unrendered" | "transparent" | "exploded";
type ViewPreset = "hero" | "45" | "front" | "side" | "back";
export type ViewerPick = DesignFeedbackAnchor;
export type ViewerRegion = {
  anchor: ViewerPick;
  path: [number, number][];
  worldPath?: [number, number, number][];
  image: Blob;
};
export function displayPartName(name: string) {
  return name === "warm-white sculpted lower shell" ? "白色外壳" : name;
}
const contentLabels: Record<ContentMode, string> = {
  manufacturing: "制造件",
  visual: "参考件",
  compare: "对比",
};
const renderLabels: Record<RenderMode, string> = {
  default: "默认渲染",
  unrendered: "未渲染",
  transparent: "半透明",
  exploded: "爆炸图",
};
const renderModeOrder: RenderMode[] = ["default", "unrendered", "transparent", "exploded"];
const viewLabels: Record<ViewPreset, string> = {
  hero: "主视图",
  "45": "前侧 45°",
  front: "正面",
  side: "侧面",
  back: "背面",
};
const viewPresetOrder: ViewPreset[] = ["hero", "45", "front", "side", "back"];
const viewDirections: Record<ViewPreset, [number, number, number]> = {
  hero: [1, -1.35, 1.25],
  "45": [1, -1, 0.48],
  front: [0, -1, 0],
  side: [1, 0, 0],
  back: [0, 1, 0],
};

const tuple = (value: THREE.Vector3): [number, number, number] => [value.x, value.y, value.z];
function tidyRegion(points: [number, number][]): [number, number][] {
  const cross = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: [number, number][] = [],
    upper: [number, number][] = [];
  for (const point of sorted) {
    while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  for (const point of sorted.slice().reverse()) {
    while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  let ring = lower.slice(0, -1).concat(upper.slice(0, -1));
  for (let pass = 0; pass < 2 && ring.length >= 3; pass++) {
    const next: [number, number][] = [];
    ring.forEach((point, index) => {
      const following = ring[(index + 1) % ring.length];
      next.push([point[0] * 0.75 + following[0] * 0.25, point[1] * 0.75 + following[1] * 0.25], [point[0] * 0.25 + following[0] * 0.75, point[1] * 0.25 + following[1] * 0.75]);
    });
    ring = next;
  }
  return boundDesignRegionPath(ring);
}
function regionPath(points: [number, number][], closed: boolean) {
  if (!points.length) return "";
  return points.map(([x, y], index) => `${index ? "L" : "M"}${(x * 1000).toFixed(1)} ${(y * 1000).toFixed(1)}`).join(" ") + (closed ? " Z" : "");
}

function metricGrid(center: THREE.Vector3, span: number, z: number) {
  const size = Math.max(200, Math.ceil((span * 1.7) / 100) * 100),
    half = size / 2,
    minX = Math.floor((center.x - half) / 10) * 10,
    maxX = Math.ceil((center.x + half) / 10) * 10,
    minY = Math.floor((center.y - half) / 10) * 10,
    maxY = Math.ceil((center.y + half) / 10) * 10;
  const minor: number[] = [],
    major: number[] = [],
    axes: number[] = [];
  const add = (target: number[], a: number, b: number, c: number, d: number) => target.push(a, b, z, c, d, z);
  for (let x = minX; x <= maxX; x += 10) {
    if (Math.abs(x) < 0.001) add(axes, x, minY, x, maxY);
    else add(Math.round(x) % 50 === 0 ? major : minor, x, minY, x, maxY);
  }
  for (let y = minY; y <= maxY; y += 10) {
    if (Math.abs(y) < 0.001) add(axes, minX, y, maxX, y);
    else add(Math.round(y) % 50 === 0 ? major : minor, minX, y, maxX, y);
  }
  const group = new THREE.Group();
  const lines = (values: number[], color: number, opacity: number) => {
    if (!values.length) return;
    const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(values, 3)),
      material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      });
    const line = new THREE.LineSegments(geometry, material);
    line.userData.metricGrid = true;
    group.add(line);
  };
  lines(minor, 0x6f8c8d, 0.27);
  lines(major, 0x365f60, 0.48);
  lines(axes, 0x16877d, 0.88);
  return group;
}

function roundedSection(width: number, height: number) {
  const shape = new THREE.Shape(),
    halfWidth = width / 2,
    halfHeight = height / 2,
    radius = Math.min(width, height) * 0.105;
  shape.moveTo(-halfWidth + radius, -halfHeight);
  shape.lineTo(halfWidth - radius, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
  shape.lineTo(halfWidth, halfHeight - radius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  shape.lineTo(-halfWidth + radius, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
  shape.lineTo(-halfWidth, -halfHeight + radius);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);
  return shape;
}

export default function ModelViewer({ project, models, epoch, focusedPartId = "", activeRegion, onClearFocus, onSelect, onPick, onRegion, annotationResetKey, diagnostic, presentationMode = false }: { project: Project; models: ModelMap; epoch: number; focusedPartId?: string; activeRegion?: ViewerRegion | null; onClearFocus?: () => void; onSelect: (id: string) => void; onPick?: (pick: ViewerPick) => void; onRegion?: (region: ViewerRegion | null) => void; annotationResetKey?: number; diagnostic?: TopologyReport; presentationMode?: boolean }) {
  // Form edits change the project object on every keystroke. Keep the WebGL
  // scene tied to model-bearing fields so typing does not recreate a context.
  const sceneProject = useMemo(() => ({ id: project.id, title: "三维预览", parts: project.parts }), [project.id, project.parts]);
  const host = useRef<HTMLDivElement>(null),
    rendererBundleRef = useRef<{ renderer: THREE.WebGLRenderer; environmentGenerator: THREE.PMREMGenerator; environment: THREE.Texture } | null>(null),
    controlsRef = useRef<OrbitControls | null>(null),
    groupRef = useRef<THREE.Group | null>(null),
    applyPresetRef = useRef<((value: ViewPreset) => void) | null>(null),
    presetRef = useRef<ViewPreset>(activeRegion?.anchor.view.preset ?? "hero"),
    frontYawRef = useRef(0),
    viewStateRef = useRef<{ key: string; position: THREE.Vector3; target: THREE.Vector3; zoom: number } | null>(null),
    annotationGlowRef = useRef<SVGPathElement>(null),
    annotationShapeRef = useRef<SVGPathElement>(null),
    annotatingRef = useRef(false),
    focusedPartIdRef = useRef(focusedPartId),
    pathRef = useRef<[number, number][]>([]),
    worldPathRef = useRef<THREE.Vector3[]>((activeRegion?.worldPath ?? []).map((point) => new THREE.Vector3(...point))),
    resetKeyRef = useRef(annotationResetKey),
    restoreViewRef = useRef(activeRegion?.anchor.view ?? null);
  const restoredMode = activeRegion?.anchor.view.mode;
  const hasManufacturing = project.parts.some((part) => !isVisualReference(part)),
    hasVisual = project.parts.some(isVisualReference),
    visualParts = project.parts.filter(isVisualReference),
    activeVisual = visualParts.find((part) => part.id === focusedPartId) ?? visualParts.at(-1),
    frontKey = activeVisual ? `zaowu:viewer-front:${activeVisual.assetId ?? activeVisual.id}` : "";
  const [contentMode, setContentMode] = useState<ContentMode>(restoredMode === "visual" || restoredMode === "compare" ? restoredMode : (presentationMode && hasVisual) || (project.parts.length > 0 && project.parts.every(isVisualReference)) ? "visual" : "manufacturing"),
    [renderMode, setRenderMode] = useState<RenderMode>(restoredMode === "exploded" ? "exploded" : "default"),
    [explodeAmount, setExplodeAmount] = useState(58),
    [preset, setPreset] = useState<ViewPreset>(activeRegion?.anchor.view.preset ?? "hero"),
    [error, setError] = useState(""),
    [annotating, setAnnotating] = useState(false),
    [completed, setCompleted] = useState(!!activeRegion),
    [path, setPath] = useState<[number, number][]>(activeRegion?.path ?? []),
    [annotationStatus, setAnnotationStatus] = useState(activeRegion ? "区域已定位，可在下方填写修改建议" : "");
  useEffect(() => {
    focusedPartIdRef.current = focusedPartId;
  }, [focusedPartId]);
  const clearAnnotation = () => {
    annotatingRef.current = false;
    setAnnotating(false);
    setCompleted(false);
    pathRef.current = [];
    worldPathRef.current = [];
    setPath([]);
    setAnnotationStatus("");
    if (controlsRef.current) controlsRef.current.enabled = true;
    onRegion?.(null);
  };
  const beginAnnotation = () => {
    annotatingRef.current = true;
    setAnnotating(true);
    setCompleted(false);
    pathRef.current = [];
    worldPathRef.current = [];
    setPath([]);
    setAnnotationStatus("拖动鼠标，圈出希望修改的区域");
    if (controlsRef.current) controlsRef.current.enabled = false;
    onRegion?.(null);
  };
  useEffect(() => {
    const part = project.parts.find((value) => value.id === focusedPartId);
    if (!part) return;
    if (presentationMode && hasVisual) return;
    if (contentMode === "manufacturing" && isVisualReference(part)) setContentMode("visual");
    else if (contentMode === "visual" && !isVisualReference(part)) setContentMode("manufacturing");
  }, [focusedPartId, contentMode, hasVisual, presentationMode, project]);
  useEffect(() => {
    if ((presentationMode && hasVisual || hasVisual && !hasManufacturing) && contentMode !== "visual") setContentMode("visual");
    else if (hasManufacturing && !hasVisual && contentMode !== "manufacturing") setContentMode("manufacturing");
  }, [contentMode, hasManufacturing, hasVisual, presentationMode]);
  useEffect(() => {
    if (!frontKey) return;
    try {
      const saved = window.localStorage.getItem(frontKey);
      const yaw = saved === null && activeVisual?.dimensions
        ? activeVisual.dimensions[1] > activeVisual.dimensions[0] * 1.05 ? Math.PI / 2 : 0
        : Number(saved ?? 0);
      frontYawRef.current = Number.isFinite(yaw) ? yaw : 0;
    } catch {
      frontYawRef.current = 0;
    }
  }, [frontKey, activeVisual]);
  useEffect(() => {
    if (annotationResetKey === undefined || resetKeyRef.current === annotationResetKey) return;
    resetKeyRef.current = annotationResetKey;
    annotatingRef.current = false;
    pathRef.current = [];
    worldPathRef.current = [];
    setAnnotating(false);
    setCompleted(false);
    setPath([]);
    setAnnotationStatus("");
    if (controlsRef.current) controlsRef.current.enabled = true;
  }, [annotationResetKey]);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    if (!rendererBundleRef.current) {
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
      } catch {
        queueMicrotask(() => setError("当前浏览器无法创建三维视图，请启用硬件加速后重试。"));
        return;
      }
      const environmentGenerator = new THREE.PMREMGenerator(renderer);
      const environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      rendererBundleRef.current = { renderer, environmentGenerator, environment };
    }
    const { renderer, environment } = rendererBundleRef.current;
    const scene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 100000);
    camera.up.set(0, 0, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    if (!element.contains(renderer.domElement)) element.appendChild(renderer.domElement);
    scene.environment = environment;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minZoom = 0.35;
    controls.maxZoom = 8;
    controls.enabled = !annotatingRef.current;
    controlsRef.current = controls;
    const manufacturing = sceneProject.parts.filter((part) => !isVisualReference(part)),
      visual = activeVisual ? [activeVisual] : [],
      subset = (parts: Project["parts"]) => ({ ...sceneProject, parts });
    let group = new THREE.Group();
    let visualSection: { bounds: THREE.Box3; lowerZ: number; upperZ: number } | null = null;
    try {
      if (contentMode === "compare") {
        const cad = assembly(subset(manufacturing), models),
          reference = assembly(subset(visual), models),
          cadBounds = new THREE.Box3().setFromObject(cad),
          referenceBounds = new THREE.Box3().setFromObject(reference),
          gap = Math.max(cadBounds.getSize(new THREE.Vector3()).x, referenceBounds.getSize(new THREE.Vector3()).x) * 0.18;
        cad.position.x -= cadBounds.max.x + gap / 2;
        reference.position.x -= referenceBounds.min.x - gap / 2;
        group.add(cad, reference);
      } else {
        group = assembly(subset(contentMode === "visual" ? visual : manufacturing), models);
      }
      if (contentMode === "visual" && renderMode === "exploded" && group.children.length === 1) {
        const source = group.children[0],
          sourceBounds = new THREE.Box3().setFromObject(source),
          sourceHeight = Math.max(sourceBounds.max.z - sourceBounds.min.z, 1),
          splitZ = sourceBounds.min.z + sourceHeight * 0.28,
          separation = sourceHeight * (0.18 + explodeAmount * 0.0085),
          lower = source.clone(true),
          upper = source.clone(true);
        upper.position.z += separation;
        lower.userData.sliceHalf = "lower";
        lower.userData.sliceCutZ = splitZ;
        upper.userData.sliceHalf = "upper";
        upper.userData.sliceCutZ = splitZ + separation;
        visualSection = { bounds: sourceBounds, lowerZ: splitZ, upperZ: splitZ + separation };
        group.remove(source);
        group.add(lower, upper);
        group.updateMatrixWorld(true);
      }
      if (contentMode === "manufacturing" && renderMode === "exploded" && group.children.length > 1) {
        const sourceBounds = new THREE.Box3().setFromObject(group),
          sourceCenter = sourceBounds.getCenter(new THREE.Vector3()),
          sourceSpan = Math.max(...sourceBounds.getSize(new THREE.Vector3()).toArray(), 10),
          distance = sourceSpan * (0.16 + 0.0042 * explodeAmount);
        group.children.forEach((child, index) => {
          const childCenter = new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3()),
            direction = childCenter.sub(sourceCenter);
          if (direction.length() < sourceSpan * 0.045) direction.set(Math.cos(index * 2.399), Math.sin(index * 2.399), ((index % 3) - 1) * 0.34);
          direction.normalize();
          child.position.add(direction.multiplyScalar(distance * (0.8 + (index % 3) * 0.12)));
        });
      }
      scene.add(group);
      groupRef.current = group;
      queueMicrotask(() => setError(""));
    } catch (cause) {
      group = new THREE.Group();
      groupRef.current = null;
      queueMicrotask(() => setError(String(cause)));
    }
    const shell = contentMode === "manufacturing" && renderMode === "transparent"
      ? group.children
          .filter((child) => child.userData.partId)
          .map((child) => {
            const part = manufacturing.find((value) => value.id === child.userData.partId);
            const size = new THREE.Box3().setFromObject(child).getSize(new THREE.Vector3());
            return { id: String(child.userData.partId), name: part?.name ?? "", volume: size.x * size.y * size.z };
          })
          .sort((a, b) => Number(/shell|housing|case|enclosure|外壳|机身|壳体/i.test(b.name)) - Number(/shell|housing|case|enclosure|外壳|机身|壳体/i.test(a.name)) || b.volume - a.volume)[0]
      : null;
    const meshCounters = new Map<string, number>();
    group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        let owner: THREE.Object3D | null = node;
        while (owner && !owner.userData.partId) owner = owner.parent;
        const partId = String(owner?.userData.partId ?? "unknown"),
          index = meshCounters.get(partId) ?? 0;
        meshCounters.set(partId, index + 1);
        node.userData.objectId = `${partId}:mesh:${index}`;
        node.userData.focusPartId = partId;
        node.material = Array.isArray(node.material) ? node.material.map((material) => material.clone()) : node.material.clone();
        if (renderMode === "exploded" && owner?.userData.sliceHalf) {
          const cutZ = Number(owner.userData.sliceCutZ);
          const clippingPlane = owner.userData.sliceHalf === "upper"
            ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -cutZ)
            : new THREE.Plane(new THREE.Vector3(0, 0, -1), cutZ);
          (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => {
            material.clippingPlanes = [clippingPlane];
            material.clipShadows = true;
          });
        }
        if (renderMode === "unrendered") {
          (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material.dispose());
          node.material = new THREE.MeshStandardMaterial({
            color: 0xaeb7ba,
            roughness: 0.72,
            metalness: 0.04,
          });
        } else if (renderMode === "transparent" && (contentMode === "visual" || partId === shell?.id)) {
          (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => {
            material.transparent = true;
            material.opacity = contentMode === "visual" ? 0.48 : 0.25;
            material.depthWrite = false;
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
          });
        }
        (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => {
          material.userData.focusBase = {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          };
        });
      }
    });
    const sectionDecor = new THREE.Group();
    if (visualSection) {
      const section = visualSection as { bounds: THREE.Box3; lowerZ: number; upperZ: number },
        sectionSize = section.bounds.getSize(new THREE.Vector3()),
        sectionCenter = section.bounds.getCenter(new THREE.Vector3()),
        outerShape = roundedSection(sectionSize.x * 0.88, sectionSize.y * 0.84),
        innerShape = roundedSection(sectionSize.x * 0.62, sectionSize.y * 0.57),
        holePoints = innerShape.getPoints(18).reverse(),
        hole = new THREE.Path();
      hole.moveTo(holePoints[0].x, holePoints[0].y);
      holePoints.slice(1).forEach((point) => hole.lineTo(point.x, point.y));
      hole.closePath();
      outerShape.holes.push(hole);
      const surfaces = [
        { shape: outerShape, z: section.lowerZ + 0.08, color: 0xd7ddda },
        { shape: innerShape, z: section.lowerZ - 1.1, color: 0x29383a },
        { shape: roundedSection(sectionSize.x * 0.88, sectionSize.y * 0.84), z: section.upperZ + 0.08, color: 0xb9c6c2 },
      ];
      surfaces.forEach(({ shape, z, color }) => {
        const surface = new THREE.Mesh(
          new THREE.ShapeGeometry(shape, 18),
          new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }),
        );
        surface.position.set(sectionCenter.x, sectionCenter.y, z);
        sectionDecor.add(surface);
      });
      const guideVertices: number[] = [];
      for (const x of [-0.4, 0.4]) {
        for (const y of [-0.39, 0.39]) {
          const px = sectionCenter.x + sectionSize.x * x,
            py = sectionCenter.y + sectionSize.y * y;
          guideVertices.push(px, py, section.lowerZ + 0.3, px, py, section.upperZ - 0.3);
        }
      }
      const guideGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(guideVertices, 3)),
        guideMaterial = new THREE.LineDashedMaterial({ color: 0x266a66, dashSize: 2.8, gapSize: 1.3, transparent: true, opacity: 1, depthWrite: false }),
        guides = new THREE.LineSegments(guideGeometry, guideMaterial);
      guides.computeLineDistances();
      sectionDecor.add(guides);
      scene.add(sectionDecor);
    }
    const diagnosticGeometry = diagnostic?.examples.length
      ? new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            diagnostic.examples.flatMap((edge) => [...edge.a, ...edge.b]),
            3,
          ),
        )
      : null;
    const diagnosticMaterial = diagnosticGeometry
      ? new THREE.LineBasicMaterial({
          color: "#ff4d65",
          depthTest: false,
          depthWrite: false,
        })
      : null;
    if (diagnosticGeometry && diagnosticMaterial) {
      const lines = new THREE.LineSegments(diagnosticGeometry, diagnosticMaterial);
      lines.renderOrder = 10;
      scene.add(lines);
    }
    const bounds = new THREE.Box3().setFromObject(group),
      center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3()),
      span = bounds.isEmpty() ? 100 : Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 10);
    scene.add(new THREE.HemisphereLight(0xf8fbff, 0x667176, 1.15));
    const key = new THREE.DirectionalLight(0xfff8ee, 2.8);
    key.position.copy(center).add(new THREE.Vector3(-span * 1.05, -span * 1.45, span * 2.05));
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -span * 1.7;
    key.shadow.camera.right = span * 1.7;
    key.shadow.camera.top = span * 1.7;
    key.shadow.camera.bottom = -span * 1.7;
    key.shadow.bias = -0.00008;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xcce8f3, 0.85);
    fill.position.copy(center).add(new THREE.Vector3(span * 1.4, -span * 0.2, span * 0.9));
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.15);
    rim.position.copy(center).add(new THREE.Vector3(span * 0.2, span * 1.5, span * 1.3));
    scene.add(rim);
    const groundZ = bounds.isEmpty() ? 0 : bounds.min.z - 0.35,
      gridSize = Math.max(200, Math.ceil((span * 1.7) / 100) * 100),
      ground = new THREE.Mesh(
        new THREE.PlaneGeometry(gridSize * 8, gridSize * 8),
        new THREE.MeshStandardMaterial({
          color: 0xc7d0ce,
          roughness: 0.94,
          metalness: 0,
        }),
      );
    ground.position.set(center.x, center.y, groundZ - 0.06);
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = metricGrid(center, span, groundZ + 0.01);
    scene.add(grid);
    const viewKey = `${sceneProject.id}:${epoch}:${contentMode}:${activeVisual?.id ?? ""}:${renderMode === "exploded" ? `exploded:${explodeAmount}` : "assembled"}`;
    let halfHeight = span;
    const fitView = (direction: THREE.Vector3) => {
      const target = center.clone().add(new THREE.Vector3(0, 0, span * 0.015));
      camera.position.copy(target).add(direction.normalize().multiplyScalar(span * 4));
      controls.target.copy(target);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      const corners = bounds.isEmpty()
        ? [center.clone().addScalar(-50), center.clone().addScalar(50)]
        : [bounds.min.x, bounds.max.x].flatMap((x) => [bounds.min.y, bounds.max.y].flatMap((y) => [bounds.min.z, bounds.max.z].map((z) => new THREE.Vector3(x, y, z))));
      const projected = corners.map((point) => point.applyMatrix4(camera.matrixWorldInverse));
      const width = Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x));
      const height = Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y));
      const aspect = Math.max(element.clientWidth / Math.max(element.clientHeight, 1), 0.1);
      halfHeight = Math.max(height / 2, width / (2 * aspect), 5) * 1.28;
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
    };
    const applyPreset = (value: ViewPreset) => {
      const yaw = contentMode === "visual" ? frontYawRef.current : 0;
      const direction = new THREE.Vector3(...viewDirections[value]).applyAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
      fitView(direction);
    };
    applyPresetRef.current = applyPreset;
    const priorView = viewStateRef.current;
    const sameModel = priorView?.key.startsWith(`${sceneProject.id}:${epoch}:${contentMode}:${activeVisual?.id ?? ""}:`);
    if (priorView && sameModel && priorView.key !== viewKey) fitView(priorView.position.clone().sub(priorView.target));
    else applyPreset(presetRef.current);
    const remembered = restoreViewRef.current,
      currentLegacyMode = renderMode === "exploded" ? "exploded" : contentMode;
    if (remembered && remembered.mode === currentLegacyMode && remembered.preset === presetRef.current) {
      camera.position.set(...remembered.cameraPosition);
      controls.target.set(...remembered.target);
    } else if (viewStateRef.current?.key === viewKey) {
      camera.position.copy(viewStateRef.current.position);
      controls.target.copy(viewStateRef.current.target);
      camera.zoom = viewStateRef.current.zoom;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(controls.target);
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      renderer.setSize(width, height);
      const aspect = Math.max(width / Math.max(height, 1), 0.1);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      if (worldPathRef.current.length >= 3) {
        const projected = worldPathRef.current.map((worldPoint): [number, number] => {
          const point = worldPoint.clone().project(camera);
          return [(point.x + 1) / 2, (1 - point.y) / 2];
        });
        const value = regionPath(projected, true);
        annotationGlowRef.current?.setAttribute("d", value);
        annotationShapeRef.current?.setAttribute("d", value);
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    const raycaster = new THREE.Raycaster();
    let pointerStart: [number, number] = [0, 0],
      drawingPointer: number | null = null;
    const at = (event: PointerEvent): [number, number] => {
      const rect = element.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
    };
    const pickAt = (point: [number, number]): ViewerPick | null => {
      raycaster.setFromCamera(new THREE.Vector2(point[0] * 2 - 1, 1 - point[1] * 2), camera);
      const hits = raycaster.intersectObjects(group.children, true);
      const focusedId = focusedPartIdRef.current;
      const hit = annotatingRef.current && focusedId
        ? hits.find((candidate) => {
            let owner: THREE.Object3D | null = candidate.object;
            while (owner && !owner.userData.partId) owner = owner.parent;
            return owner?.userData.partId === focusedId;
          })
        : hits[0];
      if (!hit) return null;
      let owner: THREE.Object3D | null = hit.object;
      while (owner && !owner.userData.partId) owner = owner.parent;
      if (!owner?.userData.partId) return null;
      const partId = String(owner.userData.partId);
      const local = hit.object.worldToLocal(hit.point.clone()),
        normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? null;
      return {
        partId,
        objectId: String(hit.object.userData.objectId ?? `${partId}:mesh:0`),
        location: {
          world: tuple(hit.point),
          local: tuple(local),
          faceIndex: hit.faceIndex ?? null,
          normal: normal ? tuple(normal) : null,
        },
        view: {
          mode: renderMode === "exploded" ? "exploded" : contentMode,
          preset: presetRef.current,
          cameraPosition: tuple(camera.position),
          target: tuple(controls.target),
        },
      };
    };
    const pointerDown = (event: PointerEvent) => {
      pointerStart = [event.clientX, event.clientY];
      if (!annotatingRef.current) return;
      event.preventDefault();
      drawingPointer = event.pointerId;
      renderer.domElement.setPointerCapture(event.pointerId);
      pathRef.current = [at(event)];
      worldPathRef.current = [];
      setCompleted(false);
      setPath(pathRef.current);
      setAnnotationStatus("");
    };
    const pointerMove = (event: PointerEvent) => {
      if (drawingPointer !== event.pointerId) return;
      event.preventDefault();
      const next = at(event),
        previous = pathRef.current.at(-1)!;
      if (Math.hypot((next[0] - previous[0]) * element.clientWidth, (next[1] - previous[1]) * element.clientHeight) < 4) return;
      const reduced = pathRef.current.length >= 127 ? pathRef.current.filter((_, index) => index % 2 === 0) : pathRef.current;
      pathRef.current = [...reduced, next];
      setPath(pathRef.current);
    };
    const pointerUp = async (event: PointerEvent) => {
      if (drawingPointer !== null) {
        if (event.pointerId !== drawingPointer) return;
        drawingPointer = null;
        event.preventDefault();
        const raw = pathRef.current.length >= 127 ? pathRef.current : pathRef.current.concat([at(event)]),
          points = tidyRegion(raw);
        pathRef.current = points;
        setPath(points);
        const area =
          Math.abs(
            points.reduce((sum, p, index) => {
              const q = points[(index + 1) % points.length];
              return sum + p[0] * q[1] - q[0] * p[1];
            }, 0),
          ) / 2;
        if (raw.length < 6 || points.length < 3 || area < 0.0004) {
          setPath([]);
          setAnnotationStatus("范围太小，请在零件表面重新圈选");
          return;
        }
        const middle: [number, number] = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
        const bounds: [number, number] = [(Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[0]))) / 2, (Math.min(...points.map((p) => p[1])) + Math.max(...points.map((p) => p[1]))) / 2];
        const anchor = [middle, bounds, ...points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 12)) === 0)].map(pickAt).find(Boolean);
        if (!anchor) {
          setAnnotationStatus("圈内未找到模型表面，请对准零件重新圈选");
          return;
        }
        const anchorWorld = new THREE.Vector3(...anchor.location.world),
          cameraDirection = camera.getWorldDirection(new THREE.Vector3()).normalize(),
          surfaceNormal = anchor.location.normal ? new THREE.Vector3(...anchor.location.normal).normalize() : cameraDirection.clone();
        if (Math.abs(surfaceNormal.dot(cameraDirection)) < 0.2) surfaceNormal.copy(cameraDirection);
        const annotationPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(surfaceNormal, anchorWorld),
          worldPoints = points.flatMap((point) => {
            raycaster.setFromCamera(new THREE.Vector2(point[0] * 2 - 1, 1 - point[1] * 2), camera);
            const intersection = raycaster.ray.intersectPlane(annotationPlane, new THREE.Vector3());
            return intersection ? [intersection] : [];
          });
        if (worldPoints.length < 3) {
          setAnnotationStatus("圈选区域无法绑定到模型，请调整视角后重试");
          return;
        }
        worldPathRef.current = worldPoints;
        const rect = element.getBoundingClientRect(),
          scale = Math.min(1, 1100 / Math.max(rect.width, rect.height)),
          snapshot = document.createElement("canvas");
        snapshot.width = Math.max(1, Math.round(rect.width * scale));
        snapshot.height = Math.max(1, Math.round(rect.height * scale));
        const context = snapshot.getContext("2d");
        if (!context) {
          setAnnotationStatus("无法生成圈选视图，请重试");
          return;
        }
        renderer.render(scene, camera);
        context.drawImage(renderer.domElement, 0, 0, snapshot.width, snapshot.height);
        context.beginPath();
        points.forEach(([x, y], index) => (index ? context.lineTo(x * snapshot.width, y * snapshot.height) : context.moveTo(x * snapshot.width, y * snapshot.height)));
        context.closePath();
        context.fillStyle = "rgba(36,175,151,.1)";
        context.strokeStyle = "#d8fff1";
        context.lineWidth = Math.max(2, 2 * scale);
        context.fill();
        context.stroke();
        const image = await new Promise<Blob | null>((resolve) => snapshot.toBlob(resolve, "image/jpeg", 0.86));
        if (!image) {
          setAnnotationStatus("无法生成圈选视图，请重试");
          return;
        }
        onSelect(anchor.partId);
        onPick?.(anchor);
        onRegion?.({ anchor, path: points, worldPath: worldPoints.map(tuple), image });
        annotatingRef.current = false;
        setAnnotating(false);
        controls.enabled = true;
        setCompleted(true);
        setAnnotationStatus("区域已定位，可在下方填写修改建议");
        return;
      }
      if (annotatingRef.current || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const hit = pickAt(at(event));
      if (hit) {
        onSelect(hit.partId);
        onPick?.(hit);
      }
    };
    const pointerCancel = (event: PointerEvent) => {
      if (drawingPointer === event.pointerId) {
        drawingPointer = null;
        pathRef.current = [];
        worldPathRef.current = [];
        setPath([]);
        setAnnotationStatus("圈选已中断，请重新画圈");
      }
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerCancel);
    return () => {
      viewStateRef.current = { key: viewKey, position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom };
      applyPresetRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      group.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material.dispose());
        }
      });
      sectionDecor.traverse((node) => {
        if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
          node.geometry.dispose();
          (node.material as THREE.Material).dispose();
        }
      });
      grid.traverse((node) => {
        if (node instanceof THREE.LineSegments) {
          node.geometry.dispose();
          (node.material as THREE.Material).dispose();
        }
      });
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      groupRef.current = null;
      controlsRef.current = null;
      controls.dispose();
      diagnosticGeometry?.dispose();
      diagnosticMaterial?.dispose();
    };
  }, [sceneProject, models, epoch, onSelect, onPick, onRegion, diagnostic, contentMode, renderMode, explodeAmount, activeVisual]);
  useEffect(() => () => {
    const bundle = rendererBundleRef.current;
    if (!bundle) return;
    bundle.environment.dispose();
    bundle.environmentGenerator.dispose();
    bundle.renderer.dispose();
    bundle.renderer.domElement.remove();
    rendererBundleRef.current = null;
  }, []);
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    let found = false;
    group.traverse((node) => {
      if (node instanceof THREE.Mesh && node.userData.focusPartId === focusedPartId) found = true;
    });
    group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const dim = renderMode !== "transparent" && renderMode !== "exploded" && found && node.userData.focusPartId !== focusedPartId;
      (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => {
        const base = material.userData.focusBase as {
          opacity: number;
          transparent: boolean;
          depthWrite: boolean;
        };
        material.transparent = dim || base.transparent;
        material.opacity = dim ? 0.16 : base.opacity;
        material.depthWrite = dim ? false : base.depthWrite;
        material.needsUpdate = true;
      });
      node.castShadow = renderMode !== "transparent" && !dim;
    });
  }, [focusedPartId, contentMode, renderMode, project, models, epoch, preset]);
  return (
    <>
      {hasManufacturing && hasVisual && !presentationMode && (
        <div className="viewer-content-switch" role="group" aria-label="显示对象">
          {(Object.keys(contentLabels) as ContentMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={contentMode === value ? "active" : ""}
              onClick={() => {
                restoreViewRef.current = null;
                clearAnnotation();
                setContentMode(value);
              }}
            >
              {contentLabels[value]}
            </button>
          ))}
        </div>
      )}
      <div className="viewer-mode-switch" role="group" aria-label="渲染效果">
        {renderModeOrder.map((value) => (
          <button
            key={value}
            type="button"
            className={renderMode === value ? "active" : ""}
            onClick={() => {
              restoreViewRef.current = null;
              clearAnnotation();
              if (contentMode === "manufacturing" && (value === "transparent" || value === "exploded")) onClearFocus?.();
              setRenderMode(value);
            }}
            title={value === "unrendered" ? "以灰色材质检查外形和开孔" : value === "transparent" ? contentMode === "visual" ? "透视外观网格" : "外壳半透明，显示内部零件" : value === "exploded" ? contentMode === "visual" ? "按高度分层查看外观网格；不代表真实装配" : "展开真实装配零件" : "查看原始材质与颜色"}
          >
            {renderLabels[value]}
          </button>
        ))}
      </div>
      <div className="viewer-annotate-tools">
        <button type="button" className={annotating ? "active" : ""} onClick={annotating ? clearAnnotation : beginAnnotation}>
          {annotating ? <X size={15} /> : <ScanLine size={15} />}
          <span>{annotating ? "取消圈选" : completed ? "重新圈选区域" : "圈选修改区域"}</span>
        </button>
        {annotating && path.length > 0 && (
          <button type="button" className="viewer-redraw" onClick={beginAnnotation}>
            <RotateCcw size={14} />
            <span>重画</span>
          </button>
        )}
      </div>
      {contentMode === "visual" && activeVisual ? (
        <div className="viewer-focus-indicator">
          <span className="viewer-focus-dot" />
          <span>当前方案 <strong>{displayPartName(activeVisual.name)}</strong></span>
        </div>
      ) : focusedPartId && project.parts.some((part) => part.id === focusedPartId) && (
        <div className="viewer-focus-indicator">
          <span className="viewer-focus-dot" />
          <span>
            正在聚焦 <strong>{displayPartName(project.parts.find((part) => part.id === focusedPartId)?.name ?? focusedPartId)}</strong>
          </span>
          {onClearFocus && (
            <button type="button" onClick={onClearFocus}>
              显示全部
            </button>
          )}
        </div>
      )}
      {renderMode === "exploded" && (
        <div className={`viewer-explode-control${contentMode === "visual" && activeVisual ? " with-calibration" : ""}`}>
          <span>{contentMode === "visual" ? "外观分层" : "展开"}</span>
          <Slider min={15} max={100} step={1} value={[explodeAmount]} onValueChange={(value) => setExplodeAmount(value[0] ?? 58)} />
          <b>{explodeAmount}%</b>
        </div>
      )}
      <div className="viewer-grid-legend">
        <span className="viewer-grid-swatch" />
        每格 10 mm
      </div>
      <div className="viewer-view-switch" role="group" aria-label="标准镜头">
        {viewPresetOrder.map((value) => (
          <button
            key={value}
            type="button"
            className={preset === value ? "active" : ""}
            onClick={() => {
              restoreViewRef.current = null;
              viewStateRef.current = null;
              clearAnnotation();
              presetRef.current = value;
              setPreset(value);
              applyPresetRef.current?.(value);
            }}
          >
            {viewLabels[value]}
          </button>
        ))}
      </div>
      {contentMode === "visual" && activeVisual && (
        <button
          type="button"
          className="viewer-front-calibrate"
          title="旋转到产品正面后点击；正面、侧面、背面和 45° 镜头将按此方向定位"
          onClick={() => {
            const controls = controlsRef.current;
            if (!controls) return;
            const direction = controls.object.position.clone().sub(controls.target);
            direction.z = 0;
            if (direction.lengthSq() < 0.01) return;
            const yaw = Math.atan2(direction.x, -direction.y);
            frontYawRef.current = yaw;
            try { window.localStorage.setItem(frontKey, String(yaw)); } catch { /* 镜头校准在当前页面仍然生效。 */ }
            restoreViewRef.current = null;
            viewStateRef.current = null;
            clearAnnotation();
            presetRef.current = "front";
            setPreset("front");
            applyPresetRef.current?.("front");
          }}
        >
          <Compass size={14} /> 校准正面
        </button>
      )}
      <div className="viewer-canvas" ref={host} />
      {annotating && path.length === 0 && <div className="viewer-draw-instruction">按住鼠标，在真正要修改的表面画一圈</div>}
      {path.length > 0 && (
        <svg className={"viewer-annotation" + (completed ? " complete" : " drawing")} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <path ref={annotationGlowRef} className="viewer-annotation-glow" d={regionPath(path, completed)} />
          <path ref={annotationShapeRef} className="viewer-annotation-shape" d={regionPath(path, completed)} />
        </svg>
      )}
      {annotationStatus && (
        <div className={"viewer-annotation-status" + (completed ? " complete" : "")} role="status">
          <span className="viewer-annotation-status-icon">{completed ? <Check size={15} /> : <ScanLine size={15} />}</span>
          <span>
            <strong>{completed ? "修改区域已标记" : "圈选区域"}</strong>
            <small>{annotationStatus}</small>
          </span>
        </div>
      )}
      {error && <p className="viewer-error">{error}</p>}
    </>
  );
}
