# 当前项目状态（唯一入口）

Status: Final Showcase Product Maturation complete  
Updated: 2026-09-16  
Phase: Final Showcase · Product Maturation / Human-AI Design Foundation · Revision 31

这是后续 Agent/Codex 判断仓库当前状态的唯一推荐入口。P1-A 至 P1-G 及 `TAKEOVER_REPORT` 保留为历史证据，不应覆盖本文件的当前结论。

## 当前 Final Showcase（Revision 31 / Rev25 Product Maturation）

- Project：`217a34ab-6fc4-42ef-a04b-c167c15dd177`；当前 Revision：`31`；Rev24 保留为工业设计对比基线。
- 产品：桌面智能环境监测终端；Manufacturing CAD 从 Rev24“悬浮玻璃楔体”深化为 Rev25“精密玻璃仪器”。
- 角色：1 个 Tripo `visual_reference` + 4 个真实 `manufacturing` 实体；Visual Candidate 不进入制造 CAD。
- 四件：sculpted lower shell、smoked-glass inset display visor、louvered service cover、shadow plinth with hidden feet。
- 工业设计：visor 改为双层内嵌玻璃冠部并保留阴影缝；lower shell 采用更连续的肩线和曲面转折；后盖改为胶囊形百叶孔；底座进一步内收并隐藏支撑脚。
- CAD：`controlled-cad-v3`；4/4 kernel valid；4/4 STEP roundtrip valid；4/4 声明 M3 接口通过；6 组两两 interference 全部 `0 mm³`。
- 数字检查：4 × geometry readable、4 × mesh topology、4 × X1C build-space 初筛全部通过。
- CAD 执行：Job `fec19bea-bee6-4ef4-96e6-a49095be5635`；Run `78ae7bb8-8cd3-4440-81a3-132a8697bdb0`；`registered_device_signature_verified`；内层报告仍为 `unsigned_local_report`。
- 输出：四件 STEP/BREP/STL + `assembly.step` 已重新生成。
- 切片：四件均由 Bambu Studio `02.08.02.60` 生成真实 3MF/G-code，artifact integrity 与输入网格对应均通过；visor、rear cover、plinth 保留 floating-cantilever 警告。
- 工程包：`work/validation/product-maturation-rev25/engineering-package-v31.zip`；SHA-256 `120d37a79b69ea0b41d3416954daff5f4a51318aafc33350ec4312fbc64dd009`。
- 8787：Manufacturing 仍为默认；提供 Hero / 45° / 正面 / 侧面 / 背面镜头，以及 Manufacturing / Visual Reference / Compare / Exploded 模式；材质、环境光、阴影和地面均已重做。
- Human-AI 基础：viewer 点选返回 `objectId / partId / faceIndex / world/local position / normal / view / camera`；统一 `design-feedback-v1`；LLM provider 支持 `deepseek / openai / openai-compatible`，没有接 LangGraph 或自动改模。
- Showcase：`showcase/industrial-refinement/rev25/`；Rev24 保留为本轮对照基线。
- 完整报告：[`FINAL_SHOWCASE_PRODUCT_MATURATION_REPORT.md`](./FINAL_SHOWCASE_PRODUCT_MATURATION_REPORT.md)。
- 结论：已达到“最终封版前的数字展示候选”水平；切片朝向/支撑、壁厚、强度、首件和生产签核仍待完成，因此 `physicalValidation=not_run`、`productionReady=false`。

以下 P1-K0 / P1-H / P1-I 内容为历史基线记录，继续保留用于追溯。

## P1-K0 已完成

