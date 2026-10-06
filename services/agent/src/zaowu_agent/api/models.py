"""HTTP request and response contracts."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    """Strict base model for public API contracts."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        validate_by_name=True,
    )


class ErrorDetail(ApiModel):
    """One validation issue at a stable field location."""

    location: tuple[str | int, ...]
    message: str
    type: str


class ErrorBody(ApiModel):
    """Machine-readable failure with a support correlation identifier."""

    code: str
    message: str
    request_id: str
    retryable: bool
    details: tuple[ErrorDetail, ...] = ()


class ErrorEnvelope(ApiModel):
    """Uniform error wrapper returned by every endpoint."""

    error: ErrorBody


class ServiceInfo(ApiModel):
    """Identity and maturity of the running service."""

    name: str
    version: str
    environment: str
    agent_graph: str = "not_configured"


class HealthResponse(ApiModel):
    """Liveness or readiness result."""

    status: str
    service: str
    version: str
    checkpoint_store: str | None = None


class FeedbackLocationRequest(ApiModel):
    """Surface hit captured by the three-dimensional viewer."""

    world: tuple[float, float, float]
    local: tuple[float, float, float]
    face_index: int | None = Field(default=None, alias="faceIndex", ge=0)
    normal: tuple[float, float, float] | None = None


class FeedbackViewRequest(ApiModel):
    """Camera state used to interpret a screen-space annotation."""

    mode: Literal["manufacturing", "visual", "compare", "exploded"]
    preset: Literal["hero", "45", "front", "side", "back"]
    camera_position: tuple[float, float, float] = Field(alias="cameraPosition")
    target: tuple[float, float, float]


class FeedbackRegionRequest(ApiModel):
    """Normalized viewport polygon from the annotation overlay."""

    path: tuple[tuple[float, float], ...] = Field(min_length=6, max_length=128)
    world_path: tuple[tuple[float, float, float], ...] | None = Field(
        default=None, alias="worldPath", min_length=6, max_length=128
    )
    coordinate_system: Literal["normalized_viewport"] = Field(alias="coordinateSystem")


class FeedbackRequestBase(ApiModel):
    """Fields common to point and region repair feedback."""

    id: UUID
    project_id: UUID = Field(alias="projectId")
    project_revision: int = Field(alias="projectRevision", ge=1)
    part_id: UUID = Field(alias="partId")
    object_id: str = Field(alias="objectId", min_length=1, max_length=240)
    location: FeedbackLocationRequest
    view: FeedbackViewRequest
    user_feedback: str = Field(alias="userFeedback", min_length=1, max_length=8_000)
    created_at: datetime = Field(alias="createdAt")


class PointFeedbackRequest(FeedbackRequestBase):
    """Point selection accepted by the Agent API."""

    schema_name: Literal["design-feedback-v1"] = Field(alias="schema")


class RegionFeedbackRequest(FeedbackRequestBase):
    """Region selection and its persisted annotated viewport."""

    schema_name: Literal["design-feedback-region-v1"] = Field(alias="schema")
    region: FeedbackRegionRequest
    annotation_image_asset_id: UUID = Field(alias="annotationImageAssetId")


type FeedbackRequest = Annotated[
    PointFeedbackRequest | RegionFeedbackRequest,
    Field(discriminator="schema_name"),
]


class CreateRunRequest(ApiModel):
    """Input boundary for one idempotent durable repair run."""

    client_request_id: UUID
    project_id: UUID
    project_revision: int = Field(ge=1)
    goal: str = Field(min_length=1, max_length=2_000)
    feedback: FeedbackRequest


class RunStatus(StrEnum):
    """Externally visible lifecycle states of the repair state graph."""

    PENDING = "pending"
    LOADING_CONTEXT = "loading_context"
    PLANNING = "planning"
    WAITING_FOR_CLARIFICATION = "waiting_for_clarification"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    EXECUTING = "executing"
    WAITING_FOR_TOOL = "waiting_for_tool"
    VERIFYING = "verifying"
    REPLANNING = "replanning"
    FAILED = "failed"
    CANCELED = "canceled"
    SUCCEEDED = "succeeded"


class RunAccepted(ApiModel):
    """Stable identifiers and phase returned for every repair run."""

    run_id: UUID
    thread_id: UUID
    status: RunStatus
    created_at: datetime


class RunView(RunAccepted):
    """Read model for a durable repair run and its audit timeline."""

    project_id: UUID
    project_revision: int
    current_revision: int
    plan: dict[str, object] | None = None
    events: tuple[dict[str, object], ...] = ()
    pending_action: Literal["clarification", "approval", "tool_wait"] | None = None
    failure: dict[str, object] | None = None
    final_asset_ids: tuple[UUID, ...] = ()
    tool_call_count: int = 0
    replan_count: int = 0
    model_input_tokens: int = 0
    model_output_tokens: int = 0
    estimated_cost_usd: float = 0
    updated_at: datetime


class ApprovalRequest(ApiModel):
    """Human decision used to resume a plan approval interrupt."""

    choice: Literal["approve", "reject", "modify"]
    feedback: str | None = Field(default=None, max_length=2_000)


class ClarificationRequest(ApiModel):
    """Ordered answers used to resume a planner clarification interrupt."""

    answers: tuple[Annotated[str, Field(min_length=1, max_length=4_000)], ...] = Field(
        min_length=1, max_length=20
    )


class ContinueRunRequest(ApiModel):
    """Explicit request to recheck an idempotent external tool operation."""

    action: Literal["check"] = "check"
