"""Versioned HTTP edge for durable engineering repair runs."""

from datetime import datetime
from hmac import compare_digest
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request

from zaowu_agent.api.models import (
    ApprovalRequest,
    ClarificationRequest,
    ContinueRunRequest,
    CreateRunRequest,
    ErrorEnvelope,
    RunStatus,
    RunView,
)
from zaowu_agent.container import get_container
from zaowu_agent.core.context import bind_log_context
from zaowu_agent.core.errors import ServiceError
from zaowu_agent.domain.repair import (
    ApprovalDecision,
    ClarificationResponse,
    RepairRequest,
    RunPhase,
)
from zaowu_agent.services.repair_runs import (
    RepairRunConflictError,
    RepairRunNotFoundError,
    RepairRunService,
)
from zaowu_agent.workflow.state import RepairState

router = APIRouter(prefix="/v1/runs", tags=["runs"])


def _authorized_service(request: Request) -> tuple[str, RepairRunService]:
    container = get_container(request)
    if container.repair_runs is None or container.settings.service_token is None:
        raise ServiceError(
            code="repair_workflow_not_configured",
            message="The repair workflow dependencies are not configured.",
            status_code=503,
            retryable=False,
        )
    authorization = request.headers.get("Authorization", "")
    expected = f"Bearer {container.settings.service_token.get_secret_value()}"
    if not compare_digest(authorization, expected):
        raise ServiceError(
            code="agent_service_unauthorized",
            message="The Agent service credential is missing or invalid.",
            status_code=401,
            retryable=False,
        )
    owner_id = request.headers.get("X-Zaowu-Owner-Id", "")
    if not owner_id or len(owner_id) > 256 or any(ord(character) < 32 for character in owner_id):
        raise ServiceError(
            code="owner_identity_invalid",
            message="A valid product owner identity is required.",
            status_code=401,
            retryable=False,
        )
    return owner_id, container.repair_runs


def _not_found() -> ServiceError:
    return ServiceError(
        code="repair_run_not_found",
        message="The repair run does not exist.",
        status_code=404,
        retryable=False,
    )


def _conflict(error: RepairRunConflictError) -> ServiceError:
    return ServiceError(
        code="repair_run_state_conflict",
        message=str(error),
        status_code=409,
        retryable=False,
    )


def _run_view(state: RepairState) -> RunView:
    request = RepairRequest.model_validate(state["request"])
    context = state["context"] or {}
    current_revision = context.get("revision", request.project_revision)
    if not isinstance(current_revision, int) or isinstance(current_revision, bool):
        current_revision = request.project_revision
    pending_action: Literal["clarification", "approval", "tool_wait"] | None = None
    if state["phase"] == RunPhase.WAITING_FOR_CLARIFICATION.value:
        pending_action = "clarification"
    elif state["phase"] == RunPhase.WAITING_FOR_APPROVAL.value:
        pending_action = "approval"
    elif state["phase"] == RunPhase.WAITING_FOR_TOOL.value:
        pending_action = "tool_wait"
    return RunView(
        run_id=UUID(state["run_id"]),
        thread_id=UUID(state["thread_id"]),
        status=RunStatus(state["phase"]),
        project_id=request.project_id,
        project_revision=request.project_revision,
        current_revision=state["final_revision"] or current_revision,
        plan=state["plan"],
        events=tuple(state["events"]),
        pending_action=pending_action,
        failure=state["failure"],
        final_asset_ids=tuple(UUID(asset_id) for asset_id in state["final_asset_ids"]),
        tool_call_count=state["tool_call_count"],
        replan_count=state["replan_count"],
        model_input_tokens=state.get("model_input_tokens", 0),
        model_output_tokens=state.get("model_output_tokens", 0),
        estimated_cost_usd=state.get("estimated_cost_usd", 0.0),
        created_at=datetime.fromisoformat(state["started_at"]),
        updated_at=datetime.fromisoformat(state["updated_at"]),
    )


@router.post(
    "",
    response_model=RunView,
    status_code=202,
    responses={
        401: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
async def create_run(body: CreateRunRequest, request: Request) -> RunView:
    """Create or return one idempotent durable repair run."""
    owner_id, service = _authorized_service(request)
    domain_request = RepairRequest.model_validate(
        {
            **body.model_dump(mode="json", exclude={"feedback"}),
            "owner_id": owner_id,
            "feedback": body.feedback.model_dump(mode="json"),
        }
    )
    run_id = service.run_id_for(domain_request)
    try:
        with bind_log_context(run_id=str(run_id), thread_id=str(run_id)):
            state = await service.create(domain_request)
    except RepairRunConflictError as error:
        raise _conflict(error) from error
    return _run_view(state)


@router.get(
    "/{run_id}",
    response_model=RunView,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
async def get_run(run_id: UUID, request: Request) -> RunView:
    """Read the latest checkpoint-derived run view."""
    owner_id, service = _authorized_service(request)
    try:
        with bind_log_context(run_id=str(run_id), thread_id=str(run_id)):
            state = await service.get(owner_id=owner_id, run_id=run_id)
    except RepairRunNotFoundError as error:
        raise _not_found() from error
    return _run_view(state)


@router.post(
    "/{run_id}/decisions",
    response_model=RunView,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
async def decide_run(run_id: UUID, body: ApprovalRequest, request: Request) -> RunView:
    """Resume the approval interrupt with a validated human decision."""
    owner_id, service = _authorized_service(request)
    decision = ApprovalDecision.model_validate(body.model_dump(mode="json"))
    try:
        with bind_log_context(run_id=str(run_id), thread_id=str(run_id)):
            state = await service.decide(
                owner_id=owner_id,
                run_id=run_id,
                decision=decision,
            )
    except RepairRunNotFoundError as error:
        raise _not_found() from error
    except RepairRunConflictError as error:
        raise _conflict(error) from error
    return _run_view(state)


@router.post(
    "/{run_id}/clarifications",
    response_model=RunView,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
async def clarify_run(run_id: UUID, body: ClarificationRequest, request: Request) -> RunView:
    """Resume a planner clarification interrupt with ordered human answers."""
    owner_id, service = _authorized_service(request)
    response = ClarificationResponse.model_validate(body.model_dump(mode="json"))
    try:
        with bind_log_context(run_id=str(run_id), thread_id=str(run_id)):
            state = await service.clarify(
                owner_id=owner_id,
                run_id=run_id,
                response=response,
            )
    except RepairRunNotFoundError as error:
        raise _not_found() from error
    except RepairRunConflictError as error:
        raise _conflict(error) from error
    return _run_view(state)


@router.post(
    "/{run_id}/continue",
    response_model=RunView,
    responses={
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
async def continue_run(run_id: UUID, _body: ContinueRunRequest, request: Request) -> RunView:
    """Resume a tool-wait interrupt to check the same idempotent operation."""
    owner_id, service = _authorized_service(request)
    try:
        with bind_log_context(run_id=str(run_id), thread_id=str(run_id)):
            state = await service.continue_tool_wait(owner_id=owner_id, run_id=run_id)
    except RepairRunNotFoundError as error:
        raise _not_found() from error
    except RepairRunConflictError as error:
        raise _conflict(error) from error
    return _run_view(state)
