# 项目接管与技术审计报告

> Status: Historical / Superseded for current-state decisions by [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md) and [`P1F_CAD_RUNTIME_REAL_ENGINEERING_ASSET_REPORT.md`](./P1F_CAD_RUNTIME_REAL_ENGINEERING_ASSET_REPORT.md). 本文保留 2026-09-14 接管时的真实审计证据；其中关于 CAD runtime、当前 Revision 和 blocker 的结论已被后续阶段覆盖。

审计日期：2026-09-14  
审计范围：`造物工程台-源代码-v33`，排除 `node_modules`、`dist`、`.wrangler` 等生成物。  
总体判断：**FIX**。项目已经具备可运行的产品骨架、较完整的安全/证据边界和一套通过的确定性验证器；但真实外部链路、可制造性闭环、后台任务能力和 Agent 编排仍未完成，当前更适合进入“验证真实主链路”的阶段，而不是直接宣称生产就绪。

## 1. 当前系统架构简图

```text
浏览器 Workbench
  ├─ 项目/版本/资产管理
  ├─ 3D 模型导入、测量、拓扑检查、工程检查
  ├─ Tripo 任务、AI 计划、CAD 工作区、离线切片
  └─ 导出工程包 / 导入外部结果
          │ HTTP + local auth / ChatGPT identity
          ▼
Vinext + Vite + Cloudflare Worker 路由
  ├─ /api/projects        项目、版本、证据、并发控制
  ├─ /api/assets          R2 文件 + D1 元数据
  ├─ /api/tripo/*         提交、查询、恢复、Webhook、诊断、导入
  ├─ /api/ai/*            结构化计划生成与白名单应用
  ├─ /api/cad/*           CAD 任务/结果/校验
  ├─ /api/slicing/*       切片任务、固定配方、结果导入
  └─ /api/execution/*    执行设备、租约、收据、失败状态
          │
          ├─ D1: projects / revisions / assets / jobs / execution_*
          ├─ R2: 模型、任务输入输出、工程包
          ├─ Tripo provider（HTTPS，区域/下载域名限制）
          ├─ AI OpenAI-compatible Chat Completions（需密钥）
          ├─ Windows Python CAD relay（CadQuery/OCP，需外部环境）
          └─ Windows Python/Bambu 离线切片执行器（需外部环境）
```

核心代码入口是 [`app/workbench.tsx`](../app/workbench.tsx)；它把项目状态、上传、Tripo、AI、CAD、切片、版本和导出组合在一起。领域逻辑主要在 `lib/`，服务端安全边界在 [`lib/server.ts`](../lib/server.ts)，持久化 schema 在 [`db/schema.ts`](../db/schema.ts)，但现有 API 路由实际主要直接使用原始 D1 SQL，Drizzle 运行时封装目前没有被调用。

## 2. 能力分级

### A. 已完整实现，并且本次可以直接运行

这里的“完整”是指在当前本地环境内有可重复的代码路径和验证结果，不等同于已经完成真实打印或云端生产验收。

| 能力 | 现状与证据 |
|---|---|
| 前端与 Worker 本地启动 | `npm run dev` 成功，`http://localhost:5173/` 返回 200；`npm run build` 成功；生产 preview 曾在 `8787` 启动并返回 200。 |
| 本地认证与权限边界 | 本地 sign-in/sign-out cookie 流程可用；匿名 `/api/projects`、`/api/connections` 返回 401；服务端有 owner、Origin、body size 和相对路径校验（`lib/server.ts:1-10`）。 |
| D1 项目/版本基本链路 | 应用现有三份迁移在本地 D1 应用后，项目列表返回 200；临时项目创建、读取、版本号为 1 的保存/读取通过，随后已清理临时数据。 |
| 项目输入信任边界 | Zod 严格校验、UUID/资产归属、拓扑证据、CAD/Tripo provenance、revision 乐观并发和过期检查已实现（`app/api/projects/route.ts:7-9`）。 |
| 模型导入与几何检查框架 | 支持 STL/OBJ/GLB 等受限导入，GLB 自包含/大小/面数有边界；数字检查会给出工程、拓扑、构建空间状态，并明确标记尚未运行的检查（`lib/geometry.ts:16-58`）。 |
| 拓扑验证器 | 33 个拓扑回归用例通过；300,003 顶点和 600,003 边的预算保护测试都能显式拒绝并保持输入不变。 |
| GLB 检查器 | 19 个 GLB fixture 用例全部通过，包括合法、损坏、边界和不应修改源文件的情况。 |
| Tripo 提交参数与幂等逻辑 | 提交 schema、图像数量/正面图约束、profile 组合、制造语义和幂等 identity 已实现；本地提交回归 39/39 通过（`lib/tripo-submit.ts`、`validation/tripo-submit.cjs`）。 |
| Tripo Webhook/恢复框架 | HMAC 签名、过期拒绝、任务状态更新、租约和恢复/去重路径通过本地回归（Webhook 通过；process 通过，provider 调用去重为 1 次）。 |
| 工程导出 | 可生成包含 STL、assembly GLB、项目、BOM、检查结果、geometry index、制造计划和参数表的工程包；导出结果明确是 reference-only，不伪称生产件（`lib/geometry.ts:52-58`）。 |
| 切片结果验证器 | 固定 recipe、hash、3MF 结构、尺寸/三角形数量、内嵌几何、G-code/layers 等结构校验已实现；39 个切片几何回归用例通过。 |
| 确定性验证资产 | `glb-fixtures.cjs`、`tripo-submit.cjs`、`tripo-webhook.cjs`、`tripo-process.cjs`、`topology.cjs`、`topology-budget.cjs`、`slice-geometry.cjs` 均已实际执行并通过。 |

