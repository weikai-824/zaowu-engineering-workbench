# P1-A Candidate Quality Baseline Report

> Status: Historical stage report. 当前项目状态以 [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md) 为准。

日期：2026-09-15  
范围：Candidate 质量证据链、单位一致性、统一质量报告和本地回归验证。  
限制：本阶段没有调用真实 Tripo API，没有提交新任务，没有消耗 credits；没有引入 LangGraph、CAD、切片或 UI 大改。

## 1. 修改文件

核心实现：

- `lib/engineering.ts`：增加 `EvidenceStatus`、`currentAttempt` 和统一 `partUnitScale()`。
- `lib/geometry.ts`：让 `importModel()` 记录已应用比例，`partObject()` 依据 Part 保存的比例校正对象；Topology 未执行时保留同一输入下已有的有效 failed Evidence。
- `lib/saved-part-geometry.ts`：保存几何重建统一使用 `partUnitScale()`。
- `lib/quality-baseline.ts`：增加 `buildCandidateQualityBaseline()`。
- `lib/tripo-submit.ts`：抽取共用的 `buildTripoPayload()`，提交路径和预览路径使用同一字段映射。
- `lib/tripo-preview.ts`、`app/api/tripo/preview/route.ts`：增加只读 Dry Run / Payload Preview。
- `app/api/projects/route.ts`：接受 Evidence 的 `currentAttempt` 字段。
- `app/workbench.tsx`：载入 Revision 时使用保存的 `partUnitScale()`。
- `work/validation/tripo-real/export.ts`：真实验收脚本不再用 `unitScale=1`，改读当前 Part 的保存值。

验证与脚本：

- `validation/quality-baseline.cjs`：unitScale、导出尺寸和 failed→not_run 回归。
- `validation/tripo-preview.cjs`：Golden / High Quality payload preview 回归。
- `package.json`：增加 `validate:quality-baseline` 和 `validate:tripo-preview`。

历史 `work/validation/tripo-real/evidence.json` 和已有工程包没有被重写。当前工作区没有原始 Golden GLB，不能在不伪造资产的情况下重生成它们。

## 2. 两个 bug 的真实根因

### Evidence 覆盖

`lib/geometry.ts` 的 `digitalChecks()` 在 topology worker、浏览器能力或任务执行失败时，原先无条件新增 `status: 'not_run'` 的同名 Evidence。它没有比较当前零件、输入 hash 和上一条 topology report，因此会把已有的 `failed/topology_issues` 从检查结果集合中替换掉。

真实验收材料已经记录了这个事实：早先的 `glb_and_topology_check` 是 `topology_issues`，后续 `existing_digital_checks_recomputed` 把同一模型的网格拓扑写成了 `not_run`。

### unitScale 丢失

真实验收脚本 `work/validation/tripo-real/export.ts` 在检查前使用：

```ts
importModel(assetBytes, 'real-tripo.glb', 1)
```

而 `digitalChecks()`、`exportEngineering()` 原先假设传入 `models` 已经完成单位换算，不会再次从 `Part.params.unitScale` 校正。因此 GLB 原始米制坐标以接近 1 的比例进入了 Viewer 测量和检查，历史材料出现约 `0.347 × 0.375 × 0.200 mm`，而挂接时保存的工程尺寸是约 `129.602 × 140 × 74.626 mm`。

当前应用的 `exportEngineering()` 本身并不重新调用 `digitalChecks()`；真实验收脚本是先调用 `digitalChecks()`，再调用 export。两条路径都经过 `partObject()`，所以现在共享同一单位校正逻辑。

## 3. Evidence 状态合并规则

当一次新的 topology 尝试不能完成时，只有同时满足以下条件，才保留旧 Evidence：

1. 同一个零件和同一个 topology Evidence 名称。
2. 旧 Evidence 顶层状态为 `failed`。
3. 旧 topology report 的 verdict 为 `topology_issues`。
4. 旧 Evidence 的 `inputHash` 与当前项目 fingerprint 相同。
5. 旧 Evidence 属于 `digital` scope。

满足条件时：

- 顶层状态继续为 `failed`；
- 原 topology report、geometry hash、测量版本保持为最后一次有效失败结果；
- 增加 `currentAttempt: { status: 'not_run', detail, attemptedAt, revision, inputHash }`；
- 工程包中的 `checks.json` 仍显示 `failed` 和 `topology_issues`。

如果输入已经改变、旧结果已是 `stale`、没有有效 topology report，或者旧结果并非 `topology_issues`，则不会强行继承，新的 `not_run` 或 `stale` 语义保持不变。一个新的成功 topology 检查也会生成新的有效 Evidence，不会继续保留旧的当前失败状态。

这保证了 `not_run` 表示“本次没有成功重新检查”，而不是“模型没有已知问题”。

## 4. unitScale 完整数据流

1. Tripo 候选挂接时，`lib/tripo-attach.ts` 根据 GLB summary 和用户明确的目标最长尺寸计算并保存 `Part.params.unitScale = 1000 * factor`。
2. 本地文件导入和候选预览同样把实际换算值写入 Part。
3. Revision 载入在 `app/workbench.tsx` 中通过 `partUnitScale(part)` 读取该值；缺少有效值的 asset 会显式报错，不再静默采用 1。
4. `importModel()` 将传入比例应用到对象，并在对象 `userData.__engineeringUnitScale` 中记录已应用比例。
5. `partObject()` 比较对象已应用比例和 Part 保存比例：已按其他比例载入时按比例比值校正；未记录比例时按 Part 保存值应用。
6. Viewer 的 assembly、`digitalChecks()` 的 measure/topology、`currentGeometryHash()`、STL/GLB export 和 `savedPartTriangles()` 都从这个统一对象路径或统一 Part 比例读取。