- 已按 cleanup manifest 清理浏览器 profile/cache、重复 offline rerun、重复 GLB 与可再生成 validation bundle；文件先移入 `<local-quarantine>` 可恢复隔离区，未删除产品历史事实。
- `.wrangler/state`、当前 D1/R2、Golden Project Revision 1–12、当前 CAD/Slice/Evidence/Engineering Package，以及外置 Bambu Runtime 均保留。
- AI 已接通 DeepSeek OpenAI-compatible Chat Completions：`provider=deepseek`、`model=deepseek-flash`；真实 validation-only Plan 已进入 `ai_plan/suggestion_ready`，通过 `ai-plan-v1`，并记录 `riskFlags`、`confidence`、usage、响应 ID 与校验状态。
- P1-K0 本机清理报告未随公开仓库发布。

## 当前 Golden Path

`Tripo Visual Candidate (visual_reference) → unchanged Golden CAD Design → registered local CAD device → signed execution run/lease/attempt/receipt → CAD manufacturing Asset → exact Bambu 02.08.02.60 → real 3MF/G-code → server Slice Result verification → manufacturing Slice Evidence → Revision → traceable Engineering Package`

- Project：`91ad21c0-4143-4252-8969-00dc31047b82`
- 当前 Revision：`12`（Revision 10 附加新 CAD Asset；Revision 11 保存当前几何/拓扑/执行证据；Revision 12 保存真实 Slice Evidence）
- CAD Design：`23144fff-8966-46de-ab3d-7d30c06634e4`，SHA-256 `fb6c546a95d664b0f437c51e711deaa89e90f76ff46860a66e0087bcc62dd1ba`，参数未改变
- 当前 CAD Task：`de4d3dfa-4b58-4c97-a458-d05b2342c81f`，`attached`
- 当前 CAD Part：`d9b8af65-dadb-4767-9120-2ab53d48da3a`，`engineeringRole=manufacturing`
- 当前 CAD Asset：`f19432b7-e0e9-4959-9b9d-c516a27fd657`，STL SHA-256 `16ac5e815a2fdd1ca4f53b4cd83c17a4930743b576ebf0f3e18706f5aca0764f`
- Execution Device：`aacf9aa4-42d1-43e5-a796-7bd39cb104eb`
- Execution Run：`9fa64900-f45b-4187-b1c3-ac007bf83393`，attempt `1`，`succeeded`
- 外层执行来源：`registered_device_signature_verified`
- 内层 CAD 报告：`unsigned_local_report`
- 当前 Offline Slice Task：`cea013ea-cfda-4629-b161-74d9b29381a8`，`offline_consistent`、`stale=false`
- Slice manifest SHA-256：`692fba52dc4e2b39d0158b3d3cffef74cebbbb8df7b613778726dfccdda65f77`
- Slice input STL SHA-256：`16ac5e815a2fdd1ca4f53b4cd83c17a4930743b576ebf0f3e18706f5aca0764f`
- Slice Result：服务器结果记录内嵌于上述 Job，无独立 Result UUID；artifact ZIP SHA-256 `db470b521743b168e3223756c8f1187c492720c1805c73b7954fe7a73c3d55ef`
- Bambu Studio：`02.08.02.60`；executable SHA-256 `fb04b22d21d2dd77e223c68e56b0f36302fd7b860040d553aed2608694017749`；`BambuStudio.dll` SHA-256 `d6aa10044d11d9b3fcba0d6b52ed3154b4b02897764c270c0fdcbe2cf812f85b`
- Slice Evidence：`d8f38c6a-9c7e-410e-aa6d-71e4b972fd5c`，`passed`、`scope=manufacturing`、Revision `12`
- Visual Candidate Part：`a1b29ad2-34ba-4b30-9ffa-cffa5475197e`，`engineeringRole=visual_reference`

## P1-H 已完成

