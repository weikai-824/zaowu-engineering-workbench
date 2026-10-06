# P1-J：Golden Demo Visibility & Presentation Closure

## 结论

当前 Golden Scenario 已可以在普通本地浏览器中从项目入口一路演示到真实 Slice Result 和 Engineering Package。服务运行于 `http://127.0.0.1:8787`，无需浏览器 Header 扩展。

## 当前真实基线

- Project ID：`91ad21c0-4143-4252-8969-00dc31047b82`
- 名称：`小型桌面设备防护外壳 · P1-C High Quality Candidate`
- Current Revision：12
- 当前 Slice Task：`cea013ea-cfda-4629-b161-74d9b29381a8`
- Slice status：`offline_consistent`
- Slice Evidence：`d8f38c6a-9c7e-410e-aa6d-71e4b972fd5c`
- 引擎：Bambu Studio `02.08.02.60`
- 层数：300
- Filament：`109.98854064941406 g`（界面显示 109.99 g）
- 估计时间：`7909.16943359375 s`（界面显示约 132 分钟）
- physicalValidation：`not_run`
- productionReady：`false`

## Local Demo 身份与启动

实现方式：

- `.env.local` 显式启用 `LOCAL_DEMO_MODE=true`；构建后的 Wrangler 配置只在该配置启用时注入变量。
- `owner()` 仅在显式 Demo 模式下请求 loopback-only fallback identity：`local_seedy / seedy@sites.test / Seedy`。
- 仅接受 `localhost`、`127.0.0.1`、`::1`；公网 Host 不会获得 fallback 身份。
- 正常 `oai-authenticated-user-id` / `oai-authenticated-user-email` Header 仍优先。
- 用 `Host: example.com` 请求本地 API 的验证结果为 `401 Unauthorized`，生产认证设计未被关闭。

## 页面巡检

- Header：普通浏览器进入后显示当前项目名、`v12`、`已同步`；不再显示未命名项目/v0。
- Visual Candidate：恢复 R2 对象后可正常加载，`visual_reference` 标签明确；69889 triangles，128.93 × 140 × 101.73 mm；不进入 BOM、制造计划、实际切片或制造装配。
- CAD：当前 manufacturing asset 可查看，140 × 100 × 60 mm、2140 triangles；CAD 页面显示当前签名执行与 P1-H 结果。
- Offline Slice：当前任务显示 `offline_consistent`、300 层、109.99 g、约 132 分钟、Bambu 02.08.02.60。
- Slice Evidence：当前任务卡直接展示 Task ID、Evidence Revision 12、manifest 前缀、引擎版本、Result SHA-256、网格一致性和 3MF/G-code 结果包入口。
- Engineering Package：已从当前 UI 点击“下载当前工程包 v12”并成功得到约 6.8 MB ZIP；包内包含 CAD、execution proof、manufacturing STL、slice manifest/config、3MF、G-code、Slice Evidence、日志和 traceability。
- Revision History：版本页可查看 v1–v12，历史版本仍保留。
- Connection Settings：CAD 与 Bambu 分别显示 `previously verified`；Bambu 显示 `previously verified · offline_consistent`，没有伪造当前持续连接。

## 3MF 与 Visual 状态

- `/api/slicing/jobs?id=cea013ea-cfda-4629-b161-74d9b29381a8&file=result` 返回 200，结果包可访问。
- Engineering Package 中的 `sliced.3mf` 与外置 Bambu 演示文件 `Golden Scenario Revision 12.3mf` 字节级一致：242659 bytes，SHA-256 `afd31f756c6c17c1ed23791f0c58dddf1b9e9502f9db0f6ebe6ebfb64bfa60a0`。
- 真实 Bambu Preview 的 300 层/刀路状态沿用 P1-I 已确认的结果；本轮没有重新切片。
- Visual Candidate 使用同 SHA 本地 GLB 恢复 R2，未重新调用 Tripo。

## 当前与历史状态修正

- 当前任务只有真实 `offline_consistent` 结果显示为当前。
- 旧的 `prepared` 任务现在显示为“历史 · prepared · runtime unavailable”。
- 输入已改变的旧任务继续显示为历史/stale。
- 工程检查区将当前输入 hash 下的有效结果与历史/过期检查分开；历史记录没有删除。
- `physicalValidation=not_run` 与 `productionReady=false` 保持真实，没有被演示状态覆盖。

## 关键修改文件

- `app/chatgpt-auth.ts`
- `lib/server.ts`
- `scripts/sites-env.mjs`
- `vite.config.ts`
- `app/workbench.tsx`
- `app/offline-slicing.tsx`
- `app/api/connections/route.ts`
- `app/api/slicing/jobs/route.ts`
- `.env.example` / 本地 `.env.local`

## 验证结果

- `npm run build`：通过。
- `npx tsc --noEmit`：通过。
- 本轮涉及文件定向 ESLint：0 error，2 个既有 `<img>` warning。
- 完整 `npm run lint`：仓库现有 `work/validation`、bundle 与旧代码触发大量既有问题（本次记录为 877 errors / 13319 warnings）；不是本轮新增功能的定向 lint 结果。
- 普通无 Header API：项目、连接、切片任务、Visual asset、Slice result 均可访问。
- 本地服务当前保持监听：`127.0.0.1:8787`。

## 仍未完成但保持真实的问题

- AI 工程主控与 Tripo 当前未配置，连接页仍显示 unavailable。
- CAD executor 与 Bambu runtime 当前没有持续后台连接，但已有真实成功执行证据，因此显示 previously verified。
- physical validation、首件实测与 production release 仍未执行。
- CAD 外观仍是基础工程外壳；P1-J 不擅自重建高保真 CAD。

## Demo 路径

打开 `http://127.0.0.1:8787` → 当前项目 v12 → 设计工坊查看 visual_reference 与 manufacturing → CAD 建模 → 离线切片查看 offline_consistent、Slice Evidence、3MF/G-code → 下载当前工程包 → 项目版本查看 v1–v12 → 连接设置查看 previously verified 状态。

