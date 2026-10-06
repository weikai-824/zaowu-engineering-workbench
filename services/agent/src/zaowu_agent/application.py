"""FastAPI application factory and resource lifecycle."""

import logging
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from time import perf_counter
from uuid import uuid4

import httpx
from fastapi import FastAPI, Request, Response

from zaowu_agent.adapters.planner import create_langchain_planner
from zaowu_agent.adapters.tool_gateway import HttpRepairToolGateway
from zaowu_agent.api.errors import register_error_handlers
from zaowu_agent.api.health import router as health_router
from zaowu_agent.api.models import ServiceInfo
from zaowu_agent.api.runs import router as runs_router
from zaowu_agent.container import ServiceContainer
from zaowu_agent.core.config import Settings, load_settings
from zaowu_agent.core.context import bind_log_context
from zaowu_agent.core.logging import configure_logging
from zaowu_agent.domain.repair import RepairBudget
from zaowu_agent.observability import create_langsmith_tracing
from zaowu_agent.persistence.checkpoints import (
    CheckpointRuntime,
    open_postgres_checkpoints,
)
from zaowu_agent.services.repair_runs import RepairRunService
from zaowu_agent.workflow.graph import build_repair_graph
from zaowu_agent.workflow.state import RepairWorkflowContext

REQUEST_ID_HEADER = "X-Request-ID"
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
CheckpointRuntimeFactory = Callable[[Settings], AbstractAsyncContextManager[CheckpointRuntime]]
RepairRunServiceFactory = Callable[
    [Settings, CheckpointRuntime, httpx.AsyncClient], RepairRunService | None
]
RequestHandler = Callable[[Request], Awaitable[Response]]

logger = logging.getLogger(__name__)


def create_repair_run_service(
    settings: Settings,
    checkpoints: CheckpointRuntime,
    http_client: httpx.AsyncClient,
) -> RepairRunService | None:
    """Build production workflow dependencies only when all secrets are configured."""
    if not settings.repair_workflow_configured:
        return None
    if not settings.gateway_url or not settings.gateway_token:
        return None
    planner = create_langchain_planner(settings)
    gateway = HttpRepairToolGateway(
        client=http_client,
        base_url=str(settings.gateway_url),
        token=settings.gateway_token.get_secret_value(),
    )
    budget = RepairBudget(
        max_plan_attempts=settings.max_plan_attempts,
        max_replans=settings.max_replans,
        max_tool_calls=settings.max_tool_calls,
        max_plan_steps=settings.max_plan_steps,
        max_model_tokens=settings.max_model_tokens,
        max_estimated_cost_usd=settings.max_estimated_cost_usd,
        max_run_age_seconds=settings.max_run_age_seconds,
    )
    context = RepairWorkflowContext(planner=planner, gateway=gateway, budget=budget)
    return RepairRunService(
        graph=build_repair_graph(checkpoints.checkpointer),
        context=context,
        tracing=create_langsmith_tracing(settings),
    )


def resolve_request_id(request: Request) -> str:
    """Reuse a safe caller identifier or create a UUID for correlation."""
    candidate = request.headers.get(REQUEST_ID_HEADER, "")
    return candidate if REQUEST_ID_PATTERN.fullmatch(candidate) else str(uuid4())


def create_app(
    settings: Settings | None = None,
    checkpoint_runtime_factory: CheckpointRuntimeFactory = open_postgres_checkpoints,
    repair_run_service_factory: RepairRunServiceFactory = create_repair_run_service,
) -> FastAPI:
    """Create an Agent API with explicit, injectable infrastructure."""
    resolved_settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(resolved_settings.log_level)
        async with (
            checkpoint_runtime_factory(resolved_settings) as checkpoints,
            httpx.AsyncClient(
                timeout=resolved_settings.gateway_timeout_seconds,
                follow_redirects=False,
            ) as http_client,
        ):
            repair_runs = repair_run_service_factory(
                resolved_settings,
                checkpoints,
                http_client,
            )
            app.state.container = ServiceContainer(
                settings=resolved_settings,
                checkpoints=checkpoints,
                repair_runs=repair_runs,
            )
            logger.info(
                "agent_service_started", extra={"environment": resolved_settings.environment}
            )
            try:
                yield
            finally:
                if repair_runs is not None:
                    repair_runs.close()
            logger.info("agent_service_stopped")

    app = FastAPI(
        title="Zaowu Agent Service",
        version=resolved_settings.service_version,
        description=(
            "Durable Planner-Clarification-Approval-Executor-Verifier-Replanner "
            "orchestration for revision-bound engineering repair."
        ),
        lifespan=lifespan,
    )
    register_error_handlers(app)

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next: RequestHandler) -> Response:
        request_id = resolve_request_id(request)
        started_at = perf_counter()
        with bind_log_context(request_id=request_id):
            response = await call_next(request)
            response.headers[REQUEST_ID_HEADER] = request_id
            logger.info(
                "http_request_completed",
                extra={
                    "http_method": request.method,
                    "http_path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round((perf_counter() - started_at) * 1000, 2),
                },
            )
            return response

    @app.get("/", response_model=ServiceInfo, tags=["service"])
    async def service_info(request: Request) -> ServiceInfo:
        container = request.app.state.container
        return ServiceInfo(
            name=resolved_settings.service_name,
            version=resolved_settings.service_version,
            environment=resolved_settings.environment,
            agent_graph=("available" if container.repair_runs is not None else "not_configured"),
        )

    app.include_router(health_router)
    app.include_router(runs_router)
    return app