### B. 代码已经实现，但需要 API Key、外部软件或特定环境才能真实联调

| 能力 | 目前能确认的范围 | 缺失条件 |
|---|---|---|
| Tripo v3 多模态生成 | provider、提交、查询、Webhook、恢复、资产下载白名单、后处理、候选导入/挂接路径都存在；本次只验证了模拟 provider/确定性契约。 | `.env.local` 中 `TRIPO_API_KEY` 为空；没有真实任务、真实 GLB 下载和额度/错误行为验证。 |
| AI 规划与应用 | `/api/ai/plan` 有严格输出 schema、证据引用校验和 suggestion-only 存储；`/api/ai/apply` 只允许白名单变更并产生 revision。 | `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL` 均为空；未验证真实模型输出、超时、费用和拒答。 |
| CAD 参数化/几何内核 | CAD spec 支持受控 feature、boolean、fillet 等；结果校验包含 kernel validity、STEP round-trip、volume、接口/干涉报告；存在 Windows relay 和协议/租约代码。 | 当前机器没有可用 Python/CadQuery/OCP relay 环境，Python 命令不可用；没有本次真实 CAD kernel 运行。结果契约仍标记 `unsigned_local_report`、`productionReady:false`。 |
| 离线 Bambu/切片执行 | 有固定版本/哈希约束的 Windows 执行脚本、任务交换格式和结果验证器，界面支持下载任务、导入结果。 | 当前没有可确认的 Bambu/Orca 软件环境；本次没有实时切片、打印机连接或物理打印。 |
| 执行设备/队列 | `/api/execution/runs` 有 enqueue、claim、heartbeat、cancel、retry、finish_failure、租约和签名收据契约。 | 当前没有注册并运行的真实执行设备；签名收据是本地协议能力，不是已验收的生产信任链。 |
| Cloudflare D1/R2/托管身份 | hosting 配置、D1/R2 binding 和 Worker 生产构建存在。 | 本次未登录/部署到真实 Cloudflare 项目，未验证远程 D1/R2、ChatGPT identity 和公网回调。 |

### C. 只有入口、实验实现、占位实现，或尚未真正完成

| 能力 | 判断依据 |
|---|---|
| 真实制造就绪证明 | 拓扑模块把 self-intersection、wall thickness、outward orientation、shell containment、assembly fit、physical manufacturing 等列为 `notChecked`；切片/CAD结果明确 `physicalValidation:'not_run'`、`productionReady:false`。这不是生产质量证明。 |
| 后台可靠任务调度 | Tripo 当前主要是页面可见时每 12 秒 polling，文档明确没有 background scheduler；页面关闭、Worker 重启、长任务和持续重试尚未形成完整后台运行面。 |
| `/api/connections` 的工程/切片就绪状态 | `engineering.configured:false`、`slicing.configured:false` 是硬编码，占位信息不能代表 relay/执行器的真实健康状态（`app/api/connections/route.ts:2`）。 |
| LangGraph Agent 编排 | 当前没有 LangGraph；AI 目前是一次性计划生成/白名单应用，不具备持久状态图、规划-执行-观察、恢复、人工中断和工具编排。 |
| 多步骤制造决策闭环 | 从需求澄清到候选生成、工程约束、CAD 重建、切片、结果验收、版本交付的端到端真实链路尚未被一条 golden scenario 贯通。 |
| 完整工业级几何能力 | 受控 CAD、拓扑和切片协议是很好的边界，但自动修复、复杂装配约束、分件/排版、普适 mesh repair、跨工艺制造验证仍不是当前完成能力。 |
| 完整质量门禁 | `npm run build` 和 TypeScript 通过，但 `npm run lint` 当前失败：ESLint 报告 101 errors、89 warnings；项目也没有统一的 `npm test` 脚本。 |

