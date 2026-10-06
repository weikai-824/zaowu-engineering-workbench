"""Durable repair-run lifecycle recovery tests."""

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from zaowu_agent.domain.repair import RepairBudget, RunPhase
from zaowu_agent.services.repair_runs import RepairRunService
from zaowu_agent.workflow.graph import create_repair_graph_builder
from zaowu_agent.workflow.state import RepairWorkflowContext

from .test_repair_workflow import FakeGateway, FakePlanner, repair_request


@pytest.mark.asyncio
async def test_duplicate_create_resumes_incomplete_planning_checkpoint() -> None:
    """A caller retry advances the saved task instead of returning it forever."""
    planner = FakePlanner()
    context = RepairWorkflowContext(
        planner=planner,
        gateway=FakeGateway(),
        budget=RepairBudget(),
    )
    graph = create_repair_graph_builder().compile(
        checkpointer=InMemorySaver(),
        interrupt_after=["load_context"],
        name="planning-recovery-test",
    )
    service = RepairRunService(graph=graph, context=context)
    request = repair_request()

    interrupted = await service.create(request)
    recovered = await service.create(request)
    idempotent = await service.create(request)

    assert interrupted["phase"] == RunPhase.PLANNING.value
    assert recovered["phase"] == RunPhase.WAITING_FOR_APPROVAL.value
    assert idempotent["phase"] == RunPhase.WAITING_FOR_APPROVAL.value
    assert recovered["run_id"] == interrupted["run_id"]
    assert planner.create_calls == 1
