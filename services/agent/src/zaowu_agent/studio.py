"""LangGraph Agent Server adapter used by LangSmith Studio Graph mode."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
from langgraph.graph.state import CompiledStateGraph

from zaowu_agent.adapters.planner import create_langchain_planner
from zaowu_agent.adapters.tool_gateway import HttpRepairToolGateway
from zaowu_agent.core.config import Settings, load_settings
from zaowu_agent.domain.repair import (
    ProjectContext,
    RepairBudget,
    RepairRequest,
    ToolInvocation,
    ToolResult,
)
from zaowu_agent.workflow.graph import create_repair_graph_builder
from zaowu_agent.workflow.state import RepairState, RepairWorkflowContext


@dataclass(frozen=True, slots=True)
class StudioToolGateway:
    """Use short-lived HTTP clients so hot reload never leaks a client loop."""

    base_url: str
    token: str
    timeout_seconds: float

    @asynccontextmanager
    async def _open(self) -> AsyncIterator[HttpRepairToolGateway]:
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds,
            follow_redirects=False,
        ) as client:
            yield HttpRepairToolGateway(
                client=client,
                base_url=self.base_url,
                token=self.token,
            )

    async def load_project_context(
        self,
        request: RepairRequest,
        *,
        accept_newer_revision: bool = False,
    ) -> ProjectContext:
        async with self._open() as gateway:
            return await gateway.load_project_context(
                request,
                accept_newer_revision=accept_newer_revision,
            )

    async def load_annotation_image(self, request: RepairRequest) -> str | None:
        async with self._open() as gateway:
            return await gateway.load_annotation_image(request)

    async def execute(self, invocation: ToolInvocation) -> ToolResult:
        async with self._open() as gateway:
            return await gateway.execute(invocation)


def _budget(settings: Settings) -> RepairBudget:
    return RepairBudget(
        max_plan_attempts=settings.max_plan_attempts,
        max_replans=settings.max_replans,
        max_tool_calls=settings.max_tool_calls,
        max_plan_steps=settings.max_plan_steps,
        max_model_tokens=settings.max_model_tokens,
        max_estimated_cost_usd=settings.max_estimated_cost_usd,
        max_run_age_seconds=settings.max_run_age_seconds,
    )


def build_studio_graph() -> CompiledStateGraph[RepairState, None, RepairState, RepairState]:
    """Compile the production topology for the local Agent Server."""
    settings = load_settings()
    if not settings.repair_workflow_configured:
        raise RuntimeError(
            "Studio requires the model and Tool Gateway values in services/agent/.env."
        )
    if settings.gateway_url is None or settings.gateway_token is None:
        raise RuntimeError("Studio Tool Gateway configuration is incomplete.")
    budget = _budget(settings)
    context = RepairWorkflowContext(
        planner=create_langchain_planner(settings),
        gateway=StudioToolGateway(
            base_url=str(settings.gateway_url),
            token=settings.gateway_token.get_secret_value(),
            timeout_seconds=settings.gateway_timeout_seconds,
        ),
        budget=budget,
    )
    return create_repair_graph_builder(runtime_context=context).compile(
        name="zaowu_repair_workflow"
    )


# Agent Server discovers this exported compiled graph through langgraph.json.
graph = build_studio_graph()