## 3. 当前真实完成度与主要风险

### 3.1 已确认的真实完成度

项目不是“只有页面的 Demo”。它已经有较成熟的工程边界：

- 资产、项目版本、输入 hash、provenance、幂等键、租约、下载域名白名单和权限检查构成了可追踪的后端骨架。
- AI 输出被限制为结构化计划，并要求引用当前证据；它不能直接把模型生成结果伪装成制造事实（`lib/planning-context.ts:4-20`、`app/api/ai/plan/route.ts:9-12`）。
- Tripo、CAD、切片结果都设有明确的“未验证/非生产”语义，项目在这一点上比普通文生 3D Demo 更诚实。
- 确定性验证器相对扎实：本次实际执行了 19 个 GLB、33 个 topology、39 个 slice、39 个 Tripo submit，以及 Webhook、恢复和预算保护测试，全部通过。

### 3.2 最重要的阻碍与风险

1. **新环境的本地数据库不会自动就绪。** 首次访问项目 API 时，`execution_runs` 和 `projects` 表不存在，接口返回 503。手动按顺序应用 `drizzle/0000...`、`0001...`、`0002...` 后才恢复为 200。README 目前只给了手动迁移说明（`README.md:123-131`），`package.json` 没有 `db:migrate:local` 或启动前检查。这是当前最直接的“装好了但跑不起来”问题。
2. **外部主链路没有本次可复现证据。** Tripo、AI、CAD、Bambu、远程 D1/R2 和公网 Webhook 都没有当前环境的真实联调证据。确定性 mock 只能证明契约和状态机，不能证明供应商行为、网络、额度、模型质量或制造质量。
3. **制造闭环仍是 reference-only。** 当前最强的技术资产是证据和结果校验，但真正的 wall thickness、干涉、装配 fit、切片可制造性和物理打印结果还没有成为可交付门槛。
4. **后台任务可靠性不足。** 页面可见 polling 适合验证，不足以支撑长时间 Tripo/CAD/切片任务的比赛级稳定演示或个人项目的 Agent 状态恢复。
5. **代码质量护栏未绿。** TypeScript 和 build 通过，但 lint 失败，问题集中在 `any`、React hook 规则、`.cjs` 的 `require` 和少量可变声明。它目前不阻塞运行，却会放大后续 Agent/服务层改动风险。
6. **边界层有重复和耦合。** 路由直接写 SQL，而 `db/index.ts` 的 Drizzle 封装没有运行时调用；`workbench.tsx` 同时承担大量页面状态、API 调用和业务编排。未来直接让 LangGraph 调这些路由会把 UI/HTTP 细节带入 Agent，形成难测的耦合。
7. **文档存在漂移。** 包配置要求 Node `>=22.13.0`，验证 README 写 Node 24；验证 README 说 Tripo submit 27 项，但当前实际为 39 项。此类漂移会继续制造“另一位 agent 装半天”的环境问题。

### 3.3 本次未宣称已完成的内容

本次没有把历史文档中“曾经在其他环境验证过”的 CAD/Bambu/真实 AI/Tripo 结果当作当前环境证据。当前浏览器深度交互、真实账号、真实供应商、真实打印和部署验收均标记为 B 或 C，等待有条件的联调。

## 4. 实际执行的验证

| 检查 | 结果 |
|---|---|
| 清理失败安装残留并用 Node 22.22.2 执行 `npm ci --workspaces=false --include=dev --include=optional --prefer-offline --no-audit --no-fund` | 通过，新增 691 packages；`npm ls --depth=0` 通过。 |
| `npm run dev` | 通过，5173 可访问。 |
| `npm run build` | 通过；有大 chunk 警告，未阻止构建。曾因 preview 占用 `dist` 出现 EPERM，停止 preview 后重跑通过。 |
| `npx --no-install tsc --noEmit` | 通过。 |
| `npm run lint` | 失败：101 errors、89 warnings。 |
| 本地 HTTP | 首页/favicon 200；本地登录重定向和 cookie 可用；匿名接口 401；认证后 `/api/connections` 200；认证后项目列表在迁移后 200。 |
| D1 项目 smoke | 临时合法项目创建/读取通过；非法输入 400；临时记录已删除，未留下业务测试数据。 |
| `node validation/glb-fixtures.cjs` | 19/19 通过。 |
| `node validation/tripo-submit.cjs` | 39/39 通过，源代码测试期间未改变。 |
| `node validation/tripo-webhook.cjs` | 签名通过，过期签名拒绝，通过。 |
| `node validation/tripo-process.cjs` | 排队、复用/去重、provider 调用次数和路径检查通过。 |
| `node validation/topology.cjs` | 33 个用例通过。 |
| `node --max-old-space-size=320 validation/topology-budget.cjs vertex` / `edge` | 超预算顶点/边均显式拒绝，输入不变，通过。 |
| `node validation/slice-geometry.cjs` | 39/39 通过，包含真实嵌入 mesh 对比用例；仍是文件级/契约级验证，不是打印验证。 |
| Python/CAD/Bambu 环境探测 | 当前 `python`/`py` 不可用；未发现可确认的 Bambu/Orca 安装，因此未伪造外部成功。 |

