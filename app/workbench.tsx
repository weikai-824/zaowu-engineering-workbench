"use client";
import { useRef, useState, useEffect, useCallback, useEffectEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { Box, Upload, Layers3, ArrowUpRight, FileBox, Move3D, BookOpen, History, Settings2, Save, Plus, Download, Check, Lock, Unlock, Trash2, Sparkles, RotateCcw, ScanLine, CircleUserRound, Sun, Moon, Languages, ShieldCheck } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { basePart, newProject, invalidate, partUnitScale, processLabels, isVisualReference, partEngineeringRole, type Project, type Part } from "@/lib/engineering";
import { importModel, measure, digitalChecks, exportEngineering, type ModelMap } from "@/lib/geometry";
import ModelViewer, { displayPartName, type ViewerPick, type ViewerRegion } from "./model-viewer";
import PartReasoning from "./part-reasoning";
import ProcessSettings from "./process-settings";
import { processConfigurationSummary, type ProcessConfiguration } from "@/lib/process-configuration";
import AgentRunPanel, { type AgentRun } from "./agent-run-panel";
import CadWorkspace from "./cad-workspace";
import { useLocalExecutor } from "./use-local-executor";
import LocalExecutorPanel from "./local-executor-panel";
import OfflineSlicing from "./offline-slicing";
import TripoJobs from "./tripo-jobs";
import TopologyDetails from "./topology-details";
import ConnectionShowcase, { type ConnectionState } from "./connection-showcase";
import { sha256 } from "@/lib/slice-contract";
import { randomUuid } from "@/lib/crypto-portable";
import { createDesignFeedback, createRegionFeedback, type DesignFeedback } from "@/lib/design-feedback";
import { privateProcessLibraryExport, privateProcessSet, profiles } from "@/lib/private-process-library";
import { useLanguage } from "./providers";
type Connection = ConnectionState;
type ViewKey = "front" | "back" | "left" | "right";
type MultiViewPlan = "quick" | "recommended" | "full";
type ReferenceAsset = {
  assetId: string;
  name: string;
  url: string;
  view?: ViewKey;
};
type SavedProject = {
  id: string;
  title: string;
  revision: number;
  updated_at: string;
};
type Revision = { number: number; body: string; created_at: string };
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const d = (await r.json()) as { error?: string };
  if (!r.ok) throw Error(d.error ?? "请求未完成");
  return d as T;
}
function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 15000);
}
function rememberProjectUrl(project: Project) {
  const url = new URL(window.location.href);
  if (project.revision) url.searchParams.set("project", project.id);
  else url.searchParams.delete("project");
  window.history.replaceState(window.history.state, "", url);
}
function pendingAutoImport(projectId: string) {
  try {
    const direct = sessionStorage.getItem("ai3d:auto-import:" + projectId);
    const submitted = JSON.parse(sessionStorage.getItem("ai3d:tripo-submit:" + projectId) ?? "null") as { ids?: unknown } | null;
    const fallback = Array.isArray(submitted?.ids) ? submitted.ids[0] : null;
    const jobId = typeof direct === "string" ? direct : typeof fallback === "string" ? fallback : "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId) && sessionStorage.getItem("ai3d:auto-import-done:" + projectId) !== jobId ? jobId : null;
  } catch {
    return null;
  }
}
function rememberAutoImport(projectId: string, jobId: string) {
  try {
    sessionStorage.setItem("ai3d:auto-import:" + projectId, jobId);
    sessionStorage.removeItem("ai3d:auto-import-done:" + projectId);
  } catch {}
}
function finishAutoImport(projectId: string, jobId: string | null) {
  if (!jobId) return;
  try {
    sessionStorage.removeItem("ai3d:auto-import:" + projectId);
    sessionStorage.setItem("ai3d:auto-import-done:" + projectId, jobId);
  } catch {}
}
const options = [
  ["FDM", "熔融挤出"],
  ["SLA_LASER", "激光光固化"],
  ["LCD_MSLA", "LCD 光固化"],
  ["SLS", "尼龙粉末床"],
  ["LPBF", "金属激光粉末床"],
  ["MJF", "多射流熔融"],
  ["MJT", "材料喷射全彩"],
];
const multiViewPlans: Record<MultiViewPlan, { title: string; badge: string; description: string; views: ViewKey[] }> = {
  quick: {
    title: "快速双视图",
    badge: "入门",
    description: "正面＋一个侧面，适合快速生成轮廓。",
    views: ["front", "left"],
  },
  recommended: {
    title: "推荐三视图",
    badge: "推荐",
    description: "正面＋侧面＋背面，结构信息更完整。",
    views: ["front", "left", "back"],
  },
  full: {
    title: "完整四视图",
    badge: "最佳",
    description: "正、背、左、右全部提供，适合非对称产品。",
    views: ["front", "back", "left", "right"],
  },
};
const viewNames: Record<ViewKey, string> = {
  front: "正面",
  back: "背面",
  left: "左侧",
  right: "右侧",
};
function isCurrentCheck(check: Project["checks"][number], project: Project, currentInputHash?: string) {
  if (check.status === "stale") return false;
  if (currentInputHash) {
    if (check.status === "not_run" && (check.scope === "manufacturing" || check.name.includes("切片"))) return false;
    return check.inputHash === currentInputHash || (check.provenance?.kind === "offline_slice" && check.revision === project.revision);
  }
  return check.revision >= project.revision || check.measuredAtRevision === project.revision;
}
export default function Workbench() {
  const { resolvedTheme, setTheme } = useTheme();
  const { locale, toggleLocale, t } = useLanguage();
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState("design");
  const [selected, setSelected] = useState("");
  const [focusedPartId, setFocusedPartId] = useState("");
  const [pick, setPick] = useState<ViewerPick | null>(null);
  const [region, setRegion] = useState<ViewerRegion | null>(null);
  const [annotationResetKey, setAnnotationResetKey] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [connections, setConnections] = useState<Connection | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [saved, setSaved] = useState<SavedProject[]>([]);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [showAllRevisions, setShowAllRevisions] = useState(false);
  const visibleSaved = showAllProjects ? saved : saved.filter((item, index) => item.id === project?.id || saved.findIndex(value => value.title === item.title) === index);
  const [editText, setEditText] = useState("");
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [inspectorView, setInspectorView] = useState<"run" | "parts">("run");
  const [autoImportJobId, setAutoImportJobId] = useState<string | null>(null);
  const [reference, setReference] = useState<ReferenceAsset | null>(null);
  const [multiReferences, setMultiReferences] = useState<ReferenceAsset[]>([]);
  const [unit, setUnit] = useState("mm");
  const [multiOpen, setMultiOpen] = useState(false);
  const [multiStep, setMultiStep] = useState<1 | 2 | 3>(1);
  const [multiPlan, setMultiPlan] = useState<MultiViewPlan>("recommended");
  const [tripoSpec, setTripoSpec] = useState({
    modelVersion: "v3.1-20260211",
    faceLimit: 80000,
    variantCount: 1,
    texture: true,
    pbr: true,
    textureQuality: "standard",
    textureAlignment: "original_image",
    geometryQuality: "standard",
    exportUv: true,
    autoSize: false,
    enableImageAutofix: false,
    orientation: "default",
    exportOrientation: "",
    modelSeed: "20260915",
    imageSeed: "20260916",
    textureSeed: "20260917",
    negativePrompt: "text, letters, numbers, symbols, icons, logo, oversized display, full-width black lid, bulky pedestal, double-layer base, stepped base, tall enclosure, tilted body, warped surfaces, asymmetry, extra openings, scene, floor, stand",
    smartLowPoly: false,
    generateParts: false,
    quad: false,
    targetProfileId: "",
    targetMachine: "",
    targetMaterial: "",
    partStrategy: "auto",
    assembly: "screw",
    toleranceMm: 0.2,
    needsBase: false,
    needsEnclosure: false,
    needsManufacturingDrawing: true,
    notes: "",
  });
  const [shownDiagnostic, setShownDiagnostic] = useState("");
  const executor = useLocalExecutor(project?.id);
  const busyRef = useRef(false);
  const [modelMap, setModels] = useState<ModelMap>(() => new Map()),
    models = { current: modelMap };
  const pending = useRef(new Map<string, File>());
  const picker = useRef<HTMLInputElement>(null);
  const modelStage = useRef<HTMLElement>(null);
  const executorDetails = useRef<HTMLDetailsElement>(null);
  const tripoModelPicker = useRef<HTMLInputElement>(null);
  const imagePicker = useRef<HTMLInputElement>(null);
  const multiPicker = useRef<HTMLInputElement>(null);
  const current = useRef<Project | null>(null);
  useEffect(() => {
    if (executor.connected && executorDetails.current) executorDetails.current.open = false;
  }, [executor.connected]);
  const onSelect = useCallback((id: string) => {
    setSelected(id);
    setFocusedPartId(id);
  }, []);
  const onPick = useCallback((value: ViewerPick) => {
    setSelected(value.partId);
    setFocusedPartId(value.partId);
    setPick(value);
  }, []);
  const onRegion = useCallback((value: ViewerRegion | null) => {
    setRegion(value);
    if (value) {
      setSelected(value.anchor.partId);
      setFocusedPartId(value.anchor.partId);
      setPick(value.anchor);
    } else setPick(null);
  }, []);
  useEffect(() => {
    current.current = project;
  }, [project]);
  const change = (next: Project, reason?: string) => {
    setProject(reason ? invalidate(next, reason) : next);
    setDirty(true);
    setRegion(null);
    setAnnotationResetKey((value) => value + 1);
  };
  const patch = (p: Partial<Project>) => {
    if (project) change({ ...project, ...p }, "更新产品需求，既有检查需复核。");
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) {
      toast.info("当前操作尚未完成，请稍候。");
      return;
    }
    busyRef.current = true;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  };
  const upload = async (file: File) =>
    api<{ id: string }>("/api/assets", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-filename": encodeURIComponent(file.name),
      },
      body: file,
    });
  const uploadMultiView = async (files: File[], keys: ViewKey[]) => {
    if (files.length !== keys.length) throw Error(`当前方案需要选择 ${keys.length} 张图片，请按槽位顺序一次选齐。`);
    const next: ReferenceAsset[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 20 * 1024 * 1024) throw Error("单张参考图上限 20 MB。");
      if (!/^image\/(?:jpeg|png|webp)$/.test(file.type)) throw Error("多视图仅支持 PNG/JPEG/WebP。");
      const a = await upload(file);
      next.push({
        assetId: a.id,
        name: file.name,
        url: "/api/assets?id=" + a.id,
        view: keys[i],
      });
    }
    setReference(null);
    setMultiReferences(next);
    patch({
      references: next.map((v) => ({
        id: v.assetId,
        name: v.name,
        view: v.view,
      })),
    });
  };
  const updateMultiView = (assetId: string, view: ViewKey) => {
    const next = multiReferences.map((v) => (v.assetId === assetId ? { ...v, view } : v));
    if (new Set(next.map((v) => v.view)).size !== next.length) {
      toast.error("视角不能重复。");
      return;
    }
    if (!next.some((v) => v.view === "front")) {
      toast.error("必须保留正面 front 视角。");
      return;
    }
    setMultiReferences(next);
    patch({
      references: next.map((v) => ({
        id: v.assetId,
        name: v.name,
        view: v.view,
      })),
    });
  };
  const openMultiView = () => {
    const count = multiReferences.length;
    setMultiPlan(count === 2 ? "quick" : count === 4 ? "full" : "recommended");
    setMultiStep(count ? 3 : 1);
    setMultiOpen(true);
  };
  const refreshProjects = async () => setSaved(await api<SavedProject[]>("/api/projects"));
  const save = async () => {
    if (!current.current) throw Error("项目尚未准备好。");
    let p = current.current;
    const parts: Part[] = [];
    for (const part of p.parts) {
      const f = pending.current.get(part.id);
      if (f && !part.assetId) {
        const a = await upload(f);
        parts.push({ ...part, assetId: a.id });
      } else parts.push(part);
    }
    p = { ...p, parts };
    setProject(p);
    current.current = p;
    const result = await api<Project>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    pending.current.clear();
    setProject(result);
    current.current = result;
    setDirty(false);
    if (result.revision === p.revision) toast.info("当前内容已是版本 v" + result.revision);
    else toast.success("已保存版本 v" + result.revision);
    rememberProjectUrl(result);
    setSaved((rows) => [{ id: result.id, title: result.title, revision: result.revision, updated_at: result.updatedAt }, ...rows.filter((row) => row.id !== result.id)]);
    setRevisions(await api<Revision[]>("/api/revisions?projectId=" + result.id));
    return result;
  };
  const hydrate = async (p: Project) => {
    const loaded: ModelMap = new Map(),
      missingVisual: string[] = [];
    for (const part of p.parts) {
      if (part.kind === "asset") {
        if (!part.assetId) throw Error("该版本缺少模型附件。");
        const response = await fetch("/api/assets?id=" + part.assetId);
        if (!response.ok) {
          if (isVisualReference(part)) {
            missingVisual.push(part.name);
            continue;
          }
          throw Error("制造零件模型附件读取失败：" + part.name);
        }
        loaded.set(part.id, await importModel(await response.arrayBuffer(), part.assetName ?? "model.glb", partUnitScale(part)));
      }
    }
    setModels(loaded);
    pending.current.clear();
    setProject(p);
    current.current = p;
    rememberProjectUrl(p);
    const initialPartId = p.parts.filter(isVisualReference).at(-1)?.id ?? p.parts[0]?.id ?? "";
    setSelected(initialPartId);
    setFocusedPartId(initialPartId);
    setPick(null);
    setRegion(null);
    setAnnotationResetKey((value) => value + 1);
    setEpoch((e) => e + 1);
    setDirty(false);
    const refs = p.references ?? [],
      single = refs.find((v) => !v.view),
      views = refs
        .filter((v) => v.view)
        .map((v) => ({
          assetId: v.id,
          name: v.name,
          url: "/api/assets?id=" + v.id,
          view: v.view as ViewKey,
        }));
    setReference(
      single
        ? {
            assetId: single.id,
            name: single.name,
            url: "/api/assets?id=" + single.id,
          }
        : null,
    );
    setMultiReferences(views);
    if (missingVisual.length) toast.warning("外观参考资产暂不可读，已保留其身份与历史证据；制造 CAD 仍可使用。");
  };
  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const rows = await api<SavedProject[]>("/api/projects");
        if (!active) return;
        setSaved(rows);
        const requestedProjectId = new URLSearchParams(window.location.search).get("project");
        const chosen = rows.find((item) => item.id === requestedProjectId);
        if (!chosen) {
          const blank = newProject();
          setProject(blank);
          rememberProjectUrl(blank);
          return;
        }
        const loaded = await api<Project>("/api/projects?id=" + chosen.id);
        if (!active) return;
        await hydrate(loaded);
        const waitingJobId = pendingAutoImport(loaded.id);
        if (waitingJobId) {
          setAutoImportJobId(waitingJobId);
          setTab("versions");
        }
        if (active) setRevisions(await api<Revision[]>("/api/revisions?projectId=" + chosen.id));
      } catch {
        if (active) setProject(newProject());
      }
    };
    void bootstrap();
    api<Connection>("/api/connections")
      .then((value) => {
        if (active) setConnections(value);
      })
      .catch((e) => {
        if (active) setConnectionError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const loadProject = async (id: string) => {
    if (dirty) await save();
    const p = await api<Project>("/api/projects?id=" + id);
    setAgentRun(null);
    setEditText("");
    await hydrate(p);
    setRevisions(await api<Revision[]>("/api/revisions?projectId=" + id));
    setShowAllRevisions(false);
  };
  const addBase = () => {
    if (!project) return;
    const p = {
      ...basePart(),
      profileId: project.processConfiguration?.profileId,
    };
    change({ ...project, parts: [...project.parts, p] }, "增加参数化底座。");
    setSelected(p.id);
  };
  const removeBases = () => {
    if (!project) return;
    const ids = new Set(project.parts.filter((part) => part.kind === "base").map((part) => part.id));
    if (!ids.size) return;
    change(
      {
        ...project,
        parts: project.parts.filter((part) => !ids.has(part.id)),
        checks: project.checks.filter((check) => !check.partId || !ids.has(check.partId)),
      },
      "移除参数化底座。",
    );
    setSelected("");
    setFocusedPartId("");
  };
  const importFile = async (file: File) => {
    if (!project) return;
    if (file.size > 25 * 1024 * 1024) throw Error("单个文件上限 25 MB，请先简化模型。");
    const scale = file.name.toLowerCase().endsWith(".glb") ? 1000 : unit === "cm" ? 10 : unit === "m" ? 1000 : 1;
    const obj = await importModel(await file.arrayBuffer(), file.name, scale);
    const m = measure(obj);
    const p: Part = {
      engineeringRole: "manufacturing",
      id: randomUuid(),
      name: file.name.replace(/\.[^.]+$/, ""),
      kind: "asset",
      params: { unitScale: scale },
      assetName: file.name,
      position: [0, 0, 0],
      interfaceLocked: true,
      profileId: project.processConfiguration?.profileId,
      color: "#8ab9cd",
      dimensions: m.size,
      triangles: m.triangles,
    };
    setModels((currentModels) => new Map(currentModels).set(p.id, obj));
    pending.current.set(p.id, file);
    change({ ...project, parts: [...project.parts, p] }, "导入模型 " + file.name);
    setSelected(p.id);
    setEpoch((e) => e + 1);
    toast.success("已载入模型；尺寸请按实物确认。");
  };
  const patchPart = (part: Part, next: Partial<Part>) => {
    if (!project) return;
    change(
      {
        ...project,
        parts: project.parts.map((p) => (p.id === part.id ? { ...p, ...next } : p)),
      },
      "修改零件 " + part.name,
    );
  };
  const assignPartProfile = async (partId: string, profileId: string) => {
    if (!project) return;
    await run("绑定零件私有工艺", async () => {
      const target = profiles.find((value) => value.id === profileId);
      if (!target) throw Error("私有工艺组合不存在。");
      const next = invalidate(
        {
          ...project,
          parts: project.parts.map((value) => (value.id === partId ? { ...value, profileId } : value)),
        },
        "给零件绑定私有工艺参数集。",
      );
      setProject(next);
      current.current = next;
      setDirty(true);
      await save();
      toast.success("设备、耗材与私有参数集已同步到零件。");
    });
  };
  const previewAI = async () => {
    if (!editText.trim()) throw Error("请写出要怎样返工，以及必须保持的结构或尺寸。");
    if (!region && !pick) throw Error("请先在三维视图圈选区域或点选一个表面位置。");
    const target = project?.parts.find((part) => part.id === (region?.anchor.partId ?? pick?.partId));
    if (!target || !["cad", "tripo", "visual_edit"].includes(target.source?.kind ?? "")) throw Error("请选中有受控来源的 CAD 制造件或 Tripo 外观模型。");
    if (target.source?.kind !== "cad" && (!region?.worldPath || !region.anchor.location.normal)) throw Error("外观模型改形需要在三维视图中画出有效区域，请重新圈选。");
    const p = dirty || !project?.revision ? await save() : project;
    if (region && region.image.size > 2 * 1024 * 1024) throw Error("圈选视图过大，请缩小浏览器窗口后重新圈选。");
    const goal = editText.trim(),
      selectionKey = JSON.stringify(region ? { anchor: region.anchor, path: region.path, worldPath: region.worldPath } : pick),
      pendingKey = `zaowu.pending-repair.${p.id}`;
    type PendingRepair = { selectionKey: string; body: { client_request_id: string; project_id: string; project_revision: number; goal: string; feedback: DesignFeedback } };
    let pending: PendingRepair | null = null;
    try {
      pending = JSON.parse(localStorage.getItem(pendingKey) ?? "null") as PendingRepair | null;
    } catch {
      localStorage.removeItem(pendingKey);
    }
    if (!pending || pending.selectionKey !== selectionKey || pending.body.project_revision !== p.revision || pending.body.goal !== goal) {
      const annotationImageAssetId = region
        ? (
            await upload(
              new File([region.image], "design-region.jpg", {
                type: "image/jpeg",
              }),
            )
          ).id
        : undefined;
      const designFeedback =
        region && annotationImageAssetId
          ? createRegionFeedback({ projectId: p.id, projectRevision: p.revision, anchor: region.anchor, path: region.path, worldPath: region.worldPath, annotationImageAssetId, userFeedback: goal })
          : pick
            ? createDesignFeedback({ projectId: p.id, projectRevision: p.revision, anchor: pick, userFeedback: goal })
            : undefined;
      if (!designFeedback) throw Error("返工任务缺少有效的三维圈选位置。");
      pending = { selectionKey, body: { client_request_id: randomUuid(), project_id: p.id, project_revision: p.revision, goal, feedback: designFeedback } };
      localStorage.setItem(pendingKey, JSON.stringify(pending));
    }
    const result = await api<AgentRun>("/api/agent/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending.body),
    });
    localStorage.removeItem(pendingKey);
    setAgentRun(result);
    setInspectorView("run");
    localStorage.setItem(`zaowu.repair-run.${p.id}`, result.run_id);
    if (result.status === "waiting_for_approval") toast.success("Planner 已生成返工计划，审批前不会修改工程数据。");
    else if (result.status === "waiting_for_clarification") toast.info("Planner 需要补充工程事实；回答后会重规划，仍需单独审批。");
    else if (result.status === "failed") toast.error(typeof result.failure?.message === "string" ? result.failure.message : "返工计划未能安全生成。");
    else if (result.status === "canceled") toast.info("返工任务已取消，未执行工程修改。");
    else toast.info("返工任务已创建，请查看下方 checkpoint 状态。");
  };
  const acceptAgentRun = async (next: AgentRun) => {
    setAgentRun(next);
    localStorage.setItem(`zaowu.repair-run.${next.project_id}`, next.run_id);
    if (next.status === "succeeded") {
      const updated = await api<Project>("/api/projects?id=" + next.project_id);
      const repaired = updated.parts.find((part) => part.assetId && next.final_asset_ids.includes(part.assetId));
      await hydrate(updated);
      if (repaired) {
        setSelected(repaired.id);
        setFocusedPartId(repaired.id);
      }
      setAgentRun(next);
      setRevisions(await api<Revision[]>("/api/revisions?projectId=" + next.project_id));
      requestAnimationFrame(() => modelStage.current?.scrollTo({ top: 0 }));
      toast.success(`返工闭环已完成并载入新版本 v${next.current_revision}。`);
    }
  };
  const decideAgentRun = async (choice: "approve" | "reject" | "modify", feedback?: string) => {
    if (!agentRun) return;
    const steps = Array.isArray(agentRun.plan?.steps) ? agentRun.plan.steps : [];
    const needsCadExecutor = steps.some((step) => typeof step === 'object' && step !== null && 'action' in step && ['change_cad_parameters', 'create_cad_design'].includes(String(step.action)));
    if (choice === "approve" && needsCadExecutor && !executor.connected) throw Error("请先在下方“连接本机建模”中连接执行器，再批准计划。");
    const next = await api<AgentRun>(`/api/agent/runs/${agentRun.run_id}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice, feedback: feedback || null }),
    });
    await acceptAgentRun(next);
  };
  const clarifyAgentRun = async (answers: string[]) => {
    if (!agentRun) return;
    const next = await api<AgentRun>(`/api/agent/runs/${agentRun.run_id}/clarifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    await acceptAgentRun(next);
  };
  const continueAgentRun = async () => {
    if (!agentRun) return;
    await acceptAgentRun(await api<AgentRun>(`/api/agent/runs/${agentRun.run_id}/continue`, { method: "POST" }));
  };
  const continueAgentRunEvent = useEffectEvent(continueAgentRun);
  const refreshAgentRun = async () => {
    if (!agentRun) return;
    await acceptAgentRun(await api<AgentRun>(`/api/agent/runs/${agentRun.run_id}`));
  };
  const resetAgentRun = () => {
    const projectId = project?.id ?? agentRun?.project_id;
    if (projectId) {
      localStorage.removeItem(`zaowu.repair-run.${projectId}`);
      localStorage.removeItem(`zaowu.pending-repair.${projectId}`);
    }
    setAgentRun(null);
    setRegion(null);
    setPick(null);
    setEditText("");
    setAnnotationResetKey((value) => value + 1);
    toast.info("已保留当前工程版本，可以重新圈选并发起下一轮返工。");
  };
  useEffect(() => {
    const projectId = project?.id;
    if (!projectId || agentRun?.project_id === projectId) return;
    let active = true;
    const runId = localStorage.getItem(`zaowu.repair-run.${projectId}`);
    if (runId)
      void api<AgentRun>(`/api/agent/runs/${runId}`)
        .then((value) => {
          if (active && value.project_id === projectId) {
            setAgentRun(value);
            setInspectorView("run");
          }
        })
        .catch(() => localStorage.removeItem(`zaowu.repair-run.${projectId}`));
    return () => {
      active = false;
    };
  }, [project?.id, agentRun?.project_id]);
  useEffect(() => {
    if (agentRun?.status !== "waiting_for_tool") return;
    const timer = window.setInterval(() => {
      if (!busyRef.current) void run("等待本机 CAD 执行", continueAgentRunEvent);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [agentRun?.run_id, agentRun?.status]);
  const changeTripoModel = (modelVersion: string) =>
    setTripoSpec((s) => {
      const p1 = modelVersion === "P1-20260311",
        p2 = modelVersion === "P2-20260801",
        quad = p1 ? false : s.quad,
        max = p1 ? 20_000 : p2 ? (quad ? 25_000 : 50_000) : 1_500_000,
        min = p1 ? 50 : 48;
      return {
        ...s,
        modelVersion,
        quad,
        faceLimit: Math.min(max, Math.max(min, s.faceLimit)),
        geometryQuality: p1 || p2 ? "standard" : s.geometryQuality,
        smartLowPoly: p1 || p2 ? false : s.smartLowPoly,
        generateParts: p1 || p2 ? false : s.generateParts,
      };
    });
  const generate = async (newIntent = false) => {
    const p = dirty || !project?.revision ? await save() : project;
    const inputKind = multiReferences.length >= 2 ? "multiview" : reference ? "image" : "text";
    const count = Math.max(1, Math.min(6, Math.trunc(tripoSpec.variantCount || 1)));
    const fingerprint = await sha256(
      JSON.stringify({
        projectId: p.id,
        projectRevision: p.revision,
        kind: inputKind,
        imageAssetId: reference?.assetId,
        multiviewAssets: multiReferences.map((v) => ({
          assetId: v.assetId,
          view: v.view,
        })),
        prompt: p.brief,
        tripoSpec,
      }),
    );
    const storageKey = "ai3d:tripo-submit:" + p.id;
    let intents: { fingerprint: string; ids: string[] } | null = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(saved?.ids)) intents = saved;
    } catch {}
    if (newIntent || intents?.fingerprint !== fingerprint || intents.ids.length !== count)
      intents = {
        fingerprint,
        ids: Array.from({ length: count }, () => randomUuid()),
      };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(intents));
    } catch {
      throw Error("浏览器无法保存本次重试编号，请先恢复会话存储；生成未提交。");
    }
    const results: {
      id: string;
      status: string;
      reused: boolean;
      providerTaskId?: string;
    }[] = [];
    for (let index = 0; index < count; index++) {
      const variantPrompt = (count > 1 ? String(p.brief || "") + "\n请生成第 " + (index + 1) + " 个独立方案，保持核心需求但改变外观表达与结构细节。" : String(p.brief || "")).slice(0, 1024);
      results.push(
        await api<{
          id: string;
          status: string;
          reused: boolean;
          providerTaskId?: string;
        }>("/api/tripo/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientRequestId: intents.ids[index],
            projectId: p.id,
            projectRevision: p.revision,
            kind: inputKind,
            imageAssetId: inputKind === "image" ? reference?.assetId : undefined,
            multiviewAssets:
              inputKind === "multiview"
                ? multiReferences.map((v) => ({
                    assetId: v.assetId,
                    view: v.view,
                  }))
                : undefined,
            prompt: variantPrompt,
            variantIndex: index + 1,
            modelVersion: tripoSpec.modelVersion,
            faceLimit: tripoSpec.faceLimit,
            texture: tripoSpec.texture,
            pbr: tripoSpec.pbr,
            textureQuality: tripoSpec.textureQuality,
            textureAlignment: inputKind === "text" ? undefined : tripoSpec.textureAlignment,
            geometryQuality: tripoSpec.geometryQuality,
            exportUv: tripoSpec.exportUv,
            autoSize: tripoSpec.autoSize,
            enableImageAutofix: tripoSpec.enableImageAutofix,
            orientation: tripoSpec.orientation,
            exportOrientation: tripoSpec.exportOrientation || undefined,
            modelSeed: tripoSpec.modelSeed === "" ? undefined : +tripoSpec.modelSeed,
            imageSeed: inputKind === "text" && tripoSpec.imageSeed !== "" ? +tripoSpec.imageSeed : undefined,
            textureSeed: tripoSpec.textureSeed === "" ? undefined : +tripoSpec.textureSeed,
            negativePrompt: tripoSpec.negativePrompt || undefined,
            smartLowPoly: tripoSpec.smartLowPoly,
            generateParts: tripoSpec.generateParts,
            quad: tripoSpec.quad,
            manufacturing: {
              targetProcess: p.preferredProcess,
              targetProfileId: tripoSpec.targetProfileId || p.processConfiguration?.profileId || undefined,
              targetMachine: tripoSpec.targetMachine || profiles.find((v) => v.id === p.processConfiguration?.profileId)?.machine || undefined,
              targetMaterial: tripoSpec.targetMaterial || profiles.find((v) => v.id === p.processConfiguration?.profileId)?.material || undefined,
              partStrategy: tripoSpec.partStrategy,
              assembly: tripoSpec.assembly,
              toleranceMm: tripoSpec.toleranceMm,
              needsBase: tripoSpec.needsBase,
              needsEnclosure: tripoSpec.needsEnclosure,
              needsManufacturingDrawing: tripoSpec.needsManufacturingDrawing,
              notes: tripoSpec.notes || undefined,
            },
          }),
        }),
      );
    }
    const queued = results.filter((v) => v.status === "queued").length,
      reused = results.filter((v) => v.reused).length;
    toast.info((reused === count ? "已找到同一组提交，未重复生成。" : queued + " 个方案已提交，页面将自动追踪。") + (count > 1 ? " 共 " + count + " 个方案。" : ""));
    const firstJobId = results[0]?.id ?? null;
    if (firstJobId) rememberAutoImport(p.id, firstJobId);
    setAutoImportJobId(firstJobId);
    setTab("versions");
  };
  const generateConcept = async (newIntent = false) => {
    const p = dirty || !project?.revision ? await save() : project;
    const extra = editText && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(editText) ? editText : "";
    const prompt = [p.brief, extra].filter(Boolean).join("\n").slice(0, 1024);
    if (!prompt.trim()) throw Error("请先填写产品设计要求，才能生成设定图。");
    const fingerprint = await sha256(
      JSON.stringify({
        projectId: p.id,
        projectRevision: p.revision,
        kind: "concept_image",
        prompt,
        imageModel: "seedream_v4",
        imageSize: "2K",
        outputFormat: "png",
        watermark: false,
        manufacturing: {
          targetProcess: p.preferredProcess,
          targetMachine: tripoSpec.targetMachine,
          targetMaterial: tripoSpec.targetMaterial,
          partStrategy: tripoSpec.partStrategy,
          assembly: tripoSpec.assembly,
          toleranceMm: tripoSpec.toleranceMm,
          needsBase: tripoSpec.needsBase,
          needsEnclosure: tripoSpec.needsEnclosure,
          needsManufacturingDrawing: tripoSpec.needsManufacturingDrawing,
          notes: tripoSpec.notes,
        },
      }),
    );
    const storageKey = "ai3d:tripo-concept:" + p.id;
    let clientRequestId = "";
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (!newIntent && saved?.fingerprint === fingerprint && typeof saved.clientRequestId === "string") clientRequestId = saved.clientRequestId;
    } catch {}
    if (!clientRequestId) clientRequestId = randomUuid();
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, clientRequestId }));
    } catch {
      throw Error("浏览器无法保存设定图重试编号，生成未提交。");
    }
    const result = await api<{ id: string; status: string; reused: boolean }>("/api/tripo/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId,
        projectId: p.id,
        projectRevision: p.revision,
        kind: "concept_image",
        operation: "generate",
        prompt,
        imageModel: "seedream_v4",
        imageSize: "2K",
        outputFormat: "png",
        watermark: false,
        manufacturing: {
          targetProcess: p.preferredProcess,
          targetMachine: tripoSpec.targetMachine || undefined,
          targetMaterial: tripoSpec.targetMaterial || undefined,
          partStrategy: tripoSpec.partStrategy,
          assembly: tripoSpec.assembly,
          toleranceMm: tripoSpec.toleranceMm,
          needsBase: tripoSpec.needsBase,
          needsEnclosure: tripoSpec.needsEnclosure,
          needsManufacturingDrawing: tripoSpec.needsManufacturingDrawing,
          notes: tripoSpec.notes || undefined,
        },
      }),
    });
    toast.info(result.reused ? "已找到同一张设定图提交，未重复生成。" : "设定图已提交，页面将自动追踪。");
    setTab("versions");
    setEditText(result.id);
  };
  const useTripoImage = (asset: { id: string; url: string; filename: string }) => {
    if (!project) return;
    setReference({ assetId: asset.id, name: asset.filename, url: asset.url });
    setMultiReferences([]);
    patch({ references: [{ id: asset.id, name: asset.filename }] });
    setTab("design");
    toast.success("设定图已作为 3D 参考图；请确认尺寸与结构后再生成模型。");
  };
  const importSelectedModel = async () => {
    if (!project) throw Error("项目尚未准备好。");
    const p = dirty || !project.revision ? await save() : project;
    const part = p.parts.find((v) => v.id === selected);
    if (!part?.assetId) throw Error("请先保存一个已导入的三维文件，再提交 Tripo。");
    const id = randomUuid();
    const result = await api<{ id: string; status: string }>("/api/tripo/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: id,
        projectId: p.id,
        projectRevision: p.revision,
        kind: "model",
        operation: "import",
        modelAssetId: part.assetId,
        modelVersion: tripoSpec.modelVersion,
        manufacturing: {
          targetProcess: project.preferredProcess,
          targetProfileId: tripoSpec.targetProfileId || p.processConfiguration?.profileId || undefined,
          targetMachine: tripoSpec.targetMachine || profiles.find((v) => v.id === p.processConfiguration?.profileId)?.machine || undefined,
          targetMaterial: tripoSpec.targetMaterial || profiles.find((v) => v.id === p.processConfiguration?.profileId)?.material || undefined,
          partStrategy: tripoSpec.partStrategy,
          assembly: tripoSpec.assembly,
          toleranceMm: tripoSpec.toleranceMm,
          needsBase: tripoSpec.needsBase,
          needsEnclosure: tripoSpec.needsEnclosure,
          needsManufacturingDrawing: tripoSpec.needsManufacturingDrawing,
          notes: tripoSpec.notes || undefined,
        },
      }),
    });
    toast.info(result.status === "queued" ? "三维文件已提交 Tripo 导入，可在版本页回收。" : "任务已记录：" + result.status);
    setTab("versions");
    setEditText(result.id);
  };
  const submitRawModel = async (file: File) => {
    if (!project) throw Error("项目尚未准备好。");
    if (file.size > 150 * 1024 * 1024) throw Error("三维文件超过 150 MB 上限。");
    if (!/\.(glb|gltf|fbx|obj|stl|3mf)$/i.test(file.name)) throw Error("支持 GLB/GLTF/FBX/OBJ/STL/3MF。");
    const p = dirty || !project.revision ? await save() : project;
    const asset = await upload(file);
    const id = randomUuid();
    const result = await api<{ id: string; status: string }>("/api/tripo/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: id,
        projectId: p.id,
        projectRevision: p.revision,
        kind: "model",
        operation: "import",
        modelAssetId: asset.id,
        modelVersion: tripoSpec.modelVersion,
        manufacturing: {
          targetProcess: project.preferredProcess,
          targetProfileId: tripoSpec.targetProfileId || p.processConfiguration?.profileId || undefined,
          targetMachine: tripoSpec.targetMachine || profiles.find((v) => v.id === p.processConfiguration?.profileId)?.machine || undefined,
          targetMaterial: tripoSpec.targetMaterial || profiles.find((v) => v.id === p.processConfiguration?.profileId)?.material || undefined,
          partStrategy: tripoSpec.partStrategy,
          assembly: tripoSpec.assembly,
          toleranceMm: tripoSpec.toleranceMm,
          needsBase: tripoSpec.needsBase,
          needsEnclosure: tripoSpec.needsEnclosure,
          needsManufacturingDrawing: tripoSpec.needsManufacturingDrawing,
          notes: tripoSpec.notes || undefined,
        },
      }),
    });
    toast.info(result.status === "queued" ? "模型文件已提交 Tripo 导入，可在版本页回收。" : "任务已记录：" + result.status);
    setTab("versions");
    setEditText(result.id);
  };
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  // Expose the same read and reversible edit actions to supported browser agents.
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (t: unknown, o: unknown) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const life = new AbortController();
    const register = (tool: unknown) => Promise.resolve(context.registerTool(tool, { signal: life.signal })).catch(() => {});
    void register({
      name: "read_engineering_project",
      description: "读取当前工程草稿及检查状态，不保存。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => current.current,
    });
    void register({
      name: "stage_base_dimensions",
      description: "修改选定参数化底座的外径与高度，保持孔接口，标记已有检查失效；尚未保存或生产。",
      inputSchema: {
        type: "object",
        properties: {
          partId: { type: "string" },
          diameter: { type: "number", exclusiveMinimum: 0 },
          height: { type: "number", exclusiveMinimum: 0 },
        },
        required: ["partId", "diameter", "height"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input: unknown) => {
        if (busyRef.current) throw Error("工程任务执行中，不能修改输入。");
        const x = input as { partId: string; diameter: number; height: number };
        const p = current.current;
        const part = p?.parts.find((v) => v.id === x.partId);
        if (!p || !part || part.kind !== "base" || !Number.isFinite(x.diameter) || !Number.isFinite(x.height) || x.diameter <= part.params.holeDiameter || x.diameter > 10000 || x.height <= 0 || x.height > 10000) throw Error("底座或尺寸无效。");
        const next = invalidate(
          {
            ...p,
            parts: p.parts.map((v) =>
              v.id === part.id
                ? {
                    ...v,
                    params: {
                      ...v.params,
                      diameter: x.diameter,
                      height: x.height,
                    },
                  }
                : v,
            ),
          },
          "通过工程工具修改底座外径与高度。",
        );
        setProject(next);
        current.current = next;
        setDirty(true);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          partId: part.id,
          params: next.parts.find((v) => v.id === part.id)?.params,
          saved: false,
        };
      },
    });
    return () => life.abort();
  }, []);
  if (!project) return <div className="initial-loading">正在打开工程工作区…</div>;
  const diagnostic = project.checks.find((c) => c.id === shownDiagnostic && c.partId === selected && c.status !== "stale")?.topology;
  const part = project.parts.find((p) => p.id === selected),
    base = project.parts.find((p) => p.kind === "base");
  const visualPresentation = !!part && isVisualReference(part);
  const activeAgentRun = agentRun?.project_id === project.id ? agentRun : null;
  const currentShellWidth = project.cadDesigns?.[0]?.parameters.outer_width?.value;
  const currentInputHash = project.checks
    .slice()
    .sort((a, b) => b.revision - a.revision)
    .find((c) => c.status === "passed" && c.provenance?.kind === "offline_slice")?.inputHash;
  const currentChecks = project.checks.filter((c) => (!c.partId || c.partId === selected) && isCurrentCheck(c, project, currentInputHash));
  return (
    <div className="app-shell">
      <Toaster position="bottom-right" />
      <Dialog open={multiOpen} onOpenChange={setMultiOpen}>
        <DialogContent className="multiview-dialog">
          <DialogHeader>
            <DialogTitle>多视图参考</DialogTitle>
            <DialogDescription>按步骤补充同一产品的不同方向，系统会把方向信息一起交给三维生成模型。</DialogDescription>
          </DialogHeader>
          <div className="multiview-steps" aria-label="多视图导入步骤">
            <span className={multiStep === 1 ? "active" : ""}>
              <b>1</b>选择方案
            </span>
            <span className={multiStep === 2 ? "active" : ""}>
              <b>2</b>上传图片
            </span>
            <span className={multiStep === 3 ? "active" : ""}>
              <b>3</b>检查确认
            </span>
          </div>
          {multiStep === 1 && (
            <div className="multiview-plan-grid">
              {(Object.keys(multiViewPlans) as MultiViewPlan[]).map((key) => {
                const option = multiViewPlans[key];
                return (
                  <button type="button" key={key} className={multiPlan === key ? "active" : ""} onClick={() => setMultiPlan(key)}>
                    <span>{option.badge}</span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                    <em>{option.views.map((view) => viewNames[view]).join(" · ")}</em>
                  </button>
                );
              })}
            </div>
          )}
          {multiStep === 2 && (
            <div className="multiview-upload-stage">
              <div className="multiview-slot-grid">
                {multiViewPlans[multiPlan].views.map((view, index) => (
                  <div key={view} className="multiview-slot">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{viewNames[view]}</strong>
                    <small>{view === "front" ? "必填 · 作为主体基准" : "保持与正面相同朝向"}</small>
                  </div>
                ))}
              </div>
              <div className="multiview-order-note">
                <strong>选择文件时请按上方顺序排列</strong>
                <span>建议使用相似距离、光线和背景；不要裁掉产品边缘。</span>
              </div>
            </div>
          )}
          {multiStep === 3 && (
            <div className="multiview-review">
              <div className="multiview-review-head">
                <span className="multiview-ready-dot" />
                <div>
                  <strong>{multiReferences.length ? `已就绪 · ${multiReferences.length} 张视图` : "等待上传视图"}</strong>
                  <small>格式、数量与方向将在提交三维任务时再次校验</small>
                </div>
              </div>
              <div className="multiview-review-grid">
                {multiReferences.map((v) => (
                  <article key={v.assetId}>
                    <img src={v.url} alt={viewNames[v.view!] + "参考图"} />
                    <div>
                      <Select value={v.view} onValueChange={(value) => updateMultiView(v.assetId, value as ViewKey)}>
                        <SelectTrigger aria-label={v.name + "视角"}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(viewNames) as ViewKey[]).map((view) => (
                            <SelectItem key={view} value={view}>
                              {viewNames[view]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <small title={v.name}>{v.name}</small>
                    </div>
                  </article>
                ))}
              </div>
              <ul className="multiview-checklist">
                <li>同一个物体、同一个设计版本</li>
                <li>产品顶部方向保持一致</li>
                <li>主体完整，无严重遮挡或广角变形</li>
              </ul>
            </div>
          )}
          <DialogFooter className="multiview-footer">
            {multiStep > 1 && (
              <Button variant="outline" onClick={() => setMultiStep((value) => (value - 1) as 1 | 2 | 3)}>
                上一步
              </Button>
            )}
            {multiStep === 1 && <Button onClick={() => setMultiStep(2)}>继续</Button>}
            {multiStep === 2 && (
              <Button onClick={() => multiPicker.current?.click()}>
                <Upload size={16} />
                选择 {multiViewPlans[multiPlan].views.length} 张图片
              </Button>
            )}
            {multiStep === 3 && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMultiReferences([]);
                    patch({ references: [] });
                    setMultiStep(1);
                  }}
                >
                  重新开始
                </Button>
                <Button disabled={!multiReferences.length} onClick={() => setMultiOpen(false)}>
                  确认使用
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <header className="topbar">
        <Link className="brand" href="/" data-no-translate>
          <span className="brand-icon">
            <Image src="/brand/spike-defense-logo.svg" alt="" width={34} height={34} priority />
          </span>
          <span className="brand-copy">
            <strong>尖锋防务-3DPrintHub</strong>
            <span>{t("brandTagline")}</span>
          </span>
        </Link>
        <div className="topbar-actions" data-no-translate>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="topbar-action topbar-login">
                <CircleUserRound size={16} />
                <span>{t("login")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="demo-account-popover" data-no-translate>
              <PopoverHeader>
                <span className="demo-account-icon"><CircleUserRound size={21} /></span>
                <span>
                  <PopoverTitle>{t("demoAccount")}</PopoverTitle>
                  <strong>{t("demoAccountName")}</strong>
                </span>
              </PopoverHeader>
              <PopoverDescription>{t("demoAccountHint")}</PopoverDescription>
              <div className="demo-account-status"><ShieldCheck size={14} /> DEMO UI · NO AUTH</div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="topbar-action icon-only"
            aria-label={resolvedTheme === "dark" ? t("themeLight") : t("themeDark")}
            title={resolvedTheme === "dark" ? t("themeLight") : t("themeDark")}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="topbar-action language-toggle"
            aria-label={t("language")}
            title={t("language")}
            onClick={toggleLocale}
          >
            <Languages size={16} />
            <span>{locale === "zh-CN" ? "中 / EN" : "EN / 中"}</span>
          </Button>
        </div>
      </header>
      <Tabs
        inert={!!busy}
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          if (v === "connections")
            void api<Connection>("/api/connections")
              .then((c) => {
                setConnections(c);
                setConnectionError("");
              })
              .catch((e) => setConnectionError(e.message));
          if (v === "versions")
            void run("读取版本", async () => {
              await refreshProjects();
              if (project.revision) setRevisions(await api<Revision[]>("/api/revisions?projectId=" + project.id));
            });
        }}
        className="main-tabs"
      >
        <div className="navline">
          <TabsList variant="line" data-no-translate>
            <TabsTrigger value="design">
              <Move3D />
              {t("navDesign")}
            </TabsTrigger>
            <TabsTrigger value="cad">
              <Box />
              {t("navCad")}
            </TabsTrigger>
            <TabsTrigger value="processes">
              <BookOpen />
              {t("navProcesses")}
            </TabsTrigger>
            <TabsTrigger value="slicing">
              <Layers3 />
              {t("navOutput")}
            </TabsTrigger>
            <TabsTrigger value="versions">
              <History />
              {t("navVersions")}
            </TabsTrigger>
            <TabsTrigger value="connections">
              <Settings2 />
              {t("navConnections")}
            </TabsTrigger>
          </TabsList>
          <div className="nav-project-status" data-no-translate>
            <span className="status-dot" />
            <span className="nav-project-title">{project.title || "新项目"}</span>
            <span className="version-badge">v{project.revision}</span>
            <span className="nav-project-state">{dirty ? t("unsaved") : project.revision ? t("synced") : t("notSaved")}</span>
          </div>
        </div>
        <TabsContent value="design" className="workspace" data-repair-active={activeAgentRun ? "true" : undefined} data-inspector-view={inspectorView}>
          <aside className="brief-panel">
            <div className="project-actions" aria-label="项目操作">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  run("新建项目", async () => {
                    if (dirty) await save();
                    await hydrate(newProject());
                    setRevisions([]);
                    setAgentRun(null);
                    setAutoImportJobId(null);
                    setEditText("");
                  })
                }
              >
                <Plus size={16} />
                <span>新项目</span>
              </Button>
              <Button variant="outline" disabled={!!busy} onClick={() => picker.current?.click()}>
                <Upload size={16} />
                <span>导入模型</span>
              </Button>
              <Button disabled={!!busy || !project.title.trim() || project.targetSize <= 0} onClick={() => run("保存版本", async () => void (await save()))}>
                <Save size={16} />
                <span>{busy || "保存版本"}</span>
              </Button>
            </div>
            <div className={"base-status " + (base ? "enabled" : "")}>
              <div>
                <span className="base-kicker">
                  参数化底座 <em>可选</em>
                </span>
                <strong>{base ? `已启用 · Ø${base.params.diameter ?? "—"} × ${base.params.height ?? "—"} mm` : "未启用"}</strong>
                <small>{base ? "模型组成部分，不是打印支撑" : "需要承托或展示平台时再开启"}</small>
              </div>
              <div className="base-status-actions">
                {base && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(base.id);
                      setFocusedPartId(base.id);
                    }}
                  >
                    设置
                  </button>
                )}
                <Switch aria-label="启用参数化底座" checked={!!base} onCheckedChange={(checked) => (checked ? addBase() : removeBases())} disabled={!!busy} />
              </div>
            </div>
            <div className="section-title">
              <h1>产品需求</h1>
              <Sparkles size={18} />
            </div>
            <label className="field-label" htmlFor="title">
              项目名称
            </label>
            <Input id="title" value={project.title} onChange={(e) => patch({ title: e.target.value })} placeholder="请输入项目名称" />
            <label className="field-label" htmlFor="brief">
              设计要求
            </label>
            <Textarea id="brief" value={project.brief} onChange={(e) => patch({ brief: e.target.value })} placeholder="例如：整体约 155 × 100 × 35 mm，低矮横向圆角机身，哑光白色一体外壳，较小的纯黑无字显示窗嵌入顶面…" rows={4} />
            <p className="field-hint">外形比例由这里的长 × 宽 × 高决定；下面的尺寸只控制成品导入后的整体大小。</p>
            <div className="reference-actions">
              <Button variant="outline" className="reference-upload single-reference-upload" disabled={!!busy} onClick={() => imagePicker.current?.click()}>
                <Upload size={16} />
                {reference ? reference.name : "加入单张图片"}
              </Button>
              <Button variant="outline" className="reference-upload multiview-reference-upload" disabled={!!busy} onClick={openMultiView}>
                <Layers3 size={16} />
                {multiReferences.length ? `多视图 ${multiReferences.length} 张` : "加入多视图"}
              </Button>
            </div>
            {(reference || multiReferences.length > 0) && (
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => {
                setReference(null);
                setMultiReferences([]);
                patch({ references: [] });
              }}>
                清除参考图，改用文字生成
              </Button>
            )}
            <p className="field-hint reference-constraint-hint">可选：加入一张确认过的外观参考图。单图生成主要依据图片，请让图片包含设计要求中的关键特征；成品最长边只控制回收后的整体缩放。</p>
            <input
              ref={imagePicker}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void run("上传参考图", async () => {
                    if (f.size > 20 * 1024 * 1024) throw Error("参考图上限 20 MB。");
                    if (!/^image\/(?:jpeg|png|webp)$/.test(f.type)) throw Error("参考图仅支持 PNG/JPEG/WebP。");
                    const a = await upload(f);
                    setReference({
                      assetId: a.id,
                      name: f.name,
                      url: "/api/assets?id=" + a.id,
                    });
                    setMultiReferences([]);
                    patch({ references: [{ id: a.id, name: f.name }] });
                  });
                e.target.value = "";
              }}
            />
            <input
              ref={multiPicker}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length)
                  void run("上传多视图参考", async () => {
                    await uploadMultiView(files, multiViewPlans[multiPlan].views);
                    setMultiStep(3);
                  });
                e.target.value = "";
              }}
            />
            <Button className="wide primary-generate" disabled={!!busy || !connections?.tripo.configured || !project.title.trim() || project.targetSize <= 0 || (!project.brief.trim() && !reference && multiReferences.length < 2)} onClick={() => run("提交三维任务", () => generate())}>
              <Sparkles size={16} />
              生成三维方案
            </Button>
            {reference && <img src={reference.url} alt="产品参考图" className="reference-image" />}
            <div className="field-pair">
              <div>
                <label className="field-label">应用领域</label>
                <Select value={project.domain} onValueChange={(v) => patch({ domain: v })}>
                  <SelectTrigger aria-label="应用领域">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="creative">文创与玩具</SelectItem>
                    <SelectItem value="industrial">工业产品</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="field-label" htmlFor="size">
                  成品最长边 / mm
                </label>
                <Input id="size" type="number" min="1" value={project.targetSize || ""} onChange={(e) => patch({ targetSize: +e.target.value })} />
                <p className="field-hint">应与设计要求中的最长边一致。</p>
              </div>
            </div>
            <label className="field-label">优先工艺</label>
            <Select value={project.preferredProcess} onValueChange={(v) => patch({ preferredProcess: v })}>
              <SelectTrigger aria-label="优先工艺">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p[0]} value={p[0]}>
                    {p[0]} · {p[1]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="process-preflight">
              <span>{project.processConfiguration ? processConfigurationSummary(project.processConfiguration) : "尚未配置机器、工艺与耗材参数集"}</span>
              <Button variant="link" size="sm" onClick={() => setTab("processes")}>
                {project.processConfiguration ? "调整参数集" : "设置参数集"}
              </Button>
            </div>
            <div className="field-pair">
              <div>
                <label className="field-label">连接方式</label>
                <Select value={project.connection} onValueChange={(v) => patch({ connection: v })}>
                  <SelectTrigger aria-label="连接方式">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="screw">螺丝</SelectItem>
                    <SelectItem value="glue">胶接</SelectItem>
                    <SelectItem value="one">一体</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="field-label" htmlFor="quantity">
                  计划数量
                </label>
                <Input id="quantity" type="number" min="1" value={project.quantity} onChange={(e) => patch({ quantity: +e.target.value })} />
              </div>
            </div>
            <details className="tripo-advanced">
              <summary>约束条件</summary>
              <div className="field-pair">
                <div>
                  <label className="field-label">模型版本</label>
                  <Select value={tripoSpec.modelVersion} onValueChange={changeTripoModel}>
                    <SelectTrigger aria-label="Tripo 模型版本">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="v3.1-20260211">v3.1 · 生产稳定</SelectItem>
                      <SelectItem value="v3.0-20250812">v3.0 · 稳定兼容</SelectItem>
                      <SelectItem value="P2-20260801">P2 · 新版拓扑</SelectItem>
                      <SelectItem value="P1-20260311">P1 · 低面数</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="field-label">面数上限</label>
                  <Input
                    type="number"
                    min="48"
                    max="1500000"
                    value={tripoSpec.faceLimit}
                    onChange={(e) =>
                      setTripoSpec((s) => ({
                        ...s,
                        faceLimit: +e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="field-pair tripo-three">
                <div>
                  <label className="field-label">方案数量</label>
                  <Input
                    type="number"
                    min="1"
                    max="6"
                    value={tripoSpec.variantCount}
                    onChange={(e) =>
                      setTripoSpec((s) => ({
                        ...s,
                        variantCount: Math.max(1, Math.min(6, Math.trunc(+e.target.value || 1))),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="field-label">纹理质量</label>
                  <Select value={tripoSpec.textureQuality} onValueChange={(v) => setTripoSpec((s) => ({ ...s, textureQuality: v }))}>
                    <SelectTrigger aria-label="纹理质量">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">标准</SelectItem>
                      <SelectItem value="detailed">高清</SelectItem>
                      <SelectItem value="extreme">极高</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="field-label">纹理对齐</label>
                  <Select value={tripoSpec.textureAlignment} disabled={!reference && multiReferences.length < 2} onValueChange={(v) => setTripoSpec((s) => ({ ...s, textureAlignment: v }))}>
                    <SelectTrigger aria-label="纹理对齐">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original_image">优先匹配参考图</SelectItem>
                      <SelectItem value="geometry">优先匹配几何</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="field-label">几何质量</label>
                  <Select value={tripoSpec.geometryQuality} disabled={tripoSpec.modelVersion === "P1-20260311" || tripoSpec.modelVersion === "P2-20260801" || tripoSpec.modelVersion === "v2.5-20250123"} onValueChange={(v) => setTripoSpec((s) => ({ ...s, geometryQuality: v }))}>
                    <SelectTrigger aria-label="几何质量">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">标准</SelectItem>
                      <SelectItem value="detailed">精细</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="field-pair">
                <div>
                  <label className="field-label">模型随机种子</label>
                  <Input type="number" min="0" max="2147483647" value={tripoSpec.modelSeed} onChange={(e) => setTripoSpec((s) => ({ ...s, modelSeed: e.target.value }))} placeholder="留空则随机" />
                </div>
                <div>
                  <label className="field-label">文本图像种子</label>
                  <Input type="number" min="0" max="2147483647" value={tripoSpec.imageSeed} disabled={!!reference || multiReferences.length >= 2} onChange={(e) => setTripoSpec((s) => ({ ...s, imageSeed: e.target.value }))} placeholder="仅文字生成可用" />
                </div>
                <div>
                  <label className="field-label">纹理随机种子</label>
                  <Input
                    type="number"
                    min="0"
                    max="2147483647"
                    value={tripoSpec.textureSeed}
                    onChange={(e) =>
                      setTripoSpec((s) => ({
                        ...s,
                        textureSeed: e.target.value,
                      }))
                    }
                    placeholder="留空则随机"
                  />
                </div>
              </div>
              <div className="switch-grid">
                <label>
                  <Switch checked={tripoSpec.texture} onCheckedChange={(v) => setTripoSpec((s) => ({ ...s, texture: v }))} />
                  生成纹理
                </label>
                <label>
                  <Switch checked={tripoSpec.pbr} onCheckedChange={(v) => setTripoSpec((s) => ({ ...s, pbr: v }))} />
                  PBR 材质
                </label>
                <label>
                  <Switch
                    checked={tripoSpec.generateParts}
                    disabled={tripoSpec.modelVersion === "P1-20260311" || tripoSpec.modelVersion === "P2-20260801" || tripoSpec.modelVersion === "v2.5-20250123"}
                    onCheckedChange={(v) =>
                      setTripoSpec((s) => ({
                        ...s,
                        generateParts: v,
                        smartLowPoly: false,
                        texture: false,
                        pbr: false,
                        quad: false,
                      }))
                    }
                  />
                  尝试生成分件
                </label>
                <label>
                  <Switch
                    checked={tripoSpec.smartLowPoly}
                    disabled={tripoSpec.modelVersion === "P1-20260311" || tripoSpec.modelVersion === "P2-20260801" || tripoSpec.modelVersion === "v2.5-20250123"}
                    onCheckedChange={(v) =>
                      setTripoSpec((s) => ({
                        ...s,
                        smartLowPoly: v,
                        generateParts: v ? false : s.generateParts,
                      }))
                    }
                  />
                  低面数拓扑
                </label>
                <label>
                  <Switch checked={tripoSpec.autoSize} onCheckedChange={(v) => setTripoSpec((s) => ({ ...s, autoSize: v }))} />
                  自动真实尺寸
                </label>
                <label>
                  <Switch checked={tripoSpec.enableImageAutofix} onCheckedChange={(v) => setTripoSpec((s) => ({ ...s, enableImageAutofix: v }))} />
                  图片自动修复
                </label>
                <label>
                  <Switch
                    checked={tripoSpec.quad}
                    disabled={tripoSpec.modelVersion === "P1-20260311" || tripoSpec.modelVersion === "v2.5-20250123"}
                    onCheckedChange={(v) =>
                      setTripoSpec((s) => ({
                        ...s,
                        quad: v,
                        generateParts: false,
                      }))
                    }
                  />
                  P2 四边形网格
                </label>
                <label>
                  <Switch
                    checked={tripoSpec.needsManufacturingDrawing}
                    onCheckedChange={(v) =>
                      setTripoSpec((s) => ({
                        ...s,
                        needsManufacturingDrawing: v,
                      }))
                    }
                  />
                  制造图纸需求
                </label>
              </div>
              <div className="field-pair">
                <div>
                  <label className="field-label">图片朝向</label>
                  <Select value={tripoSpec.orientation} onValueChange={(v) => setTripoSpec((s) => ({ ...s, orientation: v }))}>
                    <SelectTrigger aria-label="图片输出朝向">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">默认朝向</SelectItem>
                      <SelectItem value="align_image">按图片对齐</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="field-label">导出前向轴</label>
                  <Select
                    value={tripoSpec.exportOrientation || "none"}
                    onValueChange={(v) =>
                      setTripoSpec((s) => ({
                        ...s,
                        exportOrientation: v === "none" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger aria-label="导出前向轴">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不指定（推荐后处理）</SelectItem>
                      <SelectItem value="+x">+X</SelectItem>
                      <SelectItem value="-x">-X</SelectItem>
                      <SelectItem value="-y">-Y</SelectItem>
                      <SelectItem value="+y">+Y</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="field-label">目标工艺配置</label>
                  <Select
                    value={tripoSpec.targetProfileId || "none"}
                    onValueChange={(v) =>
                      setTripoSpec((s) => {
                        const p = profiles.find((x) => x.id === v);
                        return {
                          ...s,
                          targetProfileId: v === "none" ? "" : v,
                          targetMachine: p?.machine ?? (v === "none" ? "" : s.targetMachine),
                          targetMaterial: p?.material ?? (v === "none" ? "" : s.targetMaterial),
                        };
                      })
                    }
                  >
                    <SelectTrigger aria-label="目标工艺配置">
                      <SelectValue placeholder="未绑定资料库配置" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未绑定资料库配置</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {processLabels[p.process] ?? p.process} · {p.machine} · {p.material}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="field-label">目标设备</label>
                  <Input
                    value={tripoSpec.targetMachine}
                    onChange={(e) =>
                      setTripoSpec((s) => ({
                        ...s,
                        targetProfileId: "",
                        targetMachine: e.target.value,
                      }))
                    }
                    placeholder="如拓竹 X1C / 联泰 SLA"
                  />
                </div>
                <div>
                  <label className="field-label">目标材料</label>
                  <Input
                    value={tripoSpec.targetMaterial}
                    onChange={(e) =>
                      setTripoSpec((s) => ({
                        ...s,
                        targetProfileId: "",
                        targetMaterial: e.target.value,
                      }))
                    }
                    placeholder="如 ABS / Tough Resin"
                  />
                </div>
              </div>
              <div className="field-pair">
                <div>
                  <label className="field-label">零件策略</label>
                  <Select value={tripoSpec.partStrategy} onValueChange={(v) => setTripoSpec((s) => ({ ...s, partStrategy: v }))}>
                    <SelectTrigger aria-label="零件策略">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">由工程台判断</SelectItem>
                      <SelectItem value="single">尽量一体</SelectItem>
                      <SelectItem value="split">优先拆件</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="field-label">接口公差 / mm</label>
                  <Input
                    type="number"
                    min="0.01"
                    max="20"
                    step="0.01"
                    value={tripoSpec.toleranceMm}
                    onChange={(e) =>
                      setTripoSpec((s) => ({
                        ...s,
                        toleranceMm: +e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <label className="field-label">反向提示词</label>
              <Input
                value={tripoSpec.negativePrompt}
                onChange={(e) =>
                  setTripoSpec((s) => ({
                    ...s,
                    negativePrompt: e.target.value,
                  }))
                }
                placeholder="如 broken mesh, thin walls, floating parts"
              />
              <label className="field-label">工程备注</label>
              <Textarea rows={2} value={tripoSpec.notes} onChange={(e) => setTripoSpec((s) => ({ ...s, notes: e.target.value }))} placeholder="量产限制、不可改变的外观特征、必须保留的孔位…" />
              <p className="hint">这些字段会进入可追溯的任务请求和提示上下文；它们不会伪装成切片参数，切片仍需按设备与材料校准。</p>
            </details>
            <details className="secondary-generation">
              <summary>更多生成方式</summary>
              <Button variant="outline" className="wide" disabled={!!busy || !connections?.tripo.configured || !project.brief} onClick={() => run("生成设定图", () => generateConcept())}>
                <Sparkles size={16} />
                生成设定图（2D）
              </Button>
              <Button variant="outline" className="wide" disabled={!!busy || !connections?.tripo.configured || !project.parts.find((v) => v.id === selected)?.assetId} onClick={() => run("提交现有模型给 Tripo", importSelectedModel)}>
                将当前三维文件送入 Tripo
              </Button>
              <Button variant="outline" className="wide" disabled={!!busy || !connections?.tripo.configured} onClick={() => tripoModelPicker.current?.click()}>
                上传模型文件到 Tripo
              </Button>
              <input
                ref={tripoModelPicker}
                type="file"
                accept=".glb,.gltf,.fbx,.obj,.stl,.3mf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void run("上传模型到 Tripo", () => submitRawModel(f));
                  e.target.value = "";
                }}
              />
              <p className="hint">{connections?.tripo.configured ? "调用 Tripo v3 生成或导入模型，并可用设定图作为后续参考；之后仍需工程检查。" : "Tripo 尚未配置。现在可以导入模型，或增加参数化底座。"}</p>
              {connections?.tripo.configured && (
                <>
                  <Button variant="ghost" size="sm" disabled={!!busy || (!project.brief && !reference && multiReferences.length < 2)} onClick={() => run("另起一个三维方案", () => generate(true))}>
                    另起一个方案
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!!busy || !project.brief} onClick={() => run("另起一张设定图", () => generateConcept(true))}>
                    另起一张设定图
                  </Button>
                  <p className="hint">相同要求重试会复用提交编号；“另起”按钮会生成新的任务。</p>
                </>
              )}
            </details>
          </aside>
          <section className="model-stage" ref={modelStage}>
            <div className="stage-toolbar">
              <span>
                <Box size={16} />
                三维预览 · 实际尺寸
              </span>
              <span className="stage-toolbar-status">{visualPresentation && project.parts.some(isVisualReference) ? "当前 1 个方案 · 单位 mm" : `${project.parts.length} PARTS · UNIT MM`}</span>
            </div>
            {project.parts.length ? (
              <div className="viewer-wrap">
                <ModelViewer project={project} models={modelMap} epoch={epoch} focusedPartId={focusedPartId} activeRegion={region} onClearFocus={() => setFocusedPartId("")} onSelect={onSelect} onPick={onPick} onRegion={onRegion} annotationResetKey={annotationResetKey} diagnostic={diagnostic} presentationMode={visualPresentation} />
                <span className="viewer-help">拖动旋转 · 滚轮缩放 · 点击定位 · 圈选标记改版区域</span>
              </div>
            ) : (
              <div className="model-empty">
                <div className="model-symbol">
                  <FileBox size={52} strokeWidth={1} />
                </div>
                <h2>从一个模型开始</h2>
                <p>使用左侧“导入模型”，或开启可选参数化底座。</p>
                <span className="supported">STL · OBJ · GLB（嵌入贴图）</span>
              </div>
            )}
            <input
              ref={picker}
              type="file"
              accept=".stl,.obj,.glb"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void run("解析模型", () => importFile(f));
                e.target.value = "";
              }}
            />
            <div className="stage-footer">
              <span>{visualPresentation && project.parts.some(isVisualReference) ? "当前显示 1 个外观方案 · 工程草稿" : `${project.parts.length} 个零件 · 工程草稿`}</span>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger aria-label="STL和OBJ源单位" className="unit-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mm">STL / OBJ 源单位：mm</SelectItem>
                  <SelectItem value="cm">STL / OBJ 源单位：cm</SelectItem>
                  <SelectItem value="m">STL / OBJ 源单位：m</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="edit-bar">
              <div className="edit-bar-heading">
                <label htmlFor="edit-request">AI 改版建议</label>
                <span>区域标记 · 需求分析 · 工程动作</span>
              </div>
              <div className="edit-compose">
                <Textarea id="edit-request" value={editText} onChange={(e) => setEditText(e.target.value)} placeholder={region && typeof currentShellWidth === "number" ? `例如：将白色机身总宽从 ${currentShellWidth} mm 调整为新尺寸，四个 M3 安装孔和 USB-C 接口保持不变` : region ? "描述圈选区域要怎样修改，以及必须保持的结构或尺寸" : "例如：调整外壳开口，同时保持安装孔和接口不变"} rows={3} />
                <Button disabled={!!busy || !connections?.agent?.configured || !editText.trim() || (!region && !pick)} onClick={() => run("创建返工 Agent 任务", previewAI)}>
                  <Sparkles size={16} />
                  生成返工计划
                </Button>
              </div>
              {busy && /返工|重规划/.test(busy) && <p className="hint" role="status" aria-live="polite">{busy}，请稍候；完成后会在这里展示计划或执行结果。</p>}
              <details ref={executorDetails} className="repair-executor-setup" data-connected={executor.connected || undefined}>
                <summary>{executor.connected ? "本机建模已连接 · 管理连接" : "本机建模未连接 · 点击配对"}</summary>
                <LocalExecutorPanel executor={executor} run={run}/>
              </details>
              {region ? (
                <div className="design-feedback-anchor selected">
                  <span className="design-feedback-anchor-icon">
                    <ScanLine size={16} />
                  </span>
                  <span className="design-feedback-anchor-copy">
                    <strong>修改区域已定位</strong>
                    <small>{displayPartName(project.parts.find((value) => value.id === region.anchor.partId)?.name ?? region.anchor.partId)} · 视角已锁定</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onRegion(null);
                      setAnnotationResetKey((value) => value + 1);
                    }}
                  >
                    清除
                  </button>
                </div>
              ) : (
                pick && (
                  <div className="design-feedback-anchor">
                    <span>
                      已定位 · {displayPartName(project.parts.find((value) => value.id === pick.partId)?.name ?? pick.partId)} · face {pick.location.faceIndex ?? "—"} · {pick.location.world.map((value) => value.toFixed(1)).join(", ")} mm
                    </span>
                    <button type="button" onClick={() => setPick(null)}>
                      清除
                    </button>
                  </div>
                )
              )}
              <p>圈选位置和修改要求会进入返工规划。计划需人工批准后才会修改工程版本。</p>
            </div>
          </section>
          <aside className="engineering-panel">
            {activeAgentRun && <div className="inspector-switch"><strong>零件详情</strong><Button variant="outline" size="sm" onClick={() => setInspectorView("run")}>查看返工进度</Button></div>}
            <div className="section-title">
              <h2>零件与工程检查</h2>
              <Layers3 size={18} />
            </div>
            <div className="part-list">
              {project.parts.map((p) => (
                <button
                  key={p.id}
                  className={p.id === selected ? "part-row active" : "part-row"}
                  onClick={() => {
                    if (region && region.anchor.partId !== p.id) {
                      onRegion(null);
                      setAnnotationResetKey((value) => value + 1);
                    }
                    onSelect(p.id);
                  }}
                >
                  <Box size={15} />
                  <span>
                    {p.name}
                    <small>{partEngineeringRole(p)}</small>
                  </span>
                  {p.interfaceLocked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
              ))}
              {!project.parts.length && <p className="hint">加入模型后，可为每个零件选择制造工艺。</p>}
            </div>
            {part && (
              <div className="part-editor">
                <label className="field-label" htmlFor="part-name">
                  零件名称
                </label>
                <Input id="part-name" value={part.name} onChange={(e) => patchPart(part, { name: e.target.value })} />
                <PartReasoning project={project} part={part} configured={!!connections?.ai.configured} dirty={dirty} />
                {part.kind === "base" &&
                  (["diameter", "height", "holeDiameter"] as const).map((k) => (
                    <div key={k}>
                      <label className="field-label" htmlFor={k}>
                        {
                          {
                            diameter: "外径",
                            height: "高度",
                            holeDiameter: "中孔直径",
                          }[k]
                        }{" "}
                        / mm
                      </label>
                      <Input
                        id={k}
                        type="number"
                        min={k === "holeDiameter" ? 0 : 0.1}
                        max="10000"
                        disabled={k === "holeDiameter" && part.interfaceLocked}
                        value={part.params[k]}
                        onChange={(e) => {
                          const value = +e.target.value;
                          if (value >= 0 && value <= 10000)
                            patchPart(part, {
                              params: { ...part.params, [k]: value },
                            });
                        }}
                      />
                    </div>
                  ))}
                {part.source?.kind === "cad" && <p className="hint">CAD Engineering Asset · manufacturing。接口在 CAD 参数源中管理；参数改动后需重新生成并附加模型。</p>}
                {isVisualReference(part) && <p className="hint">外观参考模型：用于设计对照，不进入物料清单、制造计划或切片任务。</p>}
                {part.kind === "asset" && (
                  <p className="hint">
                    包围盒：
                    {part.dimensions?.map((v) => v.toFixed(2)).join(" × ")} mm
                    <br />
                    {part.triangles?.toLocaleString()} 个三角面
                  </p>
                )}
                <div className="lock-row">
                  <label htmlFor="lock-interface">锁定接口</label>
                  <Switch id="lock-interface" checked={part.interfaceLocked} disabled={part.source?.kind === "cad"} onCheckedChange={(v) => patchPart(part, { interfaceLocked: v })} />
                </div>
                <label className="field-label">私有工艺参数集</label>
                <Select value={part.profileId ?? "none"} onValueChange={(v) => patchPart(part, { profileId: v === "none" ? undefined : v })}>
                  <SelectTrigger aria-label="零件私有工艺参数集">
                    <SelectValue placeholder="未分配" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未分配</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.machine} · {p.material} · {privateProcessSet(p)?.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  className="remove-part"
                  onClick={() => {
                    change(
                      {
                        ...project,
                        parts: project.parts.filter((p) => p.id !== part.id),
                        checks: project.checks.filter((c) => c.partId !== part.id),
                      },
                      "移除零件 " + part.name,
                    );
                    setSelected("");
                  }}
                >
                  <Trash2 size={14} />
                  移除零件
                </Button>
              </div>
            )}
            <Button
              variant="outline"
              className="wide"
              disabled={!project.parts.length || !!busy}
              onClick={() =>
                run("保存并检查模型", async () => {
                  const snapshot = dirty || !project.revision ? await save() : project;
                  const checks = await digitalChecks(snapshot, models.current, setBusy);
                  const checked = { ...snapshot, checks };
                  setProject(checked);
                  current.current = checked;
                  setDirty(true);
                  setShownDiagnostic("");
                  await save();
                  toast.success("检查记录已保存；正在查看输出结果。");
                  setTab("slicing");
                })
              }
            >
              <Check size={16} />
              保存并检查模型
            </Button>
            <div className="check-list">
              {currentChecks.map((c) => (
                <div key={c.id} className={"check-row " + c.status}>
                  <span />
                  <div>
                    <strong>{c.name}</strong>
                    <p>{c.detail}</p>
                    <small>
                      {
                        {
                          passed: "当前已通过",
                          failed: "当前未通过",
                          not_run: "当前未执行",
                          stale: "已过期，需重检",
                        }[c.status]
                      }
                    </small>
                    {c.topology && <TopologyDetails evidence={c} showing={shownDiagnostic === c.id} onShow={() => setShownDiagnostic(shownDiagnostic === c.id ? "" : c.id)} />}
                  </div>
                </div>
              ))}
            </div>
            <Button
              className="wide"
              variant="outline"
              disabled={!project.parts.length || !!busy}
              onClick={() =>
                run("导出工程包", async () => {
                  const exported = dirty || !project.revision ? await save() : project;
                  download(await exportEngineering(exported, models.current), exported.title.replace(/[\\/:*?"<>|]/g, "-") + "-v" + exported.revision + "-engineering-package.zip");
                })
              }
            >
              <Download size={16} />
              下载当前工程包 v{project.revision}
            </Button>
            <p className="hint">工程包包含 CAD 实体、执行来源记录、制造 STL、切片任务与结果、工艺配置及追溯信息。外观参考模型单独保存；实物测试和生产放行尚未完成。</p>
          </aside>
          {activeAgentRun && (
            <aside className="agent-inspector" aria-label="设计修改进度">
              <div className="inspector-switch"><strong>设计修改</strong><Button variant="outline" size="sm" onClick={() => setInspectorView("parts")}>查看零件详情</Button></div>
              <AgentRunPanel
                run={activeAgentRun}
                disabled={!!busy || dirty}
                onClarify={(answers) => run("提交澄清并重规划", () => clarifyAgentRun(answers))}
                onDecision={(choice, feedback) => run(choice === "approve" ? "执行返工计划" : choice === "modify" ? "重规划返工任务" : "拒绝返工计划", () => decideAgentRun(choice, feedback))}
                onContinue={() => run("检查本机 CAD 进度", continueAgentRun)}
                onRefresh={() => run("刷新返工任务", refreshAgentRun)}
                onReset={resetAgentRun}
                onShowResult={() => {
                  setInspectorView("parts");
                  modelStage.current?.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </aside>
          )}
        </TabsContent>
        <TabsContent value="slicing">
          <OfflineSlicing project={project} selected={selected} onSelect={setSelected} onAssignProfile={assignPartProfile} models={modelMap} save={() => (dirty || !project.revision ? save() : Promise.resolve(project))} run={run} />
        </TabsContent>
        <TabsContent value="processes" className="library process-library-page">
          <ProcessSettings
            project={project}
            selectedPart={part}
            busy={!!busy}
            onSave={async (configuration: ProcessConfiguration) => {
              await run("保存工艺参数集", async () => {
                const target = profiles.find((value) => value.id === configuration.profileId);
                if (!target) throw Error("工艺组合不存在。");
                const next = invalidate(
                  {
                    ...project,
                    processConfiguration: configuration,
                    preferredProcess: target.process,
                  },
                  "更新项目私有工艺参数副本；既有检查需复核。",
                );
                setProject(next);
                current.current = next;
                setDirty(true);
                await save();
                toast.success("私有参数副本已保存，可供建模前读取。");
              });
            }}
            onAssignPart={(id) => {
              if (!part) return;
              void assignPartProfile(part.id, id);
            }}
            onDownload={() =>
              download(
                new Blob([JSON.stringify(privateProcessLibraryExport(), null, 2)], {
                  type: "application/json",
                }),
                "zaowu-private-process-library.json",
              )
            }
            onNavigateCad={() => setTab("cad")}
          />
        </TabsContent>
        <TabsContent value="cad">
          <CadWorkspace
            executor={executor}
            project={project}
            change={change}
            save={() => (dirty || !project.revision ? save() : Promise.resolve(project))}
            run={run}
            onImported={async (p) => {
              await hydrate(p);
              setTab("design");
            }}
          />
        </TabsContent>
        <TabsContent value="versions" className="library">
          <div className="library-heading">
            <div>
              <h1>项目与版本</h1>
              <p>载入前自动保存当前修改；历史版本恢复为新的草稿。</p>
            </div>
            <Button variant="outline" onClick={() => run("刷新项目", refreshProjects)}>
              <RotateCcw size={16} />
              刷新
            </Button>
          </div>
          {autoImportJobId && <p className="generation-notice" role="status">本次三维方案正在下方追踪。生成完成后会自动载入三维视图；请保持本页打开。</p>}
          <TripoJobs
            project={project}
            autoImportJobId={autoImportJobId}
            canAutoImport={!busy && !dirty}
            onAutoImportHandled={() => {
              finishAutoImport(project.id, autoImportJobId);
              setAutoImportJobId(null);
            }}
            save={() => (dirty || !project.revision ? save() : Promise.resolve(project))}
            run={run}
            onImported={async (p) => {
              const added = p.parts.find((part) => !project.parts.some((previous) => previous.id === part.id));
              await hydrate(p);
              if (added) {
                setSelected(added.id);
                setFocusedPartId(added.id);
              }
              setTab("design");
            }}
            onUseImage={useTripoImage}
          />
          <div className="version-grid">
            <section>
              <h2>已保存项目</h2>
              {visibleSaved.map((p) => (
                <button key={p.id} className="saved-project" onClick={() => run("载入项目", () => loadProject(p.id))}>
                  <Box size={18} />
                  <span>
                    <strong>{p.title}</strong>
                    <small>
                      {new Date(p.updated_at).toLocaleString()} · v{p.revision}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
              {saved.length > visibleSaved.length && <Button variant="outline" onClick={() => setShowAllProjects(true)}>显示另外 {saved.length - visibleSaved.length} 个同名项目</Button>}
              {showAllProjects && saved.length > 1 && <Button variant="ghost" onClick={() => setShowAllProjects(false)}>收起同名项目</Button>}
              {!saved.length && <p className="hint">还没有已保存项目，先在设计工坊保存版本。</p>}
            </section>
            <section>
              <h2>{project.title} · 版本记录</h2>
              {revisions.slice(0, showAllRevisions ? revisions.length : 10).map((r) => (
                <div key={r.number} className="revision-row">
                  <div>
                    <strong>v{r.number}</strong>
                    <p>{new Date(r.created_at).toLocaleString()}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      run("恢复历史版本", async () => {
                        const latest = dirty ? await save() : project;
                        const restored = JSON.parse(r.body) as Project;
                        await hydrate(invalidate({ ...restored, revision: latest.revision }, "恢复历史设计，旧检查须重新执行。"));
                        setDirty(true);
                        toast.success("历史内容已恢复到草稿，保存后产生新版本。");
                      })
                    }
                  >
                    恢复为草稿
                  </Button>
                </div>
              ))}
              {revisions.length > 10 && <Button variant="outline" onClick={() => setShowAllRevisions(value => !value)}>{showAllRevisions ? '收起历史版本' : `查看更早的 ${revisions.length - 10} 个版本`}</Button>}
            </section>
          </div>
        </TabsContent>
        <TabsContent value="connections" className="library connection-page">
          <ConnectionShowcase connections={connections} connectionError={connectionError} executorConnected={executor.connected} busy={!!busy} onCheckExecutor={executor.diagnose} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
