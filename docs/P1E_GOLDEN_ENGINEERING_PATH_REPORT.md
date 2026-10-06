# P1-E Golden Engineering Path V1

> Status: Historical / Superseded by [`P1F_CAD_RUNTIME_REAL_ENGINEERING_ASSET_REPORT.md`](./P1F_CAD_RUNTIME_REAL_ENGINEERING_ASSET_REPORT.md). 本文保留 CAD runtime blocked、无 result 的历史事实；当前 CAD 已在 P1-F 真实执行并归档。

日期：2026-09-15

## 结论

本轮完成了 Golden Scenario“小型桌面设备防护外壳”的受控 CAD 参数源、CAD 任务、Revision/Evidence 台账和离线导出验证，但没有完成真实 CAD 内核执行。

当前项目状态是：

`Tripo visual candidate → visual Evidence → Golden CAD design → CAD task prepared → CAD runtime blocked`

没有生成 CAD result-v1，因此没有创建 CAD Asset/Part，也没有把未执行的 CAD 设计标记为工程通过或生产就绪。当前项目 `91ad21c0-4143-4252-8969-00dc31047b82` 已保存为 revision 3；CAD job `6b559822-f45a-488e-83ba-7822e88850a9` 是本轮唯一 CAD 任务，状态为 `runtime_unavailable`，没有 result。

## Visual Candidate 与 CAD Engineering Asset 的边界

- P1-D Tripo 派生 visual candidate 仍是 Part `a1b29ad2-34ba-4b30-9ffa-cffa5475197e`，Asset `9f325de3-8d2b-4a4d-b53f-36d3a5b7695a`。
- visual candidate 的 `unitScale` 仍为 `142.86455194233326`，物理尺寸为 `128.93046021612426 × 140 × 101.72981528474949 mm`，三角面为 `69,889`。
- Golden CAD design 的 `visualReference` 明确指向该 Part/Asset/SHA-256；它只表达外观参考关系，不把 Tripo 网格当作 CAD 实体。
- 当前没有 CAD engineering Asset/Part。只有真实 CAD 结果通过 `readCadResult()` 后，才允许走 CAD result → Asset → Part → Revision 的附加链路。

## Golden CAD 参数源

文件：`lib/golden-enclosure-cad.ts`，契约：`cad-plan-v1`，单位：mm。

设计名为“Golden 外壳 · 确定性工程几何”，1 个 CAD 零件、19 个有序特征、4 个锁定直孔接口。`outer_width=140` 来自 Golden Scenario 的目标最长尺寸；以下数值是代码中明确标注为 `assumption` 的待确认工程假设，不冒充用户已提供：

- `outer_depth=100`、`outer_height=60`
- 壁厚 `4`、底板厚度 `8`
- USB-C 开口 `20 × 12`，底标高 `24`
- 三条通风槽及其位置
- 四个安装孔半径 `2.5`、边距 `10`

项目原有 brief、数量 `1`、连接方式 `screw`、优先工艺 `FDM` 和 P1-D 的工艺 profile 仍保存在 Project/Part metadata；假设清单追加到 Project notes 和准备记录。没有因为缺少实测包络、壁厚确认或公差数据而生成“已确认”结论。

## CAD 执行与 Evidence

现有执行器契约要求 Windows x64 的 Python 3.12、CadQuery `2.8.0`、OCP `7.9.3.1.1`、NLopt `2.9.0` 和 CasADi `3.8.0`。当前工作区只发现 WindowsApps 的 `python.exe` 别名；`python public/cad/run_cad.py ...` 返回 `exit=9009`，没有产生结果 ZIP。没有安装不受控依赖，也没有伪造 `cad-result-v1`。

Revision 3 新增的可信状态：

| Evidence | 状态 | 说明 |
|---|---|---|
| CAD 内核执行 | `not_run` | `blocked`：没有可验证 CadQuery/OCP runtime |
| CAD 实体结果与接口校验 | `not_run` | 没有 CAD result，不能声称实体、STEP 回读或接口量规通过 |
| CAD 路径 · 离线切片与支撑 | `not_run` | 没有 CAD STL，且本机没有固定 Bambu Studio 执行器 |

P1-D 的 visual topology evidence 没有被删除：revision 2 中仍是 `failed / topology_issues`，boundary edges `7`、non-manifold edges `11`、non-manifold vertices `17`、winding conflicts `1`。因为加入 CAD 参数源改变了工程输入 fingerprint，revision 3 正确将旧 visual evidence 标为 `stale`，并保留原 verdict 与 measured revision；没有把它改成 passed，也没有用 not_run 覆盖原失败事实。

## 导出与尺寸语义

完整当前 revision 的 `exportEngineering()` 会拒绝“有 CAD design 但还没有附加 CAD 实体”的项目，这是正确的安全门。本轮没有绕过它生成伪 CAD 工程包。

同时，使用 revision 2 已保存的 P1-D visual candidate、其真实 `unitScale` 和现有 `exportEngineering()`，生成了一个独立的 `visual_candidate_engineering_draft`：

- 输入 GLB：`4,034,388` bytes
- 导出草稿 ZIP：`5,694,275` bytes（最后一次验证）
- assembly GLB：`69,889` triangles
- 回读尺寸：`128.9304602161243 × 140 × 101.72981528474949 mm`
- `productionReady=false`
- topology：`failed / topology_issues`
- 各类自交、壁厚、装配、切片和实机验证：`not_run`

导出时还发现并记录了一个证据关联细节：P1-D 静态 `inspectGlb()` 和 Three 导入后的三角遍历顺序不同，所以旧的顺序敏感 `geometryHash` 不相等；重新执行现有 `digitalChecks()` 后，hash 与当前导入对象一致，triangle/topology 统计完全一致。导出验证使用 fresh Evidence，未放宽 hash 校验。

## Slicing 状态

现有 Offline Slicing 契约和 fixture 验证仍可用，但当前 Golden CAD 路径没有有效 CAD STL，所以没有创建本工程的 slicing job/result。没有把无关的 `100mm` fixture 绑定到当前项目，也没有伪造 G-code、支撑或制造通过。

## 验证记录

通过：

- `npm run validate:golden-cad-design`
- `npm run validate:quality-baseline`：2/2
- `npm run validate:candidate-comparison`
- `npm run validate:tripo-preview`
- `npm run validate:tripo-intake`
- `npm run validate:tripo-intake-service`
- `npm run validate:p1e-visual-export`
- `node validation/glb-fixtures.cjs`
- `node validation/topology.cjs`：33 cases
- `node validation/slice-geometry.cjs`：39 cases
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- changed-file ESLint

这些验证只使用已有 GLB、fixture、Mock 或本地代码；本轮 Tripo API 请求数为 **0**。

## 下一步

下一步最有价值的动作不是再提交 Tripo，而是在有明确、可审计的 CAD 工作站运行时后，只执行当前已保存的唯一 CAD task，回传真实 CAD result，再进行 `readCadResult → attach → digitalChecks → slicing`。在 CAD result 成功前，当前 stage gate 仍是 blocked，`productionReady` 仍为 false。