## 5. 近期验证闭环

近期目标应是先形成一条“可重复、有真实证据、能展示失败处理”的闭环：

```text
本地登录
  → 建立一个带明确尺寸/接口的项目
  → 导入或生成一个真实模型
  → 运行数字检查并保存 revision/evidence
  → 导出 reference engineering package
  → 记录所有 not_run / productionReady=false 门槛
```

如果能拿到 Tripo key，再把闭环升级为：

```text
需求/参考图 → Tripo 真实生成 → 查询/恢复/Webhook → GLB 检查
→ 人工选择候选 → 挂接到项目 revision → 拓扑/构建空间检查
→ 工程包导出
```

这个近期闭环适合验证，因为它能最快暴露真实网络、密钥、任务状态、下载和资产归属问题，同时不把尚未完成的物理制造能力伪装成完成。它不是最终比赛主线，只是主线的第一条可验收切片。

## 6. 推荐的最终比赛核心链路

最值得做深的主线是：

> **面向真实制造约束的多模态产品迭代链路：需求/参考图 → AI 澄清与规划 → Tripo 外形候选 → 工程约束检查 → CAD 锁定关键接口 → 固定工艺切片 → 证据化版本交付。**

建议选择一个可展示、约束清晰的对象作为 golden scenario，例如带安装孔、配合面或模块接口的小型外壳/支架/夹具，而不是泛化地展示“生成一个好看的模型”。主线应做到：

1. 用户给出文字、参考图、目标尺寸和接口要求。
2. 系统区分“外观候选”和“制造关键几何”；Tripo 负责高表现力候选，CAD 负责受控接口和关键尺寸。
3. AI 不是只生成文案，而是根据当前 evidence 决定下一步、解释阻塞原因、选择重试/修正/人工确认。
4. 拓扑、构建空间、壁厚/干涉等检查结果决定是否可以进入下一阶段；不满足条件时必须展示拒绝或回退，而不是生成绿色假成功。
5. 每次变更都有 revision、输入 hash、来源、检查结果和导出包，能回放“为什么采用这个版本”。
6. 切片与打印阶段只在真实验证条件具备时宣称完成；否则交付清晰的 reference-only 结果和待验证门槛。

这条线最有竞争力的原因是它同时具备技术含量、3D 制造特色和展示效果：普通文生 3D Demo 的重点是“生成模型”，本项目的差异化应是“生成后能否被约束、检查、修正、追踪并交付到制造流程”。Agent 的必要性也在这里成立，因为它要跨越多个有状态工具，处理等待、失败、证据冲突和人工批准，而不是给单个 API 加一个聊天框。

## 7. LangGraph 推荐接入架构

### 7.1 接入原则

LangGraph 应位于现有 HTTP/UI 和领域能力之上，逐步复用现有 provider、检查器、CAD relay、切片协议和导出逻辑；不要让 LangGraph 重写 Tripo、CAD、拓扑或切片底层，也不要让模型直接操作 D1、R2、密钥或任意 URL。

```text
Workbench / API
      ▼
Application services（先从现有 route 逻辑抽出薄服务）
      ▼
Typed Tools
  ├─ project.read / revision.create
  ├─ tripo.submit / tripo.poll / tripo.recover / tripo.attach
  ├─ geometry.inspect / topology.check / engineering.check
  ├─ cad.create_task / cad.verify_result
  ├─ slicing.create_task / slicing.verify_result
  ├─ export.package / evidence.read
  └─ human_approval.request
      ▼
LangGraph 状态图
  intake → clarify → plan → execute → observe → inspect
          ↘ retry/recover ↗       ↘ human approval → deliver
```

