"""Durable run lifecycle backed by LangGraph checkpoints."""

from asyncio import Lock
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid5

from langchain_core.runnables.config import RunnableConfig
from langgraph.types import Command

from zaowu_agent.domain.repair import (
    ApprovalDecision,
    ClarificationResponse,
    RepairRequest,
    RunPhase,
)
from zaowu_agent.observability import LangSmithTracing, repair_trace_metadata
from zaowu_agent.workflow.graph import RepairGraph
from zaowu_agent.workflow.state import (
    RepairState,
    RepairWorkflowContext,
    initial_repair_state,
)

_RUN_NAMESPACE = UUID("4dceec54-0cdc-4ca1-bce4-84073bfa3943")
_LOCK_STRIPES = 64


class RepairRunNotFoundError(Exception):
    """Raised when a run is absent or belongs to another owner."""


class RepairRunConflictError(Exception):
    """Raised when a lifecycle command does not match the checkpoint phase."""


class RepairRunService:
    """Start and resume one durable graph thread per idempotent repair request."""

    def __init__(
        self,
        *,
        graph: RepairGraph,
        context: RepairWorkflowContext,
        tracing: LangSmithTracing | None = None,
    ) -> None:
        self._graph = graph
        self._context = context
        self._tracing = tracing or LangSmithTracing(
            client=None,
            project_name="zaowu-agent-disabled",
            environment="test",
            flush_timeout_seconds=1.0,
        )
        self._locks = tuple(Lock() for _ in range(_LOCK_STRIPES))

    @staticmethod
    def run_id_for(request: RepairRequest) -> UUID:
        """Derive a stable run ID without a second idempotency database."""
        return uuid5(
            _RUN_NAMESPACE,
            f"{request.owner_id}:{request.client_request_id}",
        )

    @staticmethod
    def _config(run_id: UUID) -> RunnableConfig:
        return {"configurable": {"thread_id": str(run_id)}}

    @staticmethod
    def _plan_version(state: RepairState) -> int | None:
        plan = state["plan"]
        if not isinstance(plan, dict):
            return None
        version = plan.get("version")
        return version if isinstance(version, int) else None

    async def _invoke(
        self,
        graph_input: RepairState | Command[str] | None,
        *,
        run_id: UUID,
        request: RepairRequest,
        operation: str,
        plan_version: int | None,
    ) -> None:
        metadata = repair_trace_metadata(
            run_id=run_id,
            project_id=request.project_id,
            project_revision=request.project_revision,
            operation=operation,
            plan_version=plan_version,
        )
        config: RunnableConfig = {
            "configurable": {"thread_id": str(run_id)},
            "run_name": "zaowu_repair_workflow",
            "tags": ["zaowu-agent", "repair-workflow", f"operation:{operation}"],
            "metadata": metadata,
        }
        with self._tracing.scope(metadata=metadata, operation=operation):
            await self._graph.ainvoke(
                graph_input,
                config,
                context=self._context,
                durability="sync",
            )

    def close(self) -> None:
        """Flush optional observability buffers owned by this service."""
        self._tracing.close()

    def _lock_for(self, run_id: UUID) -> Lock:
        return self._locks[run_id.int % len(self._locks)]

    async def _read_state(self, run_id: UUID) -> RepairState | None:
        snapshot = await self._graph.aget_state(self._config(run_id))
        if not snapshot.values:
            return None
        return cast(RepairState, snapshot.values)

    @staticmethod
    def _assert_owner(state: RepairState | None, owner_id: str) -> RepairState:
        if state is None:
            raise RepairRunNotFoundError
        request = RepairRequest.model_validate(state["request"])
        if request.owner_id != owner_id:
            raise RepairRunNotFoundError
        return state

    async def create(self, request: RepairRequest) -> RepairState:
        """Start planning or resume an interrupted idempotent create request.

        A caller can disconnect while the durable graph is between the context
        and planning checkpoints.  In that case a repeated create with the same
        idempotency key must drive the pending graph task instead of returning a
        permanently stuck ``planning`` view.
        """
        run_id = self.run_id_for(request)
        async with self._lock_for(run_id):
            existing = await self._read_state(run_id)
            if existing is not None:
                existing_request = RepairRequest.model_validate(existing["request"])
                if existing_request != request:
                    raise RepairRunConflictError(
                        "client_request_id is already bound to different repair input"
                    )
                if existing["phase"] in {
                    RunPhase.PENDING.value,
                    RunPhase.LOADING_CONTEXT.value,
                    RunPhase.PLANNING.value,
                }:
                    await self._invoke(
                        None,
                        run_id=run_id,
                        request=request,
                        operation="recover_create",
                        plan_version=self._plan_version(existing),
                    )
                    return self._assert_owner(await self._read_state(run_id), request.owner_id)
                return existing
            created_at = datetime.now(UTC).isoformat()
            state = initial_repair_state(
                request=request,
                run_id=run_id,
                thread_id=run_id,
                budget=self._context.budget,
                created_at=created_at,
            )
            await self._invoke(
                state,
                run_id=run_id,
                request=request,
                operation="create",
                plan_version=None,
            )
            return self._assert_owner(await self._read_state(run_id), request.owner_id)

    async def get(self, *, owner_id: str, run_id: UUID) -> RepairState:
        """Return the latest checkpoint after enforcing owner isolation."""
        return self._assert_owner(await self._read_state(run_id), owner_id)

    async def decide(
        self, *, owner_id: str, run_id: UUID, decision: ApprovalDecision
    ) -> RepairState:
        """Resume exactly one approval interrupt."""
        async with self._lock_for(run_id):
            state = self._assert_owner(await self._read_state(run_id), owner_id)
            if state["phase"] != RunPhase.WAITING_FOR_APPROVAL.value:
                raise RepairRunConflictError("run is not waiting for plan approval")
            request = RepairRequest.model_validate(state["request"])
            await self._invoke(
                Command[str](resume=decision.model_dump(mode="json")),
                run_id=run_id,
                request=request,
                operation=decision.choice.value,
                plan_version=self._plan_version(state),
            )
            return self._assert_owner(await self._read_state(run_id), owner_id)

    async def clarify(
        self, *, owner_id: str, run_id: UUID, response: ClarificationResponse
    ) -> RepairState:
        """Resume exactly one planner clarification interrupt."""
        async with self._lock_for(run_id):
            state = self._assert_owner(await self._read_state(run_id), owner_id)
            if state["phase"] != RunPhase.WAITING_FOR_CLARIFICATION.value:
                raise RepairRunConflictError("run is not waiting for clarification")
            plan = state["plan"] or {}
            questions = plan.get("questions")
            if not isinstance(questions, list) or len(response.answers) != len(questions):
                raise RepairRunConflictError(
                    "clarification answer count does not match planner questions"
                )
            request = RepairRequest.model_validate(state["request"])
            await self._invoke(
                Command[str](resume=response.model_dump(mode="json")),
                run_id=run_id,
                request=request,
                operation="clarify",
                plan_version=self._plan_version(state),
            )
            return self._assert_owner(await self._read_state(run_id), owner_id)

    async def continue_tool_wait(self, *, owner_id: str, run_id: UUID) -> RepairState:
        """Resume a tool-wait interrupt to perform an idempotent status query."""
        async with self._lock_for(run_id):
            state = self._assert_owner(await self._read_state(run_id), owner_id)
            if state["phase"] != RunPhase.WAITING_FOR_TOOL.value:
                raise RepairRunConflictError("run is not waiting for an external tool")
            request = RepairRequest.model_validate(state["request"])
            await self._invoke(
                Command[str](resume={"action": "check"}),
                run_id=run_id,
                request=request,
                operation="continue",
                plan_version=self._plan_version(state),
            )
            return self._assert_owner(await self._read_state(run_id), owner_id)