- 复用了既有 `execution_devices`、`execution_runs`、`execution_attempts`、配对、租约、heartbeat、回执、Ed25519 签名、结果上传与服务端校验协议；没有创建第二套执行协议。
- 使用 Windows x64 / Python `3.12.14` / CadQuery `2.8.0` / OCP `7.9.3.1.1` 的既有 `zaowu-cad` 环境运行真实 relay 和 CAD 子进程。控制器依赖按仓库带哈希清单安装为 cryptography `50.0.1`。
- 新 CAD Task 沿用完全相同的 Golden CAD Design 和参数。设备、run、lease、attempt、input SHA、runner SHA、result SHA、receipt、signature 与服务端验证已形成闭环。
- CAD result ZIP SHA-256 为 `1018b478ed8991f3ad5f807c95e9073e89f435bb85973e97eee6ef061084dbcc`；当前 Asset 仍是相同确定性几何：`140 × 100 × 60 mm`、`2,140` triangles、4/4 声明直孔量规通过、0 组装配交叠。
- 当前几何可读、网格拓扑和包围盒初筛已针对新 Asset 重跑并通过；自交、壳嵌套、局部壁厚、强度、完整接口/装配公差等未扩大宣称。
- 旧 unsigned CAD Task `6b559822-f45a-488e-83ba-7822e88850a9`、旧 Asset `234cb135-d64e-4dba-8ac6-f6845ebbc652` 和旧 Revision 均保留。
- 工程包当前 CAD 目录新增 `execution-proof.json`，包含 run/device/input/runner/result/receipt/signature/verification/limitations；不包含私钥。服务端在下载证明时再次核对回执合同、结果哈希和 Ed25519 签名。
- 界面明确区分当前 signed CAD、历史 unsigned CAD、内层 unsigned report、当前 Slice、历史 stale Slice，以及 `visual_reference` / `manufacturing` 角色。

## P1-I 真实 Slice 结果

旧 Slice Task `9d405a44-297b-4b1c-9064-8732f4f84a3a` 仍是 `prepared / stale=true` 的历史任务；P1-H 任务 `c5bf7afe-b31a-4069-a603-61abb84ef53e` 保留为同一当前来源上的历史 prepared 任务。P1-I 创建并执行了最新 fresh task `cea013ea-cfda-4629-b161-74d9b29381a8`，其 runtime contract 与官方 ZIP 实际 fingerprint 一致。

最新 Slice Task `cea013ea-cfda-4629-b161-74d9b29381a8` 绑定当前 signed CAD Part：

- manifest SHA-256：`692fba52dc4e2b39d0158b3d3cffef74cebbbb8df7b613778726dfccdda65f77`
- input STL SHA-256：`16ac5e815a2fdd1ca4f53b4cd83c17a4930743b576ebf0f3e18706f5aca0764f`
- engine：Bambu Studio `02.08.02.60`
- status：`offline_consistent`
- real 3MF SHA-256：`afd31f756c6c17c1ed23791f0c58dddf1b9e9502f9db0f6ebe6ebfb64bfa60a0`
- real G-code SHA-256：`925a90a6467117464b050265568313282b11142babe915433efebc9f4df39267`
- 300 layers；预计 `7909.16943359375` 秒；预计 `109.98854064941406` g
- server geometry：`2140/2140` triangles，最大坐标差 `1.952563479790115e-6 mm`，排版平移 `[58,78,0]`
- `physicalValidation=not_run`
- `productionReady=false`

Slice input 来自当前 signed CAD manufacturing Asset；服务器通过保存零件关联和完整有向三角形一一对应合同把输入、3MF 内网格绑定。真实 Bambu CLI 返回 0，并由正式 PATCH import 链路通过 settings、3MF、G-code、layer、挤出和 geometry 校验。没有使用 Orca 或其他替代 slicer。离线结果的 execution attestation 仍诚实标记为 `unsigned_local_report`，不等同硬件 attestation。

## 当前工程包

- Path：`work/validation/p1i/golden-engineering-package-v12.zip`
- Bytes：`4,935,351`
- SHA-256：`ec254efd1d51d13f4da1c57b45ea2748178189cbe41751c000704f53900977d4`
- 包内 Slice Result：`slicing/cea013ea-cfda-4629-b161-74d9b29381a8/result/result.zip`、`slicing/cea013ea-cfda-4629-b161-74d9b29381a8/result/files/`、`slicing/cea013ea-cfda-4629-b161-74d9b29381a8/result/sliced-3mf/`
- 包内关键真实文件：`Metadata/plate_1.gcode`、`Metadata/project_settings.config`、`effective-settings.json`、`slicer-result.json`、`process-log.txt`、`report.json`
- `traceability.json` 逐文件记录并核验 package payload hash
- CAD execution proof：`cad-native/de4d3dfa-4b58-4c97-a458-d05b2342c81f/execution-proof.json`

