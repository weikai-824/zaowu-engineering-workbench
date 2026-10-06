"""Deterministic expansion and verification of planner-selected actions."""

from collections.abc import Sequence
from math import isfinite
from uuid import UUID

from zaowu_agent.domain.repair import (
    PlanDisposition,
    ProjectContext,
    RegionFeedback,
    RepairAction,
    RepairPlan,
    RepairRequest,
    RepairStep,
    ToolErrorKind,
    ToolInvocation,
    ToolName,
    ToolOutcome,
    ToolResult,
    VerificationOutcome,
    VerificationResult,
)

_CAD_REPAIR_SEQUENCE = (
    ToolName.APPLY_DESIGN_CHANGE,
    ToolName.CREATE_CAD_JOB,
    ToolName.START_CAD_EXECUTION,
    ToolName.POLL_CAD_EXECUTION,
    ToolName.ATTACH_CAD_RESULT,
    ToolName.VERIFY_REVISION,
)
_VISUAL_REPAIR_SEQUENCE = (ToolName.APPLY_VISUAL_EDIT, ToolName.VERIFY_VISUAL_REVISION)


def tools_for_step(step: RepairStep) -> tuple[ToolName, ...]:
    """Return the fixed low-level procedure for a high-level repair action."""
    if step.action in {
        RepairAction.CHANGE_CAD_PARAMETERS,
        RepairAction.CREATE_CAD_DESIGN,
    }:
        return _CAD_REPAIR_SEQUENCE
    if step.action == RepairAction.CHANGE_VISUAL_MESH:
        return _VISUAL_REPAIR_SEQUENCE
    return ()


def validate_plan(
    plan: RepairPlan,
    *,
    expected_version: int,
    max_steps: int,
    request: RepairRequest | None = None,
    context: ProjectContext | None = None,
) -> None:
    """Enforce orchestration limits independently from the model schema."""
    if plan.version != expected_version:
        raise ValueError(f"planner returned version {plan.version}, expected {expected_version}")
    if len(plan.steps) > max_steps:
        raise ValueError("planner exceeded the configured step budget")
    if plan.disposition == PlanDisposition.HUMAN_REQUIRED:
        if any(step.action != RepairAction.NEEDS_ENGINEERING_REVIEW for step in plan.steps):
            raise ValueError("human-required plans may only request engineering review")
        return
    if any(not tools_for_step(step) for step in plan.steps):
        raise ValueError("planner selected an action without an executable tool policy")
    if len({step.id for step in plan.steps}) != len(plan.steps):
        raise ValueError("planner returned duplicate step identifiers")
    if any(step.action == RepairAction.CHANGE_VISUAL_MESH for step in plan.steps):
        if len(plan.steps) != 1:
            raise ValueError("a visual mesh region can only be edited once per plan")
        if request is not None and (
            not isinstance(request.feedback, RegionFeedback)
            or request.feedback.region.world_path is None
            or request.feedback.location.normal is None
            or plan.steps[0].part_id != request.feedback.part_id
        ):
            raise ValueError("visual mesh plan requires the selected three-dimensional region")
        if (
            context is not None
            and request is not None
            and (
                context.revision != request.project_revision
                or context.selected_part_id != request.feedback.part_id
            )
        ):
            raise ValueError("visual mesh plan must use the original selected model revision")
    for step in plan.steps:
        if step.action == RepairAction.CHANGE_CAD_PARAMETERS:
            if step.part_id is None or step.design_id is None:
                raise ValueError("CAD parameter changes require part_id and design_id")
            if not step.parameters or any(
                isinstance(value, bool) or not isinstance(value, int | float) or not isfinite(value)
                for value in step.parameters.values()
            ):
                raise ValueError("CAD parameter changes require finite numeric target values")
        elif step.action == RepairAction.CREATE_CAD_DESIGN and (
            set(step.parameters) != {"design_spec"}
            or not isinstance(step.parameters.get("design_spec"), dict)
        ):
            raise ValueError("CAD design creation requires exactly one design_spec object")
        elif step.action == RepairAction.CHANGE_VISUAL_MESH:
            values = step.parameters
            if step.part_id is None or step.design_id is not None:
                raise ValueError("visual mesh edits require part_id and no design_id")
            required = {"operation", "amount_mm", "falloff_mm", "depth_mm"}
            if set(values) not in (required, required | {"direction"}):
                raise ValueError("visual mesh edit parameters are incomplete")
            operation = values.get("operation")
            if not isinstance(operation, str) or operation not in {
                "offset",
                "flatten",
                "translate",
            }:
                raise ValueError("visual mesh operation is unsupported")
            if (operation == "translate") != ("direction" in values):
                raise ValueError("translate requires a direction vector")
            numbers: dict[str, float] = {}
            for key in ("amount_mm", "falloff_mm", "depth_mm"):
                value = values.get(key)
                if isinstance(value, bool) or not isinstance(value, int | float):
                    raise ValueError("visual mesh dimensions must be finite numbers")
                if not isfinite(value):
                    raise ValueError("visual mesh dimensions must be finite numbers")
                numbers[key] = float(value)
            if (
                abs(numbers["amount_mm"]) > 50
                or not 0.1 <= numbers["falloff_mm"] <= 50
                or not 0.1 <= numbers["depth_mm"] <= 100
            ):
                raise ValueError("visual mesh edit exceeds controlled bounds")
            if "direction" in values and (
                not isinstance(values["direction"], list)
                or len(values["direction"]) != 3
                or any(
                    isinstance(component, bool)
                    or not isinstance(component, int | float)
                    or not isfinite(component)
                    for component in values["direction"]
                )
            ):
                raise ValueError("visual mesh direction must be a finite vector")


