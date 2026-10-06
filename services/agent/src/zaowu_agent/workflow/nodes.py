"""Single-responsibility nodes for the Planner-Executor-Verifier-Replanner graph."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from langgraph.runtime import Runtime
from langgraph.types import interrupt

from zaowu_agent.domain.repair import (
    ApprovalChoice,
    ApprovalDecision,
    ClarificationResponse,
    JsonValue,
    PlanDisposition,
    ProjectContext,
    RepairBudget,
    RepairPlan,
    RepairRequest,
    RunPhase,
    TimelineEvent,
    ToolErrorKind,
    ToolOutcome,
    ToolResult,
    VerificationOutcome,
    VerificationResult,
)
from zaowu_agent.ports.repair import PlannerOutputError, ToolGatewayError
from zaowu_agent.workflow.execution import (
    build_tool_invocation,
    tools_for_step,
    validate_plan,
    verify_tool_result,
)
from zaowu_agent.workflow.state import RepairState, RepairWorkflowContext, SerializedModel

NodeUpdate = dict[str, object]
_MAX_MESSAGE_LENGTH = 2_000


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _event(
    state: RepairState,
    *,
    phase: RunPhase,
    kind: str,
    message: str,
    details: dict[str, JsonValue] | None = None,
) -> list[SerializedModel]:
    event = TimelineEvent(
        sequence=len(state["events"]),
        phase=phase,
        kind=kind,
        message=message[:_MAX_MESSAGE_LENGTH],
        created_at=_now(),
        details=details or {},
    )
    return [event.model_dump(mode="json")]


def _failure(code: str, message: str, *, retryable: bool = False) -> SerializedModel:
    return {
        "code": code,
        "message": message[:_MAX_MESSAGE_LENGTH],
        "retryable": retryable,
    }


def _error_message(error: Exception, fallback: str) -> str:
    message = str(error).strip() or fallback
    return message[:_MAX_MESSAGE_LENGTH]


def _request(state: RepairState) -> RepairRequest:
    return RepairRequest.model_validate(state["request"])


def _budget(state: RepairState) -> RepairBudget:
    return RepairBudget.model_validate(state["budget"])


def _context(state: RepairState) -> ProjectContext:
    if state["context"] is None:
        raise RuntimeError("repair context is not loaded")
    return ProjectContext.model_validate(state["context"])


def _plan(state: RepairState) -> RepairPlan:
    if state["plan"] is None:
        raise RuntimeError("repair plan is not available")
    return RepairPlan.model_validate(state["plan"])


def _tool_results(state: RepairState) -> list[ToolResult]:
    return [ToolResult.model_validate(item) for item in state["tool_results"]]


def _usage_update(
    state: RepairState, input_tokens: int, output_tokens: int, cost: float
) -> dict[str, int | float]:
    return {
        "model_input_tokens": state.get("model_input_tokens", 0) + input_tokens,
        "model_output_tokens": state.get("model_output_tokens", 0) + output_tokens,
        "estimated_cost_usd": round(state.get("estimated_cost_usd", 0.0) + cost, 8),
    }


def _model_budget_exceeded(usage: dict[str, int | float], budget: RepairBudget) -> bool:
    tokens = int(usage["model_input_tokens"]) + int(usage["model_output_tokens"])
    return (
        tokens > budget.max_model_tokens
        or float(usage["estimated_cost_usd"]) > budget.max_estimated_cost_usd
    )


def _run_age_exceeded(state: RepairState, budget: RepairBudget) -> bool:
    started_at = datetime.fromisoformat(state["started_at"])
    return (datetime.now(UTC) - started_at).total_seconds() > budget.max_run_age_seconds


async def load_context_node(
    state: RepairState, runtime: Runtime[RepairWorkflowContext]
) -> NodeUpdate:
    """Load a revision-bound project snapshot through the Tool Gateway."""
    request = _request(state)
    try:
        context = await runtime.context.gateway.load_project_context(request)
    except Exception as error:
        message = str(error) or "Project context could not be loaded."
        return {
            "phase": RunPhase.FAILED.value,
            "failure": _failure("project_context_unavailable", message, retryable=True),
            "updated_at": _now(),
            "events": _event(
                state,
                phase=RunPhase.FAILED,
                kind="context_load_failed",
                message=message,
            ),
        }
    if context.project_id != request.project_id or context.revision != request.project_revision:
        message = "Tool Gateway returned a project context for a different revision."
        return {
            "phase": RunPhase.FAILED.value,
            "failure": _failure("project_context_mismatch", message),
            "updated_at": _now(),
            "events": _event(
                state,
                phase=RunPhase.FAILED,
                kind="context_rejected",
                message=message,
            ),
        }
    return {
        "phase": RunPhase.PLANNING.value,
        "context": context.model_dump(mode="json"),
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.LOADING_CONTEXT,
            kind="context_loaded",
            message="Revision-bound project context loaded from the Tool Gateway.",
            details={"project_revision": context.revision},
        ),
    }


async def planner_node(state: RepairState, runtime: Runtime[RepairWorkflowContext]) -> NodeUpdate:
    """Create a bounded structured plan without performing side effects."""
    request, context, budget = _request(state), _context(state), _budget(state)
    try:
        image = await runtime.context.gateway.load_annotation_image(request)
        planned = await runtime.context.planner.create_plan(
            request=request,
            context=context,
            annotation_image_data_url=image,
            budget=budget,
        )
    except Exception as error:
        message = _error_message(error, "Planner could not produce a valid repair plan.")
        attempt_count = state["plan_attempt_count"] + 1
        usage = (
            _usage_update(
                state,
                error.usage.input_tokens,
                error.usage.output_tokens,
                error.usage.estimated_cost_usd,
            )
            if isinstance(error, PlannerOutputError)
            else {}
        )
        exhausted = (
            attempt_count >= budget.max_plan_attempts
            or _run_age_exceeded(state, budget)
            or (bool(usage) and _model_budget_exceeded(usage, budget))
        )
        phase = RunPhase.FAILED if exhausted else RunPhase.PLANNING
        return {
            **usage,
            "phase": phase.value,
            "failure": (
                _failure("planning_failed", message, retryable=False) if exhausted else None
            ),
            "plan_attempt_count": attempt_count,
            "updated_at": _now(),
            "events": _event(
                state,
                phase=phase,
                kind="planning_failed" if exhausted else "planning_retry_scheduled",
                message=(
                    message if exhausted else "Planner output was invalid; retrying within budget."
                ),
                details={"attempt": attempt_count, "max_attempts": budget.max_plan_attempts},
            ),
        }
    plan = planned.plan
    usage = _usage_update(
        state,
        planned.usage.input_tokens,
        planned.usage.output_tokens,
        planned.usage.estimated_cost_usd,
    )
    if _model_budget_exceeded(usage, budget):
        message = "The repair run exhausted its model token or estimated-cost budget."
        return {
            **usage,
            "phase": RunPhase.FAILED.value,
            "failure": _failure("model_budget_exhausted", message),
            "plan_attempt_count": state["plan_attempt_count"] + 1,
            "updated_at": _now(),
            "events": _event(
                state, phase=RunPhase.FAILED, kind="model_budget_exhausted", message=message
            ),
        }
    try:
        validate_plan(
            plan,
            expected_version=1,
            max_steps=budget.max_plan_steps,
            request=request,
            context=context,
        )
    except ValueError as error:
        message = _error_message(error, "Planner returned a plan rejected by policy.")
        attempt_count = state["plan_attempt_count"] + 1
        exhausted = (
            attempt_count >= budget.max_plan_attempts
            or _run_age_exceeded(state, budget)
            or _model_budget_exceeded(usage, budget)
        )
        phase = RunPhase.FAILED if exhausted else RunPhase.PLANNING
        return {
            **usage,
            "phase": phase.value,
            "failure": (
                _failure("planning_failed", message, retryable=False) if exhausted else None
            ),
            "plan_attempt_count": attempt_count,
            "updated_at": _now(),
            "events": _event(
                state,
                phase=phase,
                kind="planning_failed" if exhausted else "planning_retry_scheduled",
                message=(
                    message
                    if exhausted
                    else "Planner plan failed policy validation; retrying within budget."
                ),
                details={"attempt": attempt_count, "max_attempts": budget.max_plan_attempts},
            ),
        }
    if plan.disposition == PlanDisposition.HUMAN_REQUIRED:
        if plan.questions:
            return {
                **usage,
                "phase": RunPhase.WAITING_FOR_CLARIFICATION.value,
                "plan": plan.model_dump(mode="json"),
                "plan_attempt_count": state["plan_attempt_count"] + 1,
                "clarification_feedback": None,
                "updated_at": _now(),
                "events": _event(
                    state,
                    phase=RunPhase.WAITING_FOR_CLARIFICATION,
                    kind="clarification_requested",
                    message="Planner needs user facts before it can select a safe tool path.",
                    details={"question_count": len(plan.questions)},
                ),
            }
        message = "The requested geometry change has no safe executable tool path."
        return {
            **usage,
            "phase": RunPhase.FAILED.value,
            "plan": plan.model_dump(mode="json"),
            "failure": _failure("needs_engineering_review", message),
            "plan_attempt_count": state["plan_attempt_count"] + 1,
            "updated_at": _now(),
            "events": _event(
                state,
                phase=RunPhase.FAILED,
                kind="engineering_review_required",
                message=message,
                details={"plan_version": plan.version},
            ),
        }
    if plan.questions:
        return {
            **usage,
            "phase": RunPhase.WAITING_FOR_CLARIFICATION.value,
            "plan": plan.model_dump(mode="json"),
            "plan_attempt_count": state["plan_attempt_count"] + 1,
            "clarification_feedback": None,
            "updated_at": _now(),
            "events": _event(
                state,
                phase=RunPhase.WAITING_FOR_CLARIFICATION,
                kind="clarification_requested",
                message="Planner needs user facts before the plan can be approved.",
                details={"question_count": len(plan.questions)},
            ),
        }
    return {
        **usage,
        "phase": RunPhase.WAITING_FOR_APPROVAL.value,
        "plan": plan.model_dump(mode="json"),
        "plan_attempt_count": state["plan_attempt_count"] + 1,
        "approval_feedback": None,
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.WAITING_FOR_APPROVAL,
            kind="plan_ready",
            message="Planner produced a structured repair plan for human review.",
            details={"plan_version": plan.version, "step_count": len(plan.steps)},
        ),
    }


def clarification_node(state: RepairState) -> NodeUpdate:
    """Pause for ordered answers, then send those facts through the Replanner."""
    plan = _plan(state)
    raw_response = interrupt(
        {
            "kind": "planner_clarification",
            "run_id": state["run_id"],
            "questions": list(plan.questions),
            "message": "Answer every question before the Agent produces a revised plan.",
        }
    )
    response = ClarificationResponse.model_validate(raw_response)
    if len(response.answers) != len(plan.questions):
        raise ValueError("clarification answer count does not match planner questions")
    feedback = "\n".join(
        f"Question {index + 1}: {question}\nAnswer {index + 1}: {answer}"
        for index, (question, answer) in enumerate(
            zip(plan.questions, response.answers, strict=True)
        )
    )
    return {
        "phase": RunPhase.REPLANNING.value,
        "plan_attempt_count": 0,
        "clarification_feedback": feedback,
        "approval_feedback": None,
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.REPLANNING,
            kind="clarification_received",
            message="Clarification answers received; the Replanner will revise the plan.",
            details={"answer_count": len(response.answers)},
        ),
    }


def approval_node(state: RepairState) -> NodeUpdate:
    """Pause before side effects and validate the human resume value."""
    plan = _plan(state)
    raw_decision = interrupt(
        {
            "kind": "repair_plan_approval",
            "run_id": state["run_id"],
            "plan": plan.model_dump(mode="json"),
            "message": "Approve, reject, or request changes before engineering tools run.",
        }
    )
    decision = ApprovalDecision.model_validate(raw_decision)
    if decision.choice == ApprovalChoice.APPROVE:
        phase = RunPhase.EXECUTING
        kind = "plan_approved"
        message = "Human approval received; execution may begin."
    elif decision.choice == ApprovalChoice.MODIFY:
        phase = RunPhase.REPLANNING
        kind = "plan_change_requested"
        message = "Human feedback requires a revised plan before execution."
    else:
        phase = RunPhase.CANCELED
        kind = "plan_rejected"
        message = "Repair run canceled by the reviewer before side effects."
    return {
        "phase": phase.value,
        **({"plan_attempt_count": 0} if phase == RunPhase.REPLANNING else {}),
        "approval_feedback": decision.feedback,
        "clarification_feedback": None,
        "updated_at": _now(),
        "events": _event(state, phase=phase, kind=kind, message=message),
    }


async def executor_node(state: RepairState, runtime: Runtime[RepairWorkflowContext]) -> NodeUpdate:
    """Execute exactly one idempotent low-level tool operation."""
    request, context, plan, budget = (
        _request(state),
        _context(state),
        _plan(state),
        _budget(state),
    )
    prior_results = _tool_results(state)
    invocation = build_tool_invocation(
        run_id=UUID(state["run_id"]),
        request=request,
        context=context,
        plan=plan,
        step_index=state["step_index"],
        tool_index=state["tool_index"],
        prior_results=prior_results,
    )
    if _run_age_exceeded(state, budget):
        result = ToolResult(
            invocation=invocation,
            outcome=ToolOutcome.FAILED,
            summary="The repair run exceeded its maximum checkpoint-to-completion age.",
            error_code="run_age_budget_exhausted",
            error_kind=ToolErrorKind.NON_RETRYABLE,
        )
    elif state["tool_call_count"] >= budget.max_tool_calls:
        result = ToolResult(
            invocation=invocation,
            outcome=ToolOutcome.FAILED,
            summary="The run exhausted its tool-call budget before completion.",
            error_code="tool_budget_exhausted",
            error_kind=ToolErrorKind.NON_RETRYABLE,
        )
    else:
        try:
            result = await runtime.context.gateway.execute(invocation)
            if result.invocation != invocation:
                raise ValueError("Tool Gateway returned a result for a different invocation.")
        except ToolGatewayError as error:
            result = ToolResult(
                invocation=invocation,
                outcome=ToolOutcome.FAILED,
                summary=error.message,
                error_code=error.code,
                error_kind=error.kind,
            )
        except Exception as error:
            result = ToolResult(
                invocation=invocation,
                outcome=ToolOutcome.FAILED,
                summary=str(error) or "Tool Gateway call failed.",
                error_code="tool_gateway_call_failed",
                error_kind=ToolErrorKind.RETRYABLE,
            )
    serialized = result.model_dump(mode="json")
    return {
        "phase": RunPhase.VERIFYING.value,
        "last_tool_result": serialized,
        "tool_results": [*state["tool_results"], serialized],
        "tool_call_count": state["tool_call_count"] + 1,
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.EXECUTING,
            kind="tool_result_received",
            message=result.summary,
            details={
                "tool": invocation.tool.value,
                "outcome": result.outcome.value,
                "idempotency_key": invocation.idempotency_key,
            },
        ),
    }


def verifier_node(state: RepairState) -> NodeUpdate:
    """Evaluate tool evidence and select continue, wait, replan, or termination."""
    if state["last_tool_result"] is None:
        raise RuntimeError("verifier requires a tool result")
    request, plan = _request(state), _plan(state)
    result = ToolResult.model_validate(state["last_tool_result"])
    verification = verify_tool_result(
        request=request,
        plan=plan,
        step_index=state["step_index"],
        tool_index=state["tool_index"],
        result=result,
    )
    phase = {
        VerificationOutcome.CONTINUE: RunPhase.EXECUTING,
        VerificationOutcome.WAIT: RunPhase.WAITING_FOR_TOOL,
        VerificationOutcome.REPLAN: RunPhase.REPLANNING,
        VerificationOutcome.SUCCEEDED: RunPhase.SUCCEEDED,
        VerificationOutcome.FAILED: RunPhase.FAILED,
    }[verification.outcome]
    update: NodeUpdate = {
        "phase": phase.value,
        "verification": verification.model_dump(mode="json"),
        "updated_at": _now(),
        "events": _event(
            state,
            phase=phase,
            kind="tool_result_verified",
            message=verification.summary,
            details={"outcome": verification.outcome.value},
        ),
    }
    if verification.outcome == VerificationOutcome.CONTINUE:
        tools = tools_for_step(plan.steps[state["step_index"]])
        if state["tool_index"] + 1 < len(tools):
            update["tool_index"] = state["tool_index"] + 1
        else:
            update["step_index"] = state["step_index"] + 1
            update["tool_index"] = 0
    elif verification.outcome == VerificationOutcome.SUCCEEDED:
        revision = result.output.get("project_revision")
        assets = result.output.get("asset_ids")
        update["final_revision"] = revision if isinstance(revision, int) else None
        update["final_asset_ids"] = (
            [str(asset_id) for asset_id in assets] if isinstance(assets, list) else []
        )
    elif verification.outcome == VerificationOutcome.FAILED:
        update["failure"] = _failure(
            verification.failure_code or "repair_failed", verification.summary
        )
    elif verification.outcome == VerificationOutcome.REPLAN:
        update["plan_attempt_count"] = 0
    return update


async def replanner_node(state: RepairState, runtime: Runtime[RepairWorkflowContext]) -> NodeUpdate:
    """Revise the plan using verified failure facts or reviewer feedback."""
    request, previous_plan, budget = _request(state), _plan(state), _budget(state)
    if (
        state["replan_count"] >= budget.max_replans
        or state["plan_attempt_count"] >= budget.max_plan_attempts
        or _run_age_exceeded(state, budget)
    ):
        message = "The repair run exhausted its replanning budget."
        return {
            "phase": RunPhase.FAILED.value,
            "failure": _failure("replan_budget_exhausted", message),
            "updated_at": _now(),
            "events": _event(
                state,
                phase=RunPhase.FAILED,
                kind="replan_budget_exhausted",
                message=message,
            ),
        }
    verification = (
        VerificationResult.model_validate(state["verification"])
        if state["verification"] is not None
        else None
    )
    try:
        context = await runtime.context.gateway.load_project_context(
            request, accept_newer_revision=True
        )
        image = await runtime.context.gateway.load_annotation_image(request)
        planned = await runtime.context.planner.revise_plan(
            request=request,
            context=context,
            previous_plan=previous_plan,
            verification=verification,
            human_feedback=state["approval_feedback"] or state.get("clarification_feedback"),
            annotation_image_data_url=image,
            budget=budget,
        )
    except Exception as error:
        message = _error_message(error, "Replanner could not produce a valid repair plan.")
        attempt_count = state["plan_attempt_count"] + 1
        usage = (
            _usage_update(
                state,
                error.usage.input_tokens,
                error.usage.output_tokens,
                error.usage.estimated_cost_usd,
            )
            if isinstance(error, PlannerOutputError)
            else {}
        )
        exhausted = (
            attempt_count >= budget.max_plan_attempts
            or _run_age_exceeded(state, budget)
            or (bool(usage) and _model_budget_exceeded(usage, budget))
        )
        phase = RunPhase.FAILED if exhausted else RunPhase.REPLANNING
        return {
            **usage,
            "phase": phase.value,
            "failure": (
                _failure("replanning_failed", message, retryable=False) if exhausted else None
            ),
            "plan_attempt_count": attempt_count,
            "updated_at": _now(),
            "events": _event(
                state,
                phase=phase,
                kind="replanning_failed" if exhausted else "replanning_retry_scheduled",
                message=(
                    message
                    if exhausted
                    else "Replanner output was invalid; retrying within budget."
                ),
                details={"attempt": attempt_count, "max_attempts": budget.max_plan_attempts},
            ),
        }
    plan = planned.plan
    usage = _usage_update(
        state,
        planned.usage.input_tokens,
        planned.usage.output_tokens,
        planned.usage.estimated_cost_usd,
    )
    if _model_budget_exceeded(usage, budget):
        message = "The repair run exhausted its model token or estimated-cost budget."
        return {
            **usage,
            "phase": RunPhase.FAILED.value,
            "failure": _failure("model_budget_exhausted", message),
            "plan_attempt_count": state["plan_attempt_count"] + 1,
            "replan_count": state["replan_count"] + 1,
            "updated_at": _now(),
            "events": _event(
                state, phase=RunPhase.FAILED, kind="model_budget_exhausted", message=message
            ),
        }
    try:
        validate_plan(
            plan,
            expected_version=previous_plan.version + 1,
            max_steps=budget.max_plan_steps,
            request=request,
            context=context,
        )
    except ValueError as error:
        message = _error_message(error, "Replanner returned a plan rejected by policy.")
        attempt_count = state["plan_attempt_count"] + 1
        exhausted = (
            attempt_count >= budget.max_plan_attempts
            or _run_age_exceeded(state, budget)
            or _model_budget_exceeded(usage, budget)
        )
        phase = RunPhase.FAILED if exhausted else RunPhase.REPLANNING
        return {
            **usage,
            "phase": phase.value,
            "failure": (
                _failure("replanning_failed", message, retryable=False) if exhausted else None
            ),
            "plan_attempt_count": attempt_count,
            "updated_at": _now(),
            "events": _event(
                state,
                phase=phase,
                kind="replanning_failed" if exhausted else "replanning_retry_scheduled",
                message=(
                    message
                    if exhausted
                    else "Replanner plan failed policy validation; retrying within budget."
                ),
                details={"attempt": attempt_count, "max_attempts": budget.max_plan_attempts},
            ),
        }
    if plan.questions:
        return {
            **usage,
            "phase": RunPhase.WAITING_FOR_CLARIFICATION.value,
            "context": context.model_dump(mode="json"),
            "plan": plan.model_dump(mode="json"),
            "step_index": 0,
            "tool_index": 0,
            "last_tool_result": None,
            "verification": None,
            "approval_feedback": None,
            "clarification_feedback": None,
            "plan_attempt_count": state["plan_attempt_count"] + 1,
            "replan_count": state["replan_count"] + 1,
            "updated_at": _now(),
            "events": _event(
                state,
                phase=RunPhase.WAITING_FOR_CLARIFICATION,
                kind="clarification_requested",
                message="Replanner needs additional user facts before approval.",
                details={"plan_version": plan.version, "question_count": len(plan.questions)},
            ),
        }
    if plan.disposition == PlanDisposition.HUMAN_REQUIRED:
        message = "The revised request still has no safe executable tool path."
        return {
            **usage,
            "phase": RunPhase.FAILED.value,
            "context": context.model_dump(mode="json"),
            "plan": plan.model_dump(mode="json"),
            "failure": _failure("needs_engineering_review", message),
            "plan_attempt_count": state["plan_attempt_count"] + 1,
            "replan_count": state["replan_count"] + 1,
            "updated_at": _now(),
            "events": _event(
                state,
                phase=RunPhase.FAILED,
                kind="engineering_review_required",
                message=message,
                details={"plan_version": plan.version},
            ),
        }
    return {
        **usage,
        "phase": RunPhase.WAITING_FOR_APPROVAL.value,
        "context": context.model_dump(mode="json"),
        "plan": plan.model_dump(mode="json"),
        "step_index": 0,
        "tool_index": 0,
        "last_tool_result": None,
        "verification": None,
        "approval_feedback": None,
        "clarification_feedback": None,
        "plan_attempt_count": state["plan_attempt_count"] + 1,
        "replan_count": state["replan_count"] + 1,
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.WAITING_FOR_APPROVAL,
            kind="revised_plan_ready",
            message="Replanner produced a new plan that requires approval.",
            details={"plan_version": plan.version, "step_count": len(plan.steps)},
        ),
    }


def tool_wait_node(state: RepairState) -> NodeUpdate:
    """Pause without repeating a side effect until the caller requests a status check."""
    interrupt(
        {
            "kind": "tool_wait",
            "run_id": state["run_id"],
            "message": "The external engineering tool is still running.",
        }
    )
    return {
        "phase": RunPhase.EXECUTING.value,
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.EXECUTING,
            kind="tool_status_check_requested",
            message="The caller requested another idempotent tool status check.",
        ),
    }


def succeeded_node(state: RepairState) -> NodeUpdate:
    """Append the terminal success event."""
    return {
        "phase": RunPhase.SUCCEEDED.value,
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.SUCCEEDED,
            kind="run_succeeded",
            message="Repair workflow completed with a verified new revision.",
            details={"project_revision": state["final_revision"]},
        ),
    }


def failed_node(state: RepairState) -> NodeUpdate:
    """Append the terminal failure event without hiding its classified cause."""
    failure = state["failure"] or _failure("repair_failed", "Repair workflow failed.")
    return {
        "phase": RunPhase.FAILED.value,
        "failure": failure,
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.FAILED,
            kind="run_failed",
            message=str(failure.get("message", "Repair workflow failed.")),
            details={"code": str(failure.get("code", "repair_failed"))},
        ),
    }


def canceled_node(state: RepairState) -> NodeUpdate:
    """Append the terminal cancellation event."""
    return {
        "phase": RunPhase.CANCELED.value,
        "updated_at": _now(),
        "events": _event(
            state,
            phase=RunPhase.CANCELED,
            kind="run_canceled",
            message="Repair workflow ended without executing engineering tools.",
        ),
    }


def route_after_context(state: RepairState) -> Literal["planner", "failed"]:
    return "failed" if state["phase"] == RunPhase.FAILED.value else "planner"


def route_after_planner(
    state: RepairState,
) -> Literal["planner", "clarification", "approval", "failed"]:
    if state["phase"] == RunPhase.PLANNING.value:
        return "planner"
    if state["phase"] == RunPhase.WAITING_FOR_CLARIFICATION.value:
        return "clarification"
    return "failed" if state["phase"] == RunPhase.FAILED.value else "approval"


def route_after_clarification(state: RepairState) -> Literal["replanner"]:
    del state
    return "replanner"


def route_after_approval(
    state: RepairState,
) -> Literal["executor", "replanner", "canceled"]:
    if state["phase"] == RunPhase.EXECUTING.value:
        return "executor"
    if state["phase"] == RunPhase.REPLANNING.value:
        return "replanner"
    return "canceled"


def route_after_verifier(
    state: RepairState,
) -> Literal["executor", "tool_wait", "replanner", "succeeded", "failed"]:
    if state["phase"] == RunPhase.EXECUTING.value:
        return "executor"
    if state["phase"] == RunPhase.WAITING_FOR_TOOL.value:
        return "tool_wait"
    if state["phase"] == RunPhase.REPLANNING.value:
        return "replanner"
    if state["phase"] == RunPhase.SUCCEEDED.value:
        return "succeeded"
    return "failed"


def route_after_replanner(
    state: RepairState,
) -> Literal["replanner", "clarification", "approval", "failed"]:
    if state["phase"] == RunPhase.REPLANNING.value:
        return "replanner"
    if state["phase"] == RunPhase.WAITING_FOR_CLARIFICATION.value:
        return "clarification"
    return "failed" if state["phase"] == RunPhase.FAILED.value else "approval"