工程包包含当前 CAD result 与展开后的 STEP/BREP/STL/report、外层执行证明、当前/历史 Slice manifest 与输入/config、真实 Slice result/3MF/G-code/effective settings/runtime evidence/log、Slice Evidence、制造包和 Visual Candidate reference 元数据。

## 仍未完成

- 自交与壳嵌套、局部壁厚与薄弱结构、强度、完整接口/装配公差、支撑与翘曲仍未完成。
- 实际机台与材料批次校准、首件尺寸/功能、制造审核和生产签核仍未执行。
- 软件设备密钥签名不是硬件 attestation，也不是独立 CAD 重算或制造/物理合格证明。
- 历史 Visual Candidate 的本地 R2 对象问题仍与 manufacturing 链分离；其元数据和历史证据保留。

## 证据与验证

- 当前阶段报告：[`P1I_EXACT_BAMBU_RUNTIME_REAL_SLICE_CLOSURE_REPORT.md`](./P1I_EXACT_BAMBU_RUNTIME_REAL_SLICE_CLOSURE_REPORT.md)
- P1-H 历史阶段报告：[`P1H_TRUSTED_CAD_EXECUTION_SLICE_REBASELINE_REPORT.md`](./P1H_TRUSTED_CAD_EXECUTION_SLICE_REBASELINE_REPORT.md)
- P1-I closure：`work/validation/p1i/closure.json`
- P1-I import summary：`work/validation/p1i/import-response.json`
- P1-I runner result：`work/validation/p1i/offline-runs/cea013ea-cfda-4629-b161-74d9b29381a8-896381dc-2544-4484-983c-a902a63546a6/offline-result.zip`
- P1-I official runtime ZIP：`work/validation/p1i/runtime/Bambu_Studio_win-v02.08.02.60-20260814163036.zip`，SHA-256 `85844d64a927ab36e3fd9bbef16da22adde1d25b3dcba4e8f58cef89db0c1291`
- P1-I 工程包：`work/validation/p1i/golden-engineering-package-v12.zip`
- P1-H closure：`work/validation/p1h/closure.json`
- 外层执行证明：`work/validation/p1h/execution-proof.json`
- 历史 CAD result：`work/validation/p1h/de4d3dfa-4b58-4c97-a458-d05b2342c81f-cad-result.zip`
- 历史 P1-H 工程包：`work/validation/p1h/golden-engineering-package-v11.zip`
- 验证脚本：`validation/p1i-closure.cjs`、`validation/p1i-build-task.cjs`

验证覆盖：官方 runtime ZIP SHA；可执行文件/DLL 指纹；真实 runner exit 0；Bambu CLI 版本日志；3MF/G-code/settings/layer/extrusion；正式 server PATCH import；完整网格对应；manufacturing Slice Evidence；Revision 12；工程包逐文件 SHA；P1-G 边界、Golden CAD、slice geometry `39/39`、quality baseline `2/2`；TypeScript、定向 ESLint、生产 build。P1-H closure 脚本固定 Revision 11，未在当前 Revision 12 上误运行；物理验证仍未执行。

## 任务计数

P1-I Tripo generation：**0**；P1-H 新 CAD Task：**1**；Slice Task 总数：**3**（历史 stale 1、P1-H prepared 1、P1-I offline_consistent 1）；执行设备/run/attempt：**1 / 1 / 1**；P1-K0 DeepSeek requests：**3**，保存的 `ai_plan` Job：**1**；当前 Revision：**12**。
