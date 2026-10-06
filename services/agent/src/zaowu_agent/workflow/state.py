"""Checkpointed state and runtime-only context for the repair graph."""

import operator
from dataclasses import dataclass
from typing import Annotated, TypedDict
from uuid import UUID

from zaowu_agent.domain.repair import RepairBudget, RepairRequest, RunPhase, TimelineEvent
from zaowu_agent.ports.repair import RepairPlanner, RepairToolGateway

SerializedModel = dict[str, object]


class RepairState(TypedDict):
    """JSON-compatible state persisted after each LangGraph superstep."""

    schema_version: int
    run_id: str
    thread_id: str
    request: SerializedModel
    budget: SerializedModel
    phase: str
    context: SerializedModel | None
    plan: SerializedModel | None
    step_index: int
    tool_index: int
    tool_call_count: int
    plan_attempt_count: int
    replan_count: int
    model_input_tokens: int
    model_output_tokens: int
    estimated_cost_usd: float
    tool_results: list[SerializedModel]
    last_tool_result: SerializedModel | None
    verification: SerializedModel | None
    approval_feedback: str | None
    clarification_feedback: str | None
    failure: SerializedModel | None
    final_revision: int | None
    final_asset_ids: list[str]
    started_at: str
    updated_at: str
    events: Annotated[list[SerializedModel], operator.add]


@dataclass(frozen=True, slots=True)
class RepairWorkflowContext:
    """Runtime dependencies that must never be serialized into checkpoints."""

    planner: RepairPlanner
    gateway: RepairToolGateway
    budget: RepairBudget


def initial_repair_state(
    *,
    request: RepairRequest,
    run_id: UUID,
    thread_id: UUID,
    budget: RepairBudget,
    created_at: str,
) -> RepairState:
    """Create the complete first checkpoint value for a new run."""
    event = TimelineEvent(
        sequence=0,
        phase=RunPhase.PENDING,
        kind="run_created",
        message="Repair run accepted for durable planning.",
        created_at=created_at,
        details={"project_revision": request.project_revision},
    )
    return RepairState(
        schema_version=3,
        run_id=str(run_id),
        thread_id=str(thread_id),
        request=request.model_dump(mode="json", by_alias=True),
        budget=budget.model_dump(mode="json"),
        phase=RunPhase.PENDING.value,
        context=None,
        plan=None,
        step_index=0,
        tool_index=0,
        tool_call_count=0,
        plan_attempt_count=0,
        replan_count=0,
        model_input_tokens=0,
        model_output_tokens=0,
        estimated_cost_usd=0.0,
        tool_results=[],
        last_tool_result=None,
        verification=None,
        approval_feedback=None,
        clarification_feedback=None,
        failure=None,
        final_revision=None,
        final_asset_ids=[],
        started_at=created_at,
        updated_at=created_at,
        events=[event.model_dump(mode="json")],
    )
