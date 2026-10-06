# 阶段 2：Python Agent Service 基线验收

- 完成日期：2026-09-21
- 范围：服务骨架、API 契约、PostgreSQL checkpointer 与 Python 质量门禁
- 明确不包含：业务工具、Planner/Executor/Verifier/Replanner 状态图、人工审批和 UI 时间线

## 已实现

- Python 3.12 `src` 布局与 uv 锁文件。
- FastAPI application factory 与 lifespan 资源管理。
- `/health/live` 和真实 PostgreSQL `/health/ready`。
- `POST /v1/runs`、`GET /v1/runs/{run_id}` 版本化契约。
- 统一错误 envelope、请求校验错误、`X-Request-ID` 回传。
- request/run/thread 上下文与 JSON 结构化日志。
- 官方 `AsyncPostgresSaver`、Psycopg 连接池与首次 `setup()`。
- `JsonPlusSerializer(allowed_msgpack_modules=None)` 严格反序列化策略。
- Windows Selector event loop 策略，满足 Psycopg 异步运行要求。
- 开发 PostgreSQL compose 与隔离的 tmpfs 集成测试 compose。

## 锁定的主要版本

- Python `3.12.13`
- FastAPI `0.141.1`
- LangGraph `1.2.11`
- LangGraph PostgreSQL checkpointer `3.1.2`
- Psycopg/Psycopg Pool `3.3.6` / `3.3.2`
- Pydantic/Pydantic Settings `2.13.5` / `2.15.0`

精确依赖与哈希以 `services/agent/uv.lock` 为准。

## 验收证据

- Ruff lint：通过。
- Ruff format check：通过。
- strict mypy：通过。
- Python unit/API tests：17 项通过，覆盖率 90% 以上。
- PostgreSQL integration：服务真实启动、健康检查、checkpointer `setup()`、状态写入及按 `thread_id` 恢复通过。
- 根目录 `npm run check`：覆盖 TypeScript 与 Python 两套质量门禁。
- 生产构建：现有 Wrangler 预览占用根目录 `dist` 时，在隔离副本完成 Vinext 五阶段构建；没有中断用户预览。
- 构建可复现性：将 `vite.config.ts` 必需且无法由仓库命令再生成的 `build/sites-vite-plugin.ts` 与许可证纳入 Git。

## 诚实边界

Run API 当前返回 `501 agent_graph_not_implemented`。这是有意的能力门：在目标 1 的 Tool Gateway 与返工状态图完成前，不创建无法恢复、无法查询的假 run。PostgreSQL 当前仅由 LangGraph checkpointer 使用，既有 D1/R2 业务数据没有迁移。
