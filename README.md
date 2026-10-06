# 造物工程台 | Zaowu Engineering Workbench

面向工业设计到增材制造交付的工程工作台。当前版本已经具备项目版本、工艺资料、Tripo 3D 任务、模型检查、受控 CAD 执行与制造证据导出；简历版将在这些真实工程能力之上增加可恢复、可审批、可审计的 Agent 工作流。

这不是“聊天框套工具”的演示。目标岗位是 **Python Agent 应用开发**，Agent 服务采用 Python 3.12、FastAPI、LangGraph 与 PostgreSQL；现有 TypeScript/Cloudflare 应用保留为产品前端、业务数据层和受控 Tool Gateway。

## Current status and boundaries

- 当前已实现：TypeScript 产品、D1/R2 业务数据、Tripo 集成、本机 CAD 执行器、工程校验，以及 Python 3.12/FastAPI Agent Service、PostgreSQL LangGraph checkpointer、业务状态图、六工具 Tool Gateway、人工澄清/审批/等待恢复和 Run 时间线。
- 2026-09-27 本机实测：文字生成到模型自动显示、真实浏览器画圈到 CAD 返工和新几何回显均已通过，见 [现场演示步骤与证据](docs/LOCAL_DEMO_ACCEPTANCE_2026-09-27.md)。任意 Tripo 网格的精确局部修改不在已实现范围。
- 当前待验收/待扩展：人工现场录屏尚未录制；LangSmith 已覆盖 trace 树，Studio Graph Mode 尚未接入；版本化 Agent 评测集仍属于后续目标。
- 核心 Agent 范式：`Planner -> Executor -> Verifier -> Replanner`。ReAct 只允许在单个规划或重规划节点内做有界推理，不承担长流程状态管理。
- 非目标：多 Agent 角色扮演、Agent 比赛包装、A2A 网络、为了展示技术而重写已有业务系统。
- 三个交付目标与验收证据见 [`docs/AGENT_RESUME_ROADMAP.md`](docs/AGENT_RESUME_ROADMAP.md)，架构边界见 [`docs/adr/0001-agent-application-boundary.md`](docs/adr/0001-agent-application-boundary.md)。

## Architecture direction

```text
Product UI (TypeScript / Vinext)
        |
        | Agent run API + approval commands
        v
Agent Service (Python / FastAPI)                   [implemented]
        |        PostgreSQL checkpoints            [implemented]
        |        LangGraph repair workflow         [implemented]
        |
        | allow-listed, schema-validated tools
        v
Tool Gateway (existing TypeScript routes)
        |
        +-- D1 / R2 business data
        +-- Tripo provider integration
        +-- local CAD executor and engineering validators
```

Agent 不直接读写 D1/R2，也不绕过既有鉴权、幂等、预算和工程校验。PostgreSQL 只承担 Agent run、checkpoint、approval 与审计状态，不迁移现有业务数据。

## Quality gate

```sh
npm ci
uv sync --project services/agent --frozen
npm run check
```

`npm run check` 依次执行 TypeScript 与 Python 的 lint/type check、两端单元/离线回归测试和生产构建。PostgreSQL checkpoint 集成测试使用独立命令 `npm run agent:test:integration`，测试不读取真实业务密钥、不访问 Tripo 真实账户，也不操作打印机。

## Prerequisites