### 7.2 图状态和节点建议

图状态至少包含 `runId`、`projectId`、`baseRevision`、当前阶段、工具调用记录、输入/输出 hash、evidence IDs、阻塞原因、重试次数、人工批准状态和最终交付物。每个节点应可恢复、可重放、可幂等；工具返回结构化结果和错误分类（可重试、需补充输入、需人工确认、不可恢复），而不是让模型解析任意日志。

第一版 Agent 只做一个窄图：

1. `intake/clarify`：补齐尺寸、材料、接口和工艺目标。
2. `plan`：根据当前 evidence 选择“Tripo 候选”或“CAD 修正”路径。
3. `execute`：调用现有 Tripo/CAD/geometry/slicing Tools。
4. `observe`：轮询或读取 webhook/recovery 状态，并持久化 checkpoint。
5. `inspect`：检查结果是否满足下一阶段门槛。
6. `recover`：只对明确可重试错误退避重试，否则请求用户/人工处理。
7. `approve/deliver`：在挂接候选、覆盖 revision、进入切片和导出前设置人工中断点。

建议先增加 application service 层作为 LangGraph 的稳定 seam，再增加 Agent；这样 UI、HTTP 和 Agent 可以共享同一套权限、幂等、revision 和证据规则。后续可在 D1 增加 `agent_runs`、`agent_steps` 或等价 checkpoint 表，但不要在第一步把所有旧路由重写成 LangGraph 节点。

## 8. P0 / P1 / P2 路线

排序综合比赛价值、技术价值、依赖关系、实现成本和风险，而非单纯按最快出 Demo。

### P0：先把真实可信的主链路立住

- 增加 `db:migrate:local`、启动健康检查和迁移版本提示，消除新环境首次访问 503。
- 固化一条 golden scenario 的验收脚本/清单：项目、版本、真实资产、检查、失败分支、导出和证据回放。
- 配置并验证一个真实 Tripo 账户，完成一次真实提交、查询/恢复、下载、GLB 检查和资产挂接；记录耗时、错误和额度，不把 mock 结果算入真实验收。
- 把 `/api/connections` 改成真实的 capability/health 状态，至少区分“配置缺失”“服务不可达”“已连接但未验证”。
- 先处理阻碍协作的 lint 高风险项和验证文档漂移，添加统一 `npm test` 聚合命令；不做大规模重构。
- 明确比赛演示的制造边界：哪些是数字检查，哪些是 reference-only，哪些必须由真实 CAD/Bambu/打印证据解锁。

### P1：把可展示的制造闭环和 Agent seam 做出来

- 抽出项目/版本、Tripo 生命周期、几何检查、CAD、切片、导出等 application services，保留现有 API 行为和安全检查。
- 让一个受控对象贯通“Tripo 外观候选 → CAD 关键接口 → 固定切片 recipe → 结果校验 → 版本化导出”。
- 在可用环境中完成 CAD relay 和一次真实离线切片/打印结果导入；把签名、hash、软件版本和人工确认写入证据。
- 增加 Durable recovery：后台 reconcile/队列、退避重试、超时、可见状态和页面关闭后的恢复。
- 在 service seam 上接入 LangGraph v0：持久 checkpoint、结构化 Tools、条件分支、失败分类、人工 interrupt 和交付节点；先只覆盖一条主线。
- 做浏览器级关键路径验收，包括登录、候选选择、失败提示、版本回退和导出下载。

### P2：扩大技术上限和比赛完成度

- 增加更多制造工艺/打印机 profile、复杂装配、分件/排版、自动修复和更深的壁厚/干涉/fit 分析。
- 增强 Agent 的计划比较、成本/时间权衡、候选评分、跨 revision 回放和可观测性，但保持所有制造事实由确定性 Tools/证据提供。
- 把更多外部能力接入统一执行协议，完善多设备并发、签名身份、取消和结果追溯。
- 建立真实样件数据集和指标：生成成功率、检查拒绝率、修正轮数、切片耗时、人工介入点、结果可复现率和物理打印通过率。
- 在真实证据充分后，再考虑更广的多模态编辑、多 Agent 协作和生产部署；它们不是当前最先要做的事项。

## 9. 交接结论

项目当前的核心资产不是单一 3D 生成 API，而是“生成/工程/执行/证据”已经有了不少契约化边界。下一阶段最关键的事情是把这些边界用一个真实对象和一个真实外部链路串起来，并保留失败、等待和未验证状态。等这条链路有真实证据后，LangGraph 才会成为有工程价值的编排层，而不是把尚未验收的模块重新包一层 Agent。
