# P1-C High Quality Text-to-3D Validation

> Status: Historical stage report. 当前项目状态以 [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md) 为准；本报告保留历史真实 Tripo 证据。

日期：2026-09-15  
场景：Golden Scenario「小型桌面设备防护外壳」  
本次重执行真实 Tripo generation submit：**1 次**；无自动重试、无第二个 Candidate。

## 1. Submission 状态与根因

上一轮的 `submission_unknown` 根因已确认：provider 优先使用的本地 `TRIPO_PROXY_BRIDGE_URL` 端口未启动，连接被拒绝；请求没有获得可追踪的 taskId。直接验证既有 ProxyAgent 出口可访问 Tripo `account/balance`，随后启动仓库已有 `scripts/tripo-proxy-bridge.mjs`，再执行本轮验证。

本轮提交前只读 diagnostics 成功：

- `global / v3 / https://openapi.tripo3d.ai/v3`
- 提交前余额 `80`，冻结 `0`
- 提交后余额 `30`，冻结 `0`
- `account/usage`：2 条、累计 `70` credits；旧记录占 `20`，本轮任务 provider 返回 `creditsConsumed=50`

本轮独立记录：

- 独立 project：`91ad21c0-4143-4252-8969-00dc31047b82`，revision `1`
- local job：`cecbc2ff-9070-4960-add2-0627dbee8876`
- Tripo taskId：`2c1740d6-70b3-48ae-9e0a-fa2104893917`
- submit response：HTTP `200`，provider 状态 `queued`
- 任务最终 provider 状态：`success`，进度 `100`

完整 submission lock、payload、API response、task 查询记录、下载 GLB 和本地证据在：`work/validation/tripo-p1c-rerun/`。旧 `work/validation/tripo-p1c/`、旧 Golden project、Golden Evidence 均未覆盖。

## 2. 最终发送的 High Quality payload

```json
{
  "model": "v3.1-20260211",
  "texture": true,
  "pbr": true,
  "export_uv": true,
  "texture_quality": "detailed",
  "auto_size": false,
  "face_limit": 80000,
  "geometry_quality": "detailed",
  "model_seed": 20260915,
  "image_seed": 20260916,
  "texture_seed": 20260917,
  "negative_prompt": "low-poly; disconnected shells; floating parts; thin unsupported walls; decorative scene elements",
  "prompt": "为小型桌面传感器或控制盒设计紧凑的一体式防护外壳；简洁圆角、哑光工业风，顶部保留状态区域；底部四个安装脚或螺钉柱；后侧有 USB-C 接口开口和通风槽；整体为结构完整的单体外壳，不包含电子元件、线缆或场景底座。"
}
```

工程约束没有混入 `prompt`，仍保存在 `engineeringConstraints` 与独立 job request 中：目标尺寸 140 mm、数量 1、FDM、Bambu Lab X1 Carbon、PLA Basic、螺钉连接、公差 0.2 mm、单件策略及制造备注。

## 3. 下载、inspect、attach 与质量证据

Tripo 输出已成功下载并保存：

- 文件：`high-quality-candidate.glb`
- 大小：`4,034,996 bytes`
- SHA-256：`90b503acf7d5d090bfd99e3b9d833d1e9541342dbf3cba301e033c97632266af`
- 下载主机：`tripo-data.rg1.data.tripo3d.com`

现有 `glb-inspect` 对原始 GLB 的完整检查结果为：`failed / conversion_required`，原因是“贴图总像素超过当前 3200 万像素预算”。因此现有 `/api/tripo/attach` 返回 HTTP `409`，没有创建 Part 或新的 Revision；这保持了“未通过完整导入门槛就不能成为 Candidate”的语义。

为避免丢失几何证据，离线补充报告复用了现有 `inspectGlb` 的三角形回调和 `analyzeTriangles`，但明确标记为 `reference_only`，不是已挂接的 Candidate Quality Baseline：

| 指标 | Golden Candidate | High Quality 下载资产（reference_only，未挂接） |
|---|---:|---:|
| generation configuration | v3.1 / 约 10k / standard | v3.1-20260211 / 80k / detailed |
| triangles | 8,763 | 69,889 |
| triangle delta | — | **+61,126（+697.55%）** |
| physical dimensions | 129.602 × 140 × 74.626 mm | 128.930 × 140 × 101.730 mm（按既有 140 mm target normalization 的参考值） |
| raw GLB dimensions | — | 902.466 × 979.949 × 712.072 mm |
| unitScale | 373.12982003252637 | 142.86455194233326（attach normalization 推导值，未写入 Part） |
| boundaryEdges | 2 | 7 |
| nonManifoldEdges | 2 | 11 |
| nonManifoldVertices | 4 | 17 |
| topology verdict | `topology_issues` | `topology_issues` |
| GLB complete inspection | passed（既有 Golden 记录） | failed：texture pixel budget |
| Viewer load through existing import path | historical loadable | `not_run`：在 `importModel`/attach 前被 inspection 拦截 |
| stage gate | `false` | **`false`** |

High Quality 几何拓扑原始结果：`boundaryEdges=7`、`nonManifoldEdges=11`、`nonManifoldVertices=17`、`windingConflictEdges=1`、`duplicateFaces=0`、`degenerateFaces=0`、`edgeConnectedComponents=1`。未检查自交、壁厚、壳嵌套、装配适配和实际制造。

证据文件：

- `work/validation/tripo-p1c-rerun/evidence.json`
- `work/validation/tripo-p1c-rerun/high-quality-geometric-evidence.json`
- `work/validation/tripo-p1c-rerun/submit-response.json`
- `work/validation/tripo-p1c-rerun/task-responses.json`

## 4. 结论

1. **几何细节有明显提升**：69,889 triangles 相比 Golden 的 8,763 增加 61,126，约为 Golden 的 7.98 倍。但这只能说明几何复杂度/细节预算提升，不能证明制造质量提升。
2. **Topology 没有改善，反而更差**：Golden 已是 `topology_issues`；High Quality 仍为 `topology_issues`，且 boundary、non-manifold edges、non-manifold vertices 分别增加到 7、11、17。
3. **工程放行仍不允许**：原始 GLB 超过当前贴图预算，无法通过现有完整 inspect/import/attach；stage gate 必须是 `false`。视觉上可能可生成或可被某些通用 GLB 工具打开，不等于本工程链路质量通过。
4. **是否继续 Text-to-3D**：值得继续做一次受控的 Text-to-3D 方向验证，但下一次优先收敛贴图/导出可验收性与 topology，而不是继续提高 face limit；本次不能据此宣布 production ready。
5. **下一阶段选择**：当前选择 **A：继续优化 Text-to-3D**。先验证“可导入、可检查、拓扑不恶化”的配置；若连续验证仍不能表达接口/外壳结构，再转向 Reference Image / Image-to-3D / Multi-view。

`productionReady=false`。本轮真实 Tripo submit 次数为 **1**，没有第二个 Candidate，也没有自动重试。
