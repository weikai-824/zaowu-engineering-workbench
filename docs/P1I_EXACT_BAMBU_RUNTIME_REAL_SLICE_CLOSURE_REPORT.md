# P1-I Exact Bambu Runtime & Real Slice Closure

Status: completed — exact runtime and real Slice closure passed  
Date: 2026-09-15  
Current status: [`CURRENT_PROJECT_STATUS.md`](./CURRENT_PROJECT_STATUS.md)

## 结论

本轮已打通当前 Golden Scenario 的数字制造主链：

`signed CAD manufacturing source → Bambu Studio 02.08.02.60 → real 3MF/G-code → server Slice Result verification → Slice Evidence → Revision 12 → Engineering Package`

当前比赛 Golden Scenario 的核心工程主链已完整打通到“数字切片一致性”。这不代表实机打印、首件测量、物理验证或生产放行。

官方发布页确认了精确的 `v02.08.02.60` Windows ZIP 资产：[Bambu Studio 2.8.2 Public Release](https://github.com/bambulab/BambuStudio/releases/tag/v02.08.02.60)。下载的 ZIP 通过发布资产 SHA-256 校验；没有使用 OrcaSlicer、Flathub、第三方构建或伪造结果。

## 1. 最终身份与状态

| 项目 | 结果 |
| --- | --- |
| Project | `91ad21c0-4143-4252-8969-00dc31047b82` |
| 最终 Project Revision | `12` |
| CAD Design | `23144fff-8966-46de-ab3d-7d30c06634e4` |
| 当前 CAD Task | `de4d3dfa-4b58-4c97-a458-d05b2342c81f` |
| manufacturing Asset | `f19432b7-e0e9-4959-9b9d-c516a27fd657` |
| manufacturing Part | `d9b8af65-dadb-4767-9120-2ab53d48da3a` |
| Slice Task | `cea013ea-cfda-4629-b161-74d9b29381a8` |
| Slice Result ID | 当前 schema 没有独立 Result UUID；结果归档在上述 Slice Job 内 |
| Slice Job 状态 | `offline_consistent`，`stale=false` |
| Slice Evidence | `d8f38c6a-9c7e-410e-aa6d-71e4b972fd5c`，`passed`，`scope=manufacturing` |
| Evidence Revision | `12` |
| physicalValidation | `not_run` |
| productionReady | `false` |

P1-H 的 Slice Task `c5bf7afe-b31a-4069-a603-61abb84ef53e` 保留为同一当前来源上的历史 `prepared` 任务；更早的 `9d405a44-297b-4b1c-9064-8732f4f84a3a` 保留为 `stale=true` 历史任务。P1-I 的最新成功任务是 `cea013ea-cfda-4629-b161-74d9b29381a8`。

## 2. Exact Bambu Runtime

官方 ZIP：

- Path：`work/validation/p1i/runtime/Bambu_Studio_win-v02.08.02.60-20260814163036.zip`
- Bytes：`473,014,652`
- SHA-256：`85844d64a927ab36e3fd9bbef16da22adde1d25b3dcba4e8f58cef89db0c1291`

实际运行文件：

- Bambu executable：`<repo-root>\work\validation\p1i\runtime\BambuStudio-02.08.02.60\bambu-studio.exe`
- executable version：`02.08.02.60`
- executable SHA-256：`fb04b22d21d2dd77e223c68e56b0f36302fd7b860040d553aed2608694017749`
- DLL：`<repo-root>\work\validation\p1i\runtime\BambuStudio-02.08.02.60\BambuStudio.dll`
- DLL SHA-256：`d6aa10044d11d9b3fcba0d6b52ed3154b4b02897764c270c0fdcbe2cf812f85b`

原 P1-H recipe 中的 executable pin `e567…` 不属于这份已验证官方 ZIP，因此本轮做了最小必要修复，把 recipe/runner pin 更新为官方 ZIP 中实际的 `fb04…`；DLL pin 保持不变。新的 Slice manifest 已通过正式 API 重新生成，未修改历史任务记录。

## 3. Slice contract 与真实产物

- Slice manifest SHA-256：`692fba52dc4e2b39d0158b3d3cffef74cebbbb8df7b613778726dfccdda65f77`
- input STL SHA-256：`16ac5e815a2fdd1ca4f53b4cd83c17a4930743b576ebf0f3e18706f5aca0764f`
- source geometry：`2,140` triangles；`140 × 100 × 60 mm`
- result ZIP SHA-256：`db470b521743b168e3223756c8f1187c492720c1805c73b7954fe7a73c3d55ef`
- generated 3MF SHA-256：`afd31f756c6c17c1ed23791f0c58dddf1b9e9502f9db0f6ebe6ebfb64bfa60a0`
- generated G-code SHA-256：`925a90a6467117464b050265568313282b11142babe915433efebc9f4df39267`
- effective settings SHA-256：`aedd58599bde2cd37be70e3f2950c9a9ce8493cb8308ed6c79fbb40f714fe56c`
- G-code：`Metadata/plate_1.gcode`，`2,830,049` bytes，真实 `G1 ... E` extrusion moves `9,088`
- layer count：`300`
- estimated print time：`7,909.16943359375` seconds（约 2h 11m 49s）
- estimated filament usage：`109.98854064941406 g`
- Bambu G-code header：`BambuStudio 02.08.02.60`
- embedded settings：`Metadata/project_settings.config` 与 exported effective settings 完全一致

服务器正式导入结果：

- Import endpoint：`PATCH /api/slicing/jobs?id=cea013ea-cfda-4629-b161-74d9b29381a8`
- `artifactIntegrity=consistent`
- `geometryProof=embedded_mesh_matches_input_within_tolerance`
- complete oriented triangle correspondence：`2140/2140`
- maximum coordinate error：`1.952563479790115e-6 mm`
- allowed plate translation：`[58,78,0] mm`
- saved part binding：`saved_part_recomputed`
- settings、engine fingerprint、3MF structure、G-code/layer/extrusion 与 result metadata 均通过 server validation

本地 runner 结果内的 `report.json` 和 `process-log.txt` 记录了 executable/DLL 路径与 hash、manifest/input/config hash、完整 argv、开始/结束时间、exit code、3MF/G-code/settings/result 文件 hash。Windows launcher 的重定向 stdout/stderr 字节数为 0，但 Bambu CLI 的版本和 warning 诊断在 runner 控制台可见；结果包以 `stdout+stderr combined` 与 `capturedConsoleBytes=0` 诚实记录，没有把控制台输出伪装成签名日志。

## 4. Engineering Package

- Path：`work/validation/p1i/golden-engineering-package-v12.zip`
- Bytes：`4,935,351`
- SHA-256：`afa69845836898439085f63b1bc507279c49492918233de01db15d528e02095d`
- Slice index：`slicing/index.json`
- Traceability：`traceability.json`
- Slice Result archive：`slicing/cea013ea-cfda-4629-b161-74d9b29381a8/result/result.zip`
- Expanded result files：`slicing/cea013ea-cfda-4629-b161-74d9b29381a8/result/files/`
- Expanded 3MF files：`slicing/cea013ea-cfda-4629-b161-74d9b29381a8/result/sliced-3mf/`
- 关键包内文件：`Metadata/plate_1.gcode`、`Metadata/project_settings.config`、`effective-settings.json`、`slicer-result.json`、`process-log.txt`、`report.json`

包内同时保留：project snapshot、BOM、manufacturing plan、CAD STEP/BREP/STL/report、CAD execution proof、Slice manifests/config/input、真实 3MF/G-code/effective settings/runtime evidence/log、Slice Evidence 和 Visual Candidate reference 元数据。Visual Candidate 仍只在 `references/`，不进入 BOM、manufacturing plan 或当前 Slice input。

## 5. P1-I 修改文件

- `public/offline-bambu/recipe.json`：把 exact official Windows executable pin 更新为实际验证 hash。
- `public/offline-bambu/run_offline.py`：同步 executable pin；将 runtime/command/generated-file evidence 写入 `command.json`、`report.json` 和正式 `process-log.txt`，不放宽 3MF/G-code/geometry/settings 校验。
- `validation/p1i-build-task.cjs`：从 API task manifest 和固定配置生成验证任务包。
- `validation/p1i-closure.cjs`：断言 server result、Evidence、Revision 和 Engineering Package 的最终闭环及逐文件 hash。
- `docs/P1I_EXACT_BAMBU_RUNTIME_REAL_SLICE_CLOSURE_REPORT.md`：本报告。
- `docs/CURRENT_PROJECT_STATUS.md`：更新唯一当前状态入口到 Revision 12 与 P1-I 结果。

## 6. Validation / build

- 官方 Bambu ZIP SHA-256：通过。
- executable version、executable SHA、DLL SHA：通过。
- Conda `<conda-root>\envs\zaowu-cad\python.exe` Python `3.12.14`：通过；仅运行标准库 runner。
- `python -m py_compile public/offline-bambu/run_offline.py`：通过。
- 真实 Bambu runner：exit code `0`，result emitted。
- Server Slice Result PATCH import：通过，未直接修改 D1 制造成功状态。
- `node validation/p1i-closure.cjs`：通过，`passed=true`。
- `npm run build`：通过。
- P1-G boundary：通过；golden CAD：通过；slice geometry：`39/39` 通过；quality baseline：`2/2` 通过。
- P1-H closure 脚本未作为当前回归运行，因为它固定断言 P1-H 的 Revision 11；P1-H 历史报告与 Evidence 保留，P1-I closure 重新断言当前 Revision 12、结果导入和工程包。
- 全仓库 `npm run lint` 仍会扫描历史 `work/validation`、官方 Bambu Web 资源和既有源码，报告既存 lint errors；本轮新增 JS validation 文件的定向 ESLint 为通过。

## 7. 仍未完成与边界

仍未完成：自交/壳嵌套的完整工程分析、局部壁厚与薄弱结构、强度、完整接口/装配公差、支撑与翘曲的制造判断、实际机台与材料批次校准、首件尺寸/功能、制造审核、责任签核和生产放行。

`physicalValidation` 仍是 `not_run`，`productionReady` 仍是 `false`。软件切片成功不等于实体打印成功；`unsigned_local_report` 也不等于硬件 attestation、独立 CAD 重算或物理合格证明。