def _current_revision(context: ProjectContext, results: Sequence[ToolResult]) -> int:
    current = context.revision
    for result in reversed(results):
        revision = result.output.get("project_revision")
        if isinstance(revision, int) and not isinstance(revision, bool) and revision >= 1:
            current = max(current, revision)
    return current


def build_tool_invocation(
    *,
    run_id: UUID,
    request: RepairRequest,
    context: ProjectContext,
    plan: RepairPlan,
    step_index: int,
    tool_index: int,
    prior_results: Sequence[ToolResult],
) -> ToolInvocation:
    """Build one allow-listed call with a stable idempotency key."""
    step = plan.steps[step_index]
    tools = tools_for_step(step)
    tool = tools[tool_index]
    idempotency_key = f"repair:{run_id}:plan:{plan.version}:step:{step.id}:tool:{tool_index}"
    arguments = {
        "action": step.action.value,
        "part_id": str(step.part_id) if step.part_id else None,
        "design_id": str(step.design_id) if step.design_id else None,
        "parameters": step.parameters,
        "success_criteria": list(step.success_criteria),
        "prior_results": [
            {
                "tool": result.invocation.tool.value,
                "outcome": result.outcome.value,
                "output": result.output,
            }
            for result in prior_results
            if result.invocation.plan_version == plan.version
            and result.invocation.step_id == step.id
        ],
    }
    if step.action == RepairAction.CHANGE_VISUAL_MESH:
        arguments["feedback"] = request.feedback.model_dump(mode="json", by_alias=True)
    return ToolInvocation(
        run_id=run_id,
        plan_version=plan.version,
        step_id=step.id,
        tool_index=tool_index,
        tool=tool,
        idempotency_key=idempotency_key,
        owner_id=request.owner_id,
        project_id=request.project_id,
        expected_revision=_current_revision(context, prior_results),
        arguments=arguments,
    )


def verify_tool_result(
    *,
    request: RepairRequest,
    plan: RepairPlan,
    step_index: int,
    tool_index: int,
    result: ToolResult,
) -> VerificationResult:
    """Turn tool facts into an explicit graph routing decision."""
    if result.outcome == ToolOutcome.PENDING:
        return VerificationResult(
            outcome=VerificationOutcome.WAIT,
            summary=result.summary,
            evidence=result.evidence,
        )
    if result.outcome == ToolOutcome.FAILED:
        if result.error_kind == ToolErrorKind.STATE_UNKNOWN:
            return VerificationResult(
                outcome=VerificationOutcome.WAIT,
                summary=(
                    "Tool state is unknown; query the same idempotent operation before retrying."
                ),
                evidence=result.evidence,
                failure_code=result.error_code,
            )
        if result.error_kind == ToolErrorKind.RETRYABLE:
            return VerificationResult(
                outcome=VerificationOutcome.REPLAN,
                summary=result.summary,
                evidence=result.evidence,
                failure_code=result.error_code,
            )
        return VerificationResult(
            outcome=VerificationOutcome.FAILED,
            summary=result.summary,
            evidence=result.evidence,
            failure_code=result.error_code,
        )

    tools = tools_for_step(plan.steps[step_index])
    if result.invocation.tool != tools[tool_index]:
        return VerificationResult(
            outcome=VerificationOutcome.FAILED,
            summary="Tool result does not match the expected execution cursor.",
            failure_code="tool_result_cursor_mismatch",
        )
    if result.invocation.tool not in {ToolName.VERIFY_REVISION, ToolName.VERIFY_VISUAL_REVISION}:
        return VerificationResult(
            outcome=VerificationOutcome.CONTINUE,
            summary=result.summary,
            evidence=result.evidence,
        )

    verified = result.output.get("verified")
    revision = result.output.get("project_revision")
    asset_ids = result.output.get("asset_ids")
    if (
        verified is not True
        or not isinstance(revision, int)
        or isinstance(revision, bool)
        or revision <= request.project_revision
        or not isinstance(asset_ids, list)
        or not asset_ids
        or not all(isinstance(asset_id, str) and asset_id for asset_id in asset_ids)
    ):
        return VerificationResult(
            outcome=VerificationOutcome.REPLAN,
            summary="The produced revision does not satisfy the repair evidence contract.",
            evidence=result.evidence,
            failure_code="repair_verification_failed",
        )
    if step_index + 1 < len(plan.steps):
        return VerificationResult(
            outcome=VerificationOutcome.CONTINUE,
            summary="The current repair step is verified; continue with the next planned step.",
            evidence=result.evidence,
        )
    return VerificationResult(
        outcome=VerificationOutcome.SUCCEEDED,
        summary="The repaired asset and new project revision passed deterministic verification.",
        evidence=result.evidence,
    )