因此 Viewer、Part metadata、Revision、Quality Check 和 Export Evidence 对同一资产使用同一个物理毫米语义。修复没有使用 140 mm 硬编码。

## 5. Candidate Quality Report 结构

`buildCandidateQualityBaseline(project, models, partId?, sourceGlb?)` 输出 `candidate-quality-baseline-v1`，包含：

- candidate：Part ID、名称、asset ID、来源类型、unitScale；
- geometry：geometry readable 状态、triangles、faces、物理 dimensions、bounding box min/max、坐标系；
- glbInspection：复用 `inspectGlb()` 的 GLB 容器/场景/资源结果；未提供原始字节时明确为 `not_run`；
- topology：状态、exact/tolerant stats、boundaryEdges、nonManifoldEdges、nonManifoldVertices、geometry hash、topology verdict、notChecked；
- evidence：该零件及项目级检查项的原始状态；
- stageGate：`allowedIntoNextEngineeringStage`、阻塞原因和固定的 `productionReady: false`；
- inputHash：当前项目 fingerprint。

报告只复用已有 `inspectGlb()`、`measure()`、`digitalChecks()` 和 topology analyzer，没有重新实现一套 3D 算法。Viewer 能打开只会使 geometry readable 可能为 `passed`，不会自动使 topology 或工程阶段门禁通过。

## 6. Golden Scenario 结论

历史真实 Golden Scenario 已有的可信阶段结论是：该候选约 `129.602 × 140 × 74.626 mm`、`8,763` 个三角面，Topology verdict 为 `topology_issues`，所以不能进入下一工程阶段，也不能宣称生产就绪。

历史后续材料中的亚毫米 Viewer 测量和 `not_run` topology 是本次修复前的错误/不完整重算结果，不被当作新的质量结论。

使用修复后代码重跑同一已保存 Revision 时，预期统一结论为：

- geometry readable：若 GLB 可解码则 `passed`；
- physical dimensions：约 `129.602 × 140 × 74.626 mm`；
- topology：若原有效 report 仍为 `topology_issues`，保持 `failed`；若当前环境不能重查，则为顶层 `failed` 加 `currentAttempt=not_run`；
- candidate gate：`allowedIntoNextEngineeringStage=false`；
- `productionReady=false`。

由于本地没有原始 Golden GLB，本轮没有把上述“修复后重跑”写成新的真实 Tripo 验收记录。

## 7. 测试和检查结果

通过：

- `npm run validate:quality-baseline`：2/2；覆盖裸加载 `unitScale=1`、Part 比例校正、导出 assembly 尺寸和 failed Evidence 保留；
- `npm run validate:tripo-preview`：2/2；Golden / High Quality 均为纯 payload 构造；
- `node validation/glb-fixtures.cjs`：19/19；
- `node validation/topology.cjs`：33/33；
- topology vertex / edge budget：均通过显式拒绝和输入不变保护；
- `node validation/slice-geometry.cjs`：39/39；
- `node validation/tripo-submit.cjs`：39/39，使用 mock provider/R2；
- `node validation/tripo-process.cjs`、`node validation/tripo-webhook.cjs`：通过；
- `npx --no-install tsc --noEmit`：通过；
- `npm run build`：通过。

`npm run lint` 仍失败。当前输出为仓库既有 lint 边界中的历史问题（React hook 规则、旧代码 `any`、`.cjs`/生成 bundle 等，432 errors / 210 warnings）；本轮新增的 baseline、preview route/helper、saved-part unitScale 修改和新增回归脚本定向 lint 通过。没有为追求全绿而扩大修复范围。

## 8. 真实 Tripo API 调用次数

**0 次。**

本轮没有 POST 新任务、没有上传文件、没有查询真实任务、没有调用余额/用量接口，也没有消耗 credits。Tripo submit/process/webhook 回归均使用 mock provider；payload preview 是纯本地对象构造。

## 9. 仍存在但本阶段刻意未处理的问题

- 当前没有真实重跑 High Quality Tripo，也没有新的 GLB 质量或供应商模型质量证据。
- Topology analyzer 仍不是完整制造证明；自交、壁厚、壳嵌套、支撑、变形、装配公差、强度和实机首件仍为 `not_run` 或后续工程责任。
- `productionReady` 仍为 `false`；公开工艺参数继续保持 `reference_only`。
- 页面关闭后的长期 Tripo scheduler、后台恢复和生产环境 D1/R2/账户联调未处理。
- 没有新增 Image-to-3D、Multi-view、CAD、切片或批量 Candidate 功能。
- Quality Report 目前是内部 service/helper 和本地验证输出，没有做新的大 UI 展示。
- 历史真实验收材料保留原始错误/不完整记录，没有被覆盖成“修复后已通过”。

## 10. 下一阶段最自然的一个入口

在明确人工批准并确认会消耗 credits 后，使用当前 `high_quality_validation` Dry Run payload，只做一次固定 seed 的 v3.1 Text-to-3D 实验；将返回 GLB 与 Golden Baseline 对比 triangles、物理尺寸、GLB 可读性和 topology，并继续保持“Topology failed 就不能进入下一阶段”的质量门禁。

本 P1-A 阶段到此结束，不自动进入该实验或其他下一阶段开发。
