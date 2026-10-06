"""Behavior tests for the durable Planner-Executor-Verifier-Replanner graph."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from langchain_core.runnables.config import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from zaowu_agent.domain.repair import (
    FeedbackLocation,
    JsonValue,
    ModelUsage,
    PlanDisposition,
    PlannedRepair,
    ProjectContext,
    RegionFeedback,
    RegionShape,
    RepairAction,
    RepairBudget,
    RepairPlan,
    RepairRequest,
    RepairStep,
    RunPhase,
    ToolErrorKind,
    ToolInvocation,
    ToolName,
    ToolOutcome,
    ToolResult,
    VerificationOutcome,
    VerificationResult,
    ViewState,
)
from zaowu_agent.ports.repair import PlannerOutputError
from zaowu_agent.workflow.execution import (
    build_tool_invocation,
    tools_for_step,
    validate_plan,
    verify_tool_result,
)
from zaowu_agent.workflow.graph import (
    RepairGraph,
    build_repair_graph,
    create_repair_graph_builder,
)
from zaowu_agent.workflow.state import (
    RepairState,
    RepairWorkflowContext,
    initial_repair_state,
)


class FakePlanner:
    """Deterministic planner with observable replanning inputs."""

    def __init__(self) -> None:
        self.create_calls = 0
        self.revise_calls = 0
        self.last_human_feedback: str | None = None

    @staticmethod
    def _plan(version: int) -> RepairPlan:
        return RepairPlan(
            version=version,
            summary=f"Repair plan version {version}",
            rationale="Change a bounded CAD parameter and verify the regenerated asset.",
            steps=(
                RepairStep(
                    id=f"change-enclosure-v{version}",
                    action=RepairAction.CHANGE_CAD_PARAMETERS,
                    part_id=UUID("00000000-0000-4000-8000-000000000003"),
                    design_id=UUID("00000000-0000-4000-8000-000000000004"),
                    parameters={"width": 48 + version},
                    reason="The selected enclosure region needs more clearance.",
                    success_criteria=(
                        "A new CAD-derived asset is attached.",
                        "The project revision advances.",
                    ),
                ),
            ),
            required_checks=("revision_binding", "cad_asset_provenance"),
        )

    async def create_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        del request, context, annotation_image_data_url, budget
        self.create_calls += 1
        return PlannedRepair(
            plan=self._plan(1),
            usage=ModelUsage(
                input_tokens=800,
                output_tokens=200,
                total_tokens=1_000,
                estimated_cost_usd=0.001,
            ),
        )

    async def revise_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        previous_plan: RepairPlan,
        verification: VerificationResult | None,
        human_feedback: str | None,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        del request, context, verification, annotation_image_data_url, budget
        self.revise_calls += 1
        self.last_human_feedback = human_feedback
        return PlannedRepair(
            plan=self._plan(previous_plan.version + 1),
            usage=ModelUsage(
                input_tokens=1_000,
                output_tokens=250,
                total_tokens=1_250,
                estimated_cost_usd=0.0015,
            ),
        )


class ClarifyingPlanner(FakePlanner):
    """Ask for one missing engineering fact before producing an executable revision."""

    async def create_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        planned = await super().create_plan(
            request=request,
            context=context,
            annotation_image_data_url=annotation_image_data_url,
            budget=budget,
        )
        return planned.model_copy(
            update={
                "plan": planned.plan.model_copy(
                    update={"questions": ("What clearance must be preserved in millimeters?",)}
                )
            }
        )


class EngineeringReviewReplanner(FakePlanner):
    """Return a safe terminal handoff when reviewer constraints are not executable."""

    async def revise_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        previous_plan: RepairPlan,
        verification: VerificationResult | None,
        human_feedback: str | None,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        del request, context, verification, human_feedback, annotation_image_data_url, budget
        self.revise_calls += 1
        plan = RepairPlan(
            version=previous_plan.version + 1,
            disposition=PlanDisposition.HUMAN_REQUIRED,
            summary="Engineering review required",
            rationale="The requested local sculpting has no controlled CAD operation.",
            steps=(
                RepairStep(
                    id="engineering-review",
                    action=RepairAction.NEEDS_ENGINEERING_REVIEW,
                    reason="A controlled tool cannot express this topology change.",
                    success_criteria=("An engineer supplies a parameterized CAD design.",),
                ),
            ),
        )
        return PlannedRepair(
            plan=plan,
            usage=ModelUsage(
                input_tokens=900,
                output_tokens=180,
                total_tokens=1_080,
                estimated_cost_usd=0.0012,
            ),
        )


class InvalidThenValidPlanner(FakePlanner):
    """Return two paid schema failures before a valid bounded plan."""

    async def create_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        self.create_calls += 1
        if self.create_calls < 3:
            raise PlannerOutputError(
                message="model returned an invalid structured plan",
                usage=ModelUsage(
                    input_tokens=100,
                    output_tokens=20,
                    total_tokens=120,
                    estimated_cost_usd=0.0001,
                ),
            )
        return await super().create_plan(
            request=request,
            context=context,
            annotation_image_data_url=annotation_image_data_url,
            budget=budget,
        )


class InvalidThenValidReplanner(FakePlanner):
    """Return one paid schema failure before a valid revised plan."""

    def __init__(self) -> None:
        super().__init__()
        self.revise_attempts = 0

    async def revise_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        previous_plan: RepairPlan,
        verification: VerificationResult | None,
        human_feedback: str | None,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        self.revise_attempts += 1
        if self.revise_attempts == 1:
            raise PlannerOutputError(
                message="model returned an invalid revised plan",
                usage=ModelUsage(
                    input_tokens=100,
                    output_tokens=20,
                    total_tokens=120,
                    estimated_cost_usd=0.0001,
                ),
            )
        return await super().revise_plan(
            request=request,
            context=context,
            previous_plan=previous_plan,
            verification=verification,
            human_feedback=human_feedback,
            annotation_image_data_url=annotation_image_data_url,
            budget=budget,
        )


class LongErrorPlanner(FakePlanner):
    """Expose bounded timeline behavior for unexpectedly verbose providers."""

    async def create_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        del request, context, annotation_image_data_url, budget
        self.create_calls += 1
        raise ValueError("x" * 10_000)


class FakeGateway:
    """In-memory Tool Gateway that preserves idempotency and revision facts."""

    def __init__(
        self,
        *,
        pending_polls: int = 0,
        fail_once_tool: ToolName | None = None,
    ) -> None:
        self.current_revision = 7
        self.pending_polls = pending_polls
        self.fail_once_tool = fail_once_tool
        self.failed_once = False
        self.invocations: list[ToolInvocation] = []
        self.results_by_key: dict[str, ToolResult] = {}

    async def load_project_context(
        self, request: RepairRequest, *, accept_newer_revision: bool = False
    ) -> ProjectContext:
        if not accept_newer_revision and request.project_revision != self.current_revision:
            raise ValueError("project revision changed")
        return ProjectContext(
            project_id=request.project_id,
            revision=self.current_revision,
            input_hash="a" * 64,
            selected_part_id=request.feedback.part_id,
            project={
                "id": str(request.project_id),
                "revision": self.current_revision,
                "cad_designs": [{"id": "00000000-0000-4000-8000-000000000004"}],
            },
            evidence=(),
            limitations=("Physical validation has not run.",),
        )

    async def load_annotation_image(self, request: RepairRequest) -> str | None:
        del request
        return "data:image/jpeg;base64,dGVzdA=="

    async def execute(self, invocation: ToolInvocation) -> ToolResult:
        existing = self.results_by_key.get(invocation.idempotency_key)
        if existing is not None and existing.outcome != ToolOutcome.PENDING:
            return existing
        self.invocations.append(invocation)
        if self.fail_once_tool == invocation.tool and not self.failed_once:
            self.failed_once = True
            result = ToolResult(
                invocation=invocation,
                outcome=ToolOutcome.FAILED,
                summary="Injected transient tool failure.",
                error_code="injected_transient_failure",
                error_kind=ToolErrorKind.RETRYABLE,
            )
        elif invocation.tool == ToolName.POLL_CAD_EXECUTION and self.pending_polls > 0:
            self.pending_polls -= 1
            result = ToolResult(
                invocation=invocation,
                outcome=ToolOutcome.PENDING,
                summary="CAD execution is still running.",
                output={"project_revision": self.current_revision},
            )
        else:
            if invocation.tool in {
                ToolName.APPLY_DESIGN_CHANGE,
                ToolName.ATTACH_CAD_RESULT,
            }:
                self.current_revision += 1
            output: dict[str, JsonValue] = {"project_revision": self.current_revision}
            if invocation.tool == ToolName.CREATE_CAD_JOB:
                output["cad_job_id"] = str(uuid4())
            elif invocation.tool == ToolName.START_CAD_EXECUTION:
                output["execution_run_id"] = str(uuid4())
            elif invocation.tool == ToolName.POLL_CAD_EXECUTION:
                output["result_sha256"] = "b" * 64
            elif invocation.tool == ToolName.ATTACH_CAD_RESULT:
                output["asset_ids"] = ["00000000-0000-4000-8000-000000000006"]
            elif invocation.tool == ToolName.VERIFY_REVISION:
                output.update(
                    {
                        "verified": True,
                        "asset_ids": ["00000000-0000-4000-8000-000000000006"],
                    }
                )
            result = ToolResult(
                invocation=invocation,
                outcome=ToolOutcome.SUCCEEDED,
                summary=f"{invocation.tool.value} completed.",
                output=output,
                evidence=({"kind": "fake", "tool": invocation.tool.value},),
            )
        self.results_by_key[invocation.idempotency_key] = result
        return result


def repair_request() -> RepairRequest:
    project_id = UUID("00000000-0000-4000-8000-000000000001")
    return RepairRequest(
        client_request_id=UUID("00000000-0000-4000-8000-000000000002"),
        owner_id="test-owner",
        project_id=project_id,
        project_revision=7,
        goal="Increase clearance in the selected enclosure region.",
        feedback=RegionFeedback(
            schema_name="design-feedback-region-v1",
            id=UUID("00000000-0000-4000-8000-000000000005"),
            project_id=project_id,
            project_revision=7,
            part_id=UUID("00000000-0000-4000-8000-000000000003"),
            object_id="part:mesh:0",
            location=FeedbackLocation(
                world=(1, 2, 3),
                local=(1, 2, 3),
                face_index=4,
                normal=(0, 0, 1),
            ),
            view=ViewState(
                mode="manufacturing",
                preset="hero",
                camera_position=(10, -10, 8),
                target=(0, 0, 0),
            ),
            user_feedback="Make this opening wider without changing the locked holes.",
            created_at="2026-09-21T12:00:00+08:00",
            region=RegionShape(
                path=((0.2, 0.2), (0.4, 0.2), (0.5, 0.3), (0.5, 0.5), (0.3, 0.6), (0.2, 0.4)),
                coordinate_system="normalized_viewport",
            ),
            annotation_image_asset_id=UUID("00000000-0000-4000-8000-000000000007"),
        ),
    )


def workflow_setup(
    *,
    planner: FakePlanner | None = None,
    gateway: FakeGateway | None = None,
    budget: RepairBudget | None = None,
) -> tuple[
    RepairGraph,
    RepairWorkflowContext,
    RepairState,
    RunnableConfig,
    FakePlanner,
    FakeGateway,
]:
    resolved_planner = planner or FakePlanner()
    resolved_gateway = gateway or FakeGateway()
    resolved_budget = budget or RepairBudget()
    saver = InMemorySaver()
    graph = build_repair_graph(saver)
    run_id = UUID("00000000-0000-4000-8000-000000000010")
    thread_id = UUID("00000000-0000-4000-8000-000000000011")
    state = initial_repair_state(
        request=repair_request(),
        run_id=run_id,
        thread_id=thread_id,
        budget=resolved_budget,
        created_at=datetime.now(UTC).isoformat(),
    )
    context = RepairWorkflowContext(
        planner=resolved_planner,
        gateway=resolved_gateway,
        budget=resolved_budget,
    )
    config: RunnableConfig = {"configurable": {"thread_id": str(thread_id)}}
    return graph, context, state, config, resolved_planner, resolved_gateway


def test_studio_builder_exposes_the_production_topology_without_runtime_schema() -> None:
    planner, gateway, budget = FakePlanner(), FakeGateway(), RepairBudget()
    context = RepairWorkflowContext(planner=planner, gateway=gateway, budget=budget)
    production = create_repair_graph_builder().compile(name="production")
    studio = create_repair_graph_builder(runtime_context=context).compile(name="studio")

    production_graph = production.get_graph()
    studio_graph = studio.get_graph()
    assert set(studio_graph.nodes) == set(production_graph.nodes)
    assert {(edge.source, edge.target, edge.conditional) for edge in studio_graph.edges} == {
        (edge.source, edge.target, edge.conditional) for edge in production_graph.edges
    }
    assert studio.get_context_jsonschema() is None


def test_plan_policy_rejects_version_step_budget_and_duplicate_ids() -> None:
    plan = FakePlanner._plan(1)
    with pytest.raises(ValueError, match="expected"):
        validate_plan(plan.model_copy(update={"version": 2}), expected_version=1, max_steps=4)
    with pytest.raises(ValueError, match="step budget"):
        validate_plan(plan, expected_version=1, max_steps=0)
    with pytest.raises(ValueError, match="duplicate"):
        validate_plan(
            plan.model_copy(update={"steps": (plan.steps[0], plan.steps[0])}),
            expected_version=1,
            max_steps=4,
        )
    with pytest.raises(ValueError, match="finite numeric"):
        validate_plan(
            plan.model_copy(
                update={
                    "steps": (plan.steps[0].model_copy(update={"parameters": {"width": True}}),)
                }
            ),
            expected_version=1,
            max_steps=4,
        )


@pytest.mark.asyncio
async def test_graph_waits_for_approval_before_any_side_effect() -> None:
    graph, context, state, config, planner, gateway = workflow_setup()

    result = await graph.ainvoke(state, config, context=context)

    assert result["phase"] == RunPhase.WAITING_FOR_APPROVAL.value
    assert result["plan"]["version"] == 1
    assert planner.create_calls == 1
    assert gateway.invocations == []
    assert result["__interrupt__"][0].value["kind"] == "repair_plan_approval"


@pytest.mark.asyncio
async def test_planner_retries_paid_schema_failures_and_accounts_usage() -> None:
    planner = InvalidThenValidPlanner()
    graph, context, state, config, _planner, gateway = workflow_setup(planner=planner)

    result = await graph.ainvoke(state, config, context=context)

    assert result["phase"] == RunPhase.WAITING_FOR_APPROVAL.value
    assert result["plan_attempt_count"] == 3
    assert result["model_input_tokens"] == 1_000
    assert result["model_output_tokens"] == 240
    assert sum(event["kind"] == "planning_retry_scheduled" for event in result["events"]) == 2
    assert gateway.invocations == []


@pytest.mark.asyncio
async def test_planner_failure_message_is_bounded_for_checkpoint_contract() -> None:
    planner = LongErrorPlanner()
    graph, context, state, config, _planner, gateway = workflow_setup(
        planner=planner,
        budget=RepairBudget(max_plan_attempts=1),
    )

    result = await graph.ainvoke(state, config, context=context)

    assert result["phase"] == RunPhase.FAILED.value
    assert len(result["failure"]["message"]) == 2_000
    assert gateway.invocations == []


@pytest.mark.asyncio
async def test_replanner_retries_paid_schema_failure_without_spending_replan_round() -> None:
    planner = InvalidThenValidReplanner()
    graph, context, state, config, _planner, gateway = workflow_setup(planner=planner)
    await graph.ainvoke(state, config, context=context)

    result = await graph.ainvoke(
        Command(resume={"choice": "modify", "feedback": "Keep two millimeters clearance."}),
        config,
        context=context,
    )

    assert result["phase"] == RunPhase.WAITING_FOR_APPROVAL.value
    assert result["plan"]["version"] == 2
    assert result["plan_attempt_count"] == 2
    assert result["replan_count"] == 1
    assert result["model_input_tokens"] == 1_900
    assert result["model_output_tokens"] == 470
    assert planner.revise_attempts == 2
    assert sum(event["kind"] == "replanning_retry_scheduled" for event in result["events"]) == 1
    assert gateway.invocations == []


@pytest.mark.asyncio
async def test_approved_plan_executes_and_verifies_a_new_revision() -> None:
    graph, context, state, config, _planner, gateway = workflow_setup()
    await graph.ainvoke(state, config, context=context)

    result = await graph.ainvoke(Command(resume={"choice": "approve"}), config, context=context)

    assert result["phase"] == RunPhase.SUCCEEDED.value
    assert result["final_revision"] == 9
    assert result["final_asset_ids"] == ["00000000-0000-4000-8000-000000000006"]
    assert [invocation.tool for invocation in gateway.invocations] == [
        ToolName.APPLY_DESIGN_CHANGE,
        ToolName.CREATE_CAD_JOB,
        ToolName.START_CAD_EXECUTION,
        ToolName.POLL_CAD_EXECUTION,
        ToolName.ATTACH_CAD_RESULT,
        ToolName.VERIFY_REVISION,
    ]


@pytest.mark.asyncio
async def test_rejected_plan_finishes_without_tool_calls() -> None:
    graph, context, state, config, _planner, gateway = workflow_setup()
    await graph.ainvoke(state, config, context=context)

    result = await graph.ainvoke(Command(resume={"choice": "reject"}), config, context=context)

    assert result["phase"] == RunPhase.CANCELED.value
    assert gateway.invocations == []


@pytest.mark.asyncio
async def test_human_modification_routes_through_replanner_and_second_approval() -> None:
    graph, context, state, config, planner, gateway = workflow_setup()
    await graph.ainvoke(state, config, context=context)

    revised = await graph.ainvoke(
        Command(resume={"choice": "modify", "feedback": "Keep width below 55 mm."}),
        config,
        context=context,
    )

    assert revised["phase"] == RunPhase.WAITING_FOR_APPROVAL.value
    assert revised["plan"]["version"] == 2
    assert planner.revise_calls == 1
    assert planner.last_human_feedback == "Keep width below 55 mm."
    assert gateway.invocations == []


@pytest.mark.asyncio
async def test_planner_clarification_replans_before_approval() -> None:
    planner = ClarifyingPlanner()
    graph, context, state, config, _planner, gateway = workflow_setup(planner=planner)

    waiting = await graph.ainvoke(state, config, context=context)

    assert waiting["phase"] == RunPhase.WAITING_FOR_CLARIFICATION.value
    assert waiting["__interrupt__"][0].value["kind"] == "planner_clarification"
    assert gateway.invocations == []

    revised = await graph.ainvoke(
        Command(resume={"answers": ["Preserve at least 2.4 mm."]}),
        config,
        context=context,
    )

    assert revised["phase"] == RunPhase.WAITING_FOR_APPROVAL.value
    assert revised["plan"]["version"] == 2
    assert planner.last_human_feedback is not None
    assert "Preserve at least 2.4 mm." in planner.last_human_feedback
    assert gateway.invocations == []


@pytest.mark.asyncio
async def test_human_required_replan_never_enters_executable_approval() -> None:
    planner = EngineeringReviewReplanner()
    graph, context, state, config, _planner, gateway = workflow_setup(planner=planner)
    await graph.ainvoke(state, config, context=context)

    result = await graph.ainvoke(
        Command(resume={"choice": "modify", "feedback": "Sculpt an organic grip."}),
        config,
        context=context,
    )

    assert result["phase"] == RunPhase.FAILED.value
    assert result["failure"]["code"] == "needs_engineering_review"
    assert gateway.invocations == []


@pytest.mark.asyncio
async def test_retryable_tool_failure_replans_instead_of_blind_retry() -> None:
    gateway = FakeGateway(fail_once_tool=ToolName.CREATE_CAD_JOB)
    graph, context, state, config, planner, _gateway = workflow_setup(gateway=gateway)
    await graph.ainvoke(state, config, context=context)

    replanned = await graph.ainvoke(Command(resume={"choice": "approve"}), config, context=context)

    assert replanned["phase"] == RunPhase.WAITING_FOR_APPROVAL.value
    assert replanned["plan"]["version"] == 2
    assert replanned["replan_count"] == 1
    assert planner.revise_calls == 1
    finished = await graph.ainvoke(Command(resume={"choice": "approve"}), config, context=context)
    assert finished["phase"] == RunPhase.SUCCEEDED.value


@pytest.mark.asyncio
async def test_pending_external_tool_pauses_and_resumes_same_operation() -> None:
    gateway = FakeGateway(pending_polls=1)
    graph, context, state, config, _planner, _gateway = workflow_setup(gateway=gateway)
    await graph.ainvoke(state, config, context=context)

    waiting = await graph.ainvoke(Command(resume={"choice": "approve"}), config, context=context)

    assert waiting["phase"] == RunPhase.WAITING_FOR_TOOL.value
    assert waiting["__interrupt__"][0].value["kind"] == "tool_wait"
    finished = await graph.ainvoke(Command(resume={"action": "check"}), config, context=context)
    assert finished["phase"] == RunPhase.SUCCEEDED.value
    poll_keys = [
        invocation.idempotency_key
        for invocation in gateway.invocations
        if invocation.tool == ToolName.POLL_CAD_EXECUTION
    ]
    assert len(poll_keys) == 2
    assert len(set(poll_keys)) == 1


@pytest.mark.asyncio
async def test_tool_budget_exhaustion_is_a_terminal_verified_failure() -> None:
    graph, context, state, config, _planner, gateway = workflow_setup(
        budget=RepairBudget(max_tool_calls=2)
    )
    await graph.ainvoke(state, config, context=context)

    result = await graph.ainvoke(Command(resume={"choice": "approve"}), config, context=context)

    assert result["phase"] == RunPhase.FAILED.value
    assert result["failure"]["code"] == "tool_budget_exhausted"
    assert len(gateway.invocations) == 2


@pytest.mark.asyncio
async def test_model_cost_budget_stops_before_approval_and_side_effects() -> None:
    graph, context, state, config, _planner, gateway = workflow_setup(
        budget=RepairBudget(max_estimated_cost_usd=0.0005)
    )

    result = await graph.ainvoke(state, config, context=context)

    assert result["phase"] == RunPhase.FAILED.value
    assert result["failure"]["code"] == "model_budget_exhausted"
    assert result["model_input_tokens"] == 800
    assert result["model_output_tokens"] == 200
    assert result["estimated_cost_usd"] == 0.001
    assert gateway.invocations == []


@pytest.mark.asyncio
async def test_checkpoint_can_resume_with_a_recompiled_graph() -> None:
    planner, gateway, budget = FakePlanner(), FakeGateway(), RepairBudget()
    saver = InMemorySaver()
    graph = build_repair_graph(saver)
    request = repair_request()
    run_id, thread_id = uuid4(), uuid4()
    state = initial_repair_state(
        request=request,
        run_id=run_id,
        thread_id=thread_id,
        budget=budget,
        created_at=datetime.now(UTC).isoformat(),
    )
    config: RunnableConfig = {"configurable": {"thread_id": str(thread_id)}}
    context = RepairWorkflowContext(planner=planner, gateway=gateway, budget=budget)
    await graph.ainvoke(state, config, context=context)

    recompiled = build_repair_graph(saver)
    result = await recompiled.ainvoke(
        Command(resume={"choice": "approve"}), config, context=context
    )

    assert result["phase"] == RunPhase.SUCCEEDED.value
    assert len({item.idempotency_key for item in gateway.invocations}) == 6


def visual_plan(parameters: dict[str, JsonValue]) -> RepairPlan:
    return RepairPlan(
        version=1,
        summary="Raise a selected visual surface.",
        rationale="The selected mesh has an explicit world-space region.",
        steps=(
            RepairStep(
                id="raise-surface",
                action=RepairAction.CHANGE_VISUAL_MESH,
                part_id=UUID("00000000-0000-4000-8000-000000000003"),
                parameters=parameters,
                reason="Raise only the selected surface.",
                success_criteria=("The new asset and revision are verified.",),
            ),
        ),
    )


def test_visual_mesh_plan_builds_a_two_tool_revision_bound_procedure() -> None:
    request = repair_request()
    region = request.feedback
    assert isinstance(region, RegionFeedback)
    request = request.model_copy(
        update={
            "feedback": region.model_copy(
                update={
                    "region": region.region.model_copy(
                        update={
                            "world_path": (
                                (0, 0, 3),
                                (1, 0, 3),
                                (2, 0, 3),
                                (2, 1, 3),
                                (1, 1, 3),
                                (0, 1, 3),
                            )
                        }
                    )
                }
            )
        }
    )
    plan = visual_plan({"operation": "offset", "amount_mm": 2, "falloff_mm": 4, "depth_mm": 5})
    validate_plan(plan, expected_version=1, max_steps=4)
    assert tools_for_step(plan.steps[0]) == (
        ToolName.APPLY_VISUAL_EDIT,
        ToolName.VERIFY_VISUAL_REVISION,
    )
    context = ProjectContext(
        project_id=request.project_id,
        revision=7,
        input_hash="a" * 64,
        selected_part_id=request.feedback.part_id,
        project={},
    )
    run_id = uuid4()
    apply = build_tool_invocation(
        run_id=run_id,
        request=request,
        context=context,
        plan=plan,
        step_index=0,
        tool_index=0,
        prior_results=(),
    )
    feedback = apply.arguments["feedback"]
    assert isinstance(feedback, dict)
    assert feedback["partId"] == str(request.feedback.part_id)
    assert isinstance(feedback["region"], dict)
    assert feedback["region"]["worldPath"] == [
        [0, 0, 3],
        [1, 0, 3],
        [2, 0, 3],
        [2, 1, 3],
        [1, 1, 3],
        [0, 1, 3],
    ]
    applied = ToolResult(
        invocation=apply,
        outcome=ToolOutcome.SUCCEEDED,
        summary="Visual asset archived.",
        output={"project_revision": 8, "asset_ids": [str(uuid4())]},
    )
    verify = build_tool_invocation(
        run_id=run_id,
        request=request,
        context=context,
        plan=plan,
        step_index=0,
        tool_index=1,
        prior_results=(applied,),
    )
    assert verify.expected_revision == 8
    assert verify.arguments["prior_results"]
    result = ToolResult(
        invocation=verify,
        outcome=ToolOutcome.SUCCEEDED,
        summary="Visual asset verified.",
        output={"verified": True, "project_revision": 8, "asset_ids": [str(uuid4())]},
    )
    assert (
        verify_tool_result(
            request=request, plan=plan, step_index=0, tool_index=1, result=result
        ).outcome
        == VerificationOutcome.SUCCEEDED
    )


@pytest.mark.parametrize(
    "parameters",
    [
        {"operation": "sculpt", "amount_mm": 2, "falloff_mm": 4, "depth_mm": 5},
        {"operation": "translate", "amount_mm": 2, "falloff_mm": 4, "depth_mm": 5},
        {"operation": "offset", "amount_mm": 2, "falloff_mm": 4, "depth_mm": 5, "extra": 1},
        {"operation": "offset", "amount_mm": 2, "falloff_mm": 0, "depth_mm": 5},
        {"operation": "offset", "amount_mm": "large", "falloff_mm": 4, "depth_mm": 5},
        {
            "operation": "translate",
            "amount_mm": 2,
            "falloff_mm": 4,
            "depth_mm": 5,
            "direction": [1, 2],
        },
    ],
)
def test_visual_mesh_plan_rejects_unsafe_parameters(parameters: dict[str, JsonValue]) -> None:
    with pytest.raises(ValueError):
        validate_plan(visual_plan(parameters), expected_version=1, max_steps=4)
