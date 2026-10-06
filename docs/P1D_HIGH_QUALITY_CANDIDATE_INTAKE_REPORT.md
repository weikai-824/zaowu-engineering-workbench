# P1-D High Quality Candidate Engineering Intake

> Status: Historical stage report. 当前项目状态以 [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md) 为准；Visual Candidate 仍作为 visual_reference 保留。

日期：2026-09-15

## 结论

P1-C 的 High Quality GLB 已作为独立的工程化派生候选接入当前本地工程台。原始供应商资产未覆盖，派生过程只移除嵌入贴图资源以绕过当前 GLB 贴图像素预算；没有做网格修复或拓扑美化。

因此当前结论是：Viewer 可加载、几何可读性通过，但 topology 仍为 `failed / topology_issues`，不能进入下一工程阶段，也不代表生产可用。

## 接入记录

- 项目：`91ad21c0-4143-4252-8969-00dc31047b82`
- 新 Revision：`v2`
- 新 Part：`a1b29ad2-34ba-4b30-9ffa-cffa5475197e`
- P1-C Job：`cecbc2ff-9070-4960-add2-0627dbee8876`
- P1-C Provider task：`2c1740d6-70b3-48ae-9e0a-fa2104893917`
- 原始 Asset：`11f9e424-0f1a-4c4f-aa39-96c405370b01`
  - 4,034,996 bytes
  - SHA-256 `90b503acf7d5d090bfd99e3b9d833d1e9541342dbf3cba301e033c97632266af`
  - 原状态：`conversion_required`，原因是嵌入贴图总像素超过 3,200 万预算
- 派生 Asset：`9f325de3-8d2b-4a4d-b53f-36d3a5b7695a`
  - 4,034,388 bytes
  - SHA-256 `ebeb99c28dc549f75d8445909a845f69f2a4676d7ad5cbe1838bfa654d4056c7`
  - 方法：`embedded-texture-strip-v1`

`Part.source.derivedFrom` 保存了原始 Asset ID、原始 SHA、派生 SHA 和方法；job result 的 `intake` 保存完整原始/派生资产、场景节点、质量报告和接入 Revision。原始 R2 对象仍可回读，派生 R2 对象也已完成 SHA-256 round-trip 校验。

## Candidate Quality

| 指标 | Golden Candidate | P1-D High Quality Candidate |
|---|---:|---:|
| 文件 | 853,524 bytes | 4,034,388 bytes（派生） |
| triangles / faces | 8,763 | 69,889 |
| triangle 增量 | - | +61,126（约 7.98 倍，总增幅约 697.45%） |
| physical dimensions | 129.602 × 140.000 × 74.626 mm | 128.930 × 140.000 × 101.730 mm |
| unitScale | 373.129820 | 142.864552 |
| boundaryEdges | 2 | 7 |
| nonManifoldEdges | 2 | 11 |
| nonManifoldVertices | 4 | 17 |
| topology verdict | `topology_issues` | `topology_issues` |
| Viewer | 已有 Golden Viewer 链路 | `passed`，现有 `importModel` 实测可加载 |
| stage gate | blocked | blocked |

HQ 候选的面数有明显提升，但 topology 指标没有改善，反而更差；不能仅因视觉或面数更高而判定工程质量提升。

标准工程证据状态：

- 几何可读：`passed`
- 网格拓扑：`failed`，boundary 7、non-manifold edges 11、non-manifold vertices 17
- 包围盒初筛：`passed`
- 自交/壳嵌套、壁厚、装配干涉：`not_run`
- 切片与支撑：`not_run`
- 实机首件与功能测试：`not_run`
- `productionReady: false`

拓扑报告仍为 `client_report_unverified`，并明确列出未检查项；P1-D 没有宣称生产级验证。

## 实现与验证

- `lib/glb-derived.ts`：解析 GLB JSON/BIN，移除 images/textures/samplers/materials 和对应 primitive material 引用，保留几何 BIN，并写入派生方法标记。
- `lib/tripo-intake.ts`：读取已有回收资产、校验原始 SHA、派生 GLB、复用 `inspectGlb` 与 `analyzeTriangles`，按现有 `unitScale = 1000 × targetLongestMm / rawLongestMm` 规则生成 Part、Revision、Evidence 和 Candidate Quality Report。
- `app/api/tripo/intake/route.ts`：新增工程化接入入口；具有状态检查和幂等保护。
- `app/tripo-jobs.tsx`：对 `conversion_required` 资产显示“工程化接入候选”，并在接入后展示原始保留、派生方法、拓扑指标和 stage gate。
- `app/api/projects/route.ts`、`lib/engineering.ts`、`lib/tripo-recovery.ts`：允许并追踪 `derivedFrom` 和 intake 记录，同时保持旧 Tripo attach 校验兼容。

离线验证覆盖：fixture 派生几何等价、P1-C 三角数保持 69,889、P1-C 派生 GLB 通过 inspect、现有 Viewer `importModel` 可加载、service 接入幂等且原始资产保留。

本轮没有新的 Tripo 任务、没有重试、没有 credits 消耗；P1-D 的 Tripo API 请求次数为 **0**。

## 后续建议

当前最有价值的下一步不是继续堆面数，而是对同一 P1-C 派生候选做受控的拓扑修复/几何内核验证，并保留修复前后的独立证据。如果下一轮只能花一次 credits，建议先验证一个明确带有封闭实体、无非流形边和可测壁厚的 Text-to-3D 输出；若 provider 仍持续返回 `topology_issues`，再转向 Reference Image / Image-to-3D / Multi-view 做结构可控性实验。