- Node.js `>=22.13.0`
- Python `3.12.x` and [uv](https://docs.astral.sh/uv/) for the Agent service
- Docker Desktop or a compatible Docker Engine only for local PostgreSQL and integration tests
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites runtime selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit product source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Whenever reopening or moving a checkout, run `node <plugin-root>/scripts/configure-execution-profile.mjs` before project commands. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This project does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

On managed Linux, use `sites-preview start` only for requested browser QA. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Current repository shape

- edit site code under `app/`
- `services/agent/` contains the Python Agent API, configuration, PostgreSQL checkpointer and tests
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Tripo 3D production integration

The workbench uses Tripo's server-side v3 API. Configure `TRIPO_API_KEY` as a Sites runtime secret; never put it in browser code or source control. `TRIPO_REGION` selects `global` (`https://openapi.tripo3d.ai/v3`) or `china` (`https://openapi.tripo3d.com/v3`). In “连接设置”, “测试 Tripo API” calls the account balance endpoint and, when available, the account usage endpoint; it shows the selected region, pinned model, available/frozen credits, an account-level task/credit summary, and supported operations without exposing the key. Usage is advisory and project job records remain the source of truth for attribution.

The guarded AI planning path accepts a text request, an optional reference image, and, when a saved mesh part is selected, metadata for its bound 3D attachment (file identity, size, dimensions, triangle count, source and process binding). The metadata helps locate and constrain a multimodal edit; it is not presented as a full mesh read by the AI. Geometry changes still go through the controlled CAD and engineering checks.

The design workbench accepts text, one reference image, or 2–4 labeled multiview images (front/back/left/right). PNG, JPEG and WebP are accepted up to 20 MB per image. Multiview requests are uploaded server-side and sent to Tripo's `/generation/multiview-to-model` endpoint; `front` is required, and the view labels and file IDs are part of the idempotency record so a retry cannot silently change the source set.

The same project can create a 2D concept/setting image through Tripo's `/generation/text-to-image` endpoint. The request is recorded with an image model, size, output format and watermark choice; the completed PNG/JPEG/WebP is downloaded to private R2, checked by file signature, and shown in the Versions page. “作为 3D 参考图” attaches the recovered image to the saved project so a later Tripo model request can use it as its source image. This is a concept-design aid: it does not prove dimensions, interfaces or printability.

Engineering export now includes `manufacturing/plan.json` and `manufacturing/parameter-sheet.csv`. They snapshot each part's selected process, machine, material, profile parameters, unknown parameters, required checks and `reference_only` status. This makes the handoff explicit without pretending that public reference values are validated slicer or machine instructions.

Generation supports text and image input, a pinned model version, face limit, texture/PBR, texture quality/alignment, UV export, real-size mode, reproducible geometry/image/texture seeds, negative prompt, image autofix/orientation, optional export forward axis, quad topology, low-poly and generated-parts options. Manufacturing context (process, machine, material, split strategy, assembly, tolerance, base/enclosure and drawing requirements) is stored in the immutable job request and compiled into the prompt as context. A job can also bind to one of the 15 versioned machine/material profiles in the process library; the server validates the profile ID before contacting Tripo and records the selected machine/material snapshot. It is not treated as a substitute for CAD, slicing or physical validation. Officially incompatible Tripo combinations are rejected before a provider call.

An existing GLB/GLTF/FBX/OBJ/STL/3MF asset can be sent to Tripo for import. The design page has both “send the selected saved part” and “upload a model file directly to Tripo” paths, so a source format that the browser previewer cannot decode can still enter the controlled import workflow. Models over 60 MB and 3MF files use Tripo's presigned upload flow; smaller supported files use multipart upload. After any successful source task, the Versions page exposes server-side post-processing tasks for mesh segmentation, mesh completion, retopology/decimation, texture regeneration and STL conversion. Each task keeps its original `task_id`, uses the same idempotent request ledger, and can be queried and recovered without submitting a duplicate generation.

Current endpoint mapping follows Tripo v3: `/files`, `/generation/text-to-image`, `/generation/text-to-model`, `/generation/image-to-model`, `/models/import`, `/mesh/segment`, `/mesh/complete`, `/mesh/decimate`, `/models/texture`, `/models/convert`, and `GET /tasks/{task_id}`. Temporary output URLs are downloaded immediately to private R2 after host allow-list checks; raster setting images are checked for PNG/JPEG/WebP signatures and model outputs are checked as GLB before an asset can be attached to a project.

The Versions page also has a login-protected “批量回收” action that scans up to 20 active Tripo jobs for the current project. It groups task IDs by their original API region, uses Tripo's batch task query where possible, and reuses the returned status during recovery; a batch failure falls back to individual recovery. It is safe to use after reopening a project: it never creates a replacement generation request.

For hands-off completion, configure `TRIPO_WEBHOOK_SECRET` with the signing secret from Tripo Console → Settings → Webhooks and register `https://<your-site>/api/tripo/webhook` for `task.completed` and `task.failed`. The endpoint verifies the HMAC signature and records the original task state; the next visible workbench poll performs the authenticated download and GLB validation. Webhook events for unknown task IDs are acknowledged without creating project data.

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

The repeatable local migration command is:

```sh
npm run db:migrate:local
```

It applies pending SQL files in order, records applied migrations in the local preview database, and refuses to replay a partially present schema. Check-only mode is available with `npm run db:check:local`.

On Windows, if Tripo access is provided through the system proxy, set the local-only `TRIPO_PROXY_URL` in `.env.local` (for example `http://127.0.0.1:12334`). The local startup loader maps it to Node's HTTPS proxy settings; it does not change system proxy settings or production configuration.

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run typecheck`: run the TypeScript compiler without emitting files
- `npm run lint`: lint maintained product and tooling source
- `npm test`: run the core offline regression suites
- `npm run check`: run the complete local quality gate
- `npm run agent:dev`: start the local FastAPI Agent service on port 8001
- `npm run agent:check`: run Ruff, formatting, strict mypy and Python unit/API tests
- `npm run agent:test:integration`: verify service startup and checkpoint recovery against disposable PostgreSQL
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run db:migrate:local`: apply and record local D1 migrations safely
- `npm run db:check:local`: check local D1 schema without changing it
- `npm run preflight:tripo`: classify local Tripo configuration, connectivity, key validity and available quota without creating a task

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
