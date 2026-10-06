# Zaowu Agent Service

Python 3.12/FastAPI service for the durable engineering-repair workflow. The
service runs one LangGraph state machine using the
Planner–Clarification–Approval–Executor–Verifier–Replanner pattern. PostgreSQL stores official
LangGraph checkpoints; product projects and assets remain in D1/R2 and are only
available through the authenticated TypeScript Tool Gateway.

## Workflow boundary

The graph contains explicit context loading, planning, user clarification, human approval,
single-tool execution, deterministic verification, external-tool waiting,
replanning and terminal nodes. Clarification, approval and CAD wait states use
LangGraph interrupts and resume the same `thread_id`. Clarification answers go
through the Replanner and never bypass the separate approval gate. The model can select only the
high-level actions allowed by `RepairPlan`; it cannot call D1, R2, the CAD
executor or arbitrary HTTP endpoints.

Planner and Replanner structured-output or policy-validation failures retry only
inside the current planning round and only while token, cost, age and attempt
budgets remain. Paid invalid responses are included in checkpointed usage totals;
a retry does not consume a successful replan round.

The first executable path is controlled parameterized CAD repair:

`apply design change → create CAD job → start execution → poll → attach result → verify revision`

Imported-mesh sculpting and changes to locked interfaces terminate as
`needs_engineering_review`. A successful software run does not claim physical
validation or production readiness.

## Local setup

```powershell
Copy-Item .env.example .env.local
Copy-Item services/agent/.env.example services/agent/.env
docker compose -f services/agent/compose.yml up -d --wait
uv sync --project services/agent --frozen
npm run dev
npm run agent:dev
```

Use the packaged `agent:dev` entry point on Windows. It supplies Uvicorn with a
Selector event-loop factory required by asynchronous Psycopg; invoking the
generic `uvicorn` CLI directly on Windows can select an incompatible Proactor
loop.

Use the same random secrets for these pairs:

- `.env.local` `AGENT_SERVICE_TOKEN` and `services/agent/.env`
  `AGENT_SERVICE_TOKEN`;
- `.env.local` `AGENT_TOOL_GATEWAY_TOKEN` and `services/agent/.env`
  `AGENT_GATEWAY_TOKEN`.

Set `AGENT_GATEWAY_URL` to the product origin plus `/api/agent-tools`. The Agent
API listens on `http://127.0.0.1:8001`; use `/health/live` and `/health/ready`
for liveness and PostgreSQL/checkpointer readiness.

For ordinary `npm run dev`, use
`http://127.0.0.1:5173/api/agent-tools`. For the branded
`scripts/open-local-domain.ps1` demo launcher, use the launcher's direct app
port: `http://127.0.0.1:8787/api/agent-tools`. Do not point the Agent at the
browser-only port-80 proxy or at the old unused port 3000.

## Quality commands

```powershell
npm run agent:check
npm test
npm run agent:test:integration
```

`npm test` includes the TypeScript side of the shared Tool Gateway fixture;
the Python suite validates the same fixture with Pydantic. The integration
command starts a disposable PostgreSQL 16 container on port `55433`, verifies
checkpoint recovery, and removes that container afterward. Docker Desktop must
be running; it never touches the persistent development volume.

## API

- `POST /v1/runs` creates an idempotent run and advances it to clarification,
  approval, a terminal state, or an external wait.
- `GET /v1/runs/{run_id}` reads the latest checkpoint-derived view.
- `POST /v1/runs/{run_id}/clarifications` resumes a clarification interrupt with
  one ordered answer for every Planner question.
- `POST /v1/runs/{run_id}/decisions` resumes approval with `approve`, `reject`
  or `modify`.
- `POST /v1/runs/{run_id}/continue` rechecks the same idempotent external tool
  operation.

These endpoints require the product service credential and an owner identity;
browsers call the product proxy under `/api/agent/runs` instead.

## LangSmith observability

LangSmith tracing is an optional development aid, not a workflow dependency or
persistence layer. Set these values only in the ignored `services/agent/.env`:

```dotenv
AGENT_LANGSMITH_TRACING=true
AGENT_LANGSMITH_API_KEY=your-local-secret
AGENT_LANGSMITH_PROJECT=zaowu-agent-development
```

Each graph start or resume becomes a root trace. Shared `repair_run_id` and
`thread_id` metadata correlate create, clarification, approval and tool-wait
resume traces for the same durable run; node, model and tool spans remain nested
under the invocation that executed them. Trace upload is buffered and delivery
failures do not change the Agent result.

The client removes owner identifiers, image data URLs, known secret fields and
recognized provider credentials before upload. Engineering goals, plans,
project parameters and tool evidence remain visible because they are needed for
debugging, so tracing stays opt-in. PostgreSQL checkpoints are still the source
of truth for resume/recovery, and the product timeline remains the user-facing
status view.

### Studio state graph

Start the local Agent Server adapter in a separate terminal:

```powershell
npm run agent:studio
```

Then open the Studio URL printed by the command (normally
`https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`) and choose
`zaowu_repair_workflow` in Graph mode. The adapter reuses the production graph
builder and nodes, but lets Agent Server own its development checkpointer. It
does not replace the FastAPI service on port 8001.

Runs started by the product remain visible under LangSmith Tracing. Runs
started inside Studio additionally animate the graph path and expose each
intermediate state and interrupt. Studio reads the same model and Tool Gateway
configuration from the ignored `services/agent/.env` file. Approving a Studio
interrupt therefore invokes the real allow-listed Tool Gateway; use `reject`
when the goal is only to demonstrate planning and state transitions.
