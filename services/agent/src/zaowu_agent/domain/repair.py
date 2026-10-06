"""Transport-independent models for the engineering repair workflow."""

from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]
type Vector3 = tuple[float, float, float]
type NormalizedPoint = tuple[float, float]


class DomainModel(BaseModel):
    """Strict immutable base for values stored in graph checkpoints."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_by_name=True,
    )


class ViewState(DomainModel):
    """Camera state captured when the user identified a repair target."""

    mode: Literal["manufacturing", "visual", "compare", "exploded"]
    preset: Literal["hero", "45", "front", "side", "back"]
    camera_position: Vector3 = Field(alias="cameraPosition")
    target: Vector3


class FeedbackLocation(DomainModel):
    """Three-dimensional hit used to anchor a point or region selection."""

    world: Vector3
    local: Vector3
    face_index: int | None = Field(default=None, alias="faceIndex", ge=0)
    normal: Vector3 | None = None


class FeedbackBase(DomainModel):
    """Fields shared by point and region feedback contracts."""

    id: UUID
    project_id: UUID = Field(alias="projectId")
    project_revision: int = Field(alias="projectRevision", ge=1)
    part_id: UUID = Field(alias="partId")
    object_id: str = Field(alias="objectId", min_length=1, max_length=240)
    location: FeedbackLocation
    view: ViewState
    user_feedback: str = Field(alias="userFeedback", min_length=1, max_length=8_000)
    created_at: str = Field(alias="createdAt")


class PointFeedback(FeedbackBase):
    """A single surface hit with user repair instructions."""

    schema_name: Literal["design-feedback-v1"] = Field(alias="schema")


class RegionShape(DomainModel):
    """Normalized viewport polygon drawn around the intended repair region."""

    path: tuple[NormalizedPoint, ...] = Field(min_length=6, max_length=128)
    world_path: tuple[Vector3, ...] | None = Field(
        default=None, alias="worldPath", min_length=6, max_length=128
    )
    coordinate_system: Literal["normalized_viewport"] = Field(alias="coordinateSystem")

    @model_validator(mode="after")
    def validate_normalized_points(self) -> "RegionShape":
        """Reject screen coordinates outside the captured viewport."""
        if any(x < 0 or x > 1 or y < 0 or y > 1 for x, y in self.path):
            raise ValueError("region path coordinates must be normalized between 0 and 1")
        if self.world_path is not None and len(self.world_path) != len(self.path):
            raise ValueError("world-space region path must match the viewport path")
        return self


class RegionFeedback(FeedbackBase):
    """A screen-space region tied to a concrete three-dimensional hit."""

    schema_name: Literal["design-feedback-region-v1"] = Field(alias="schema")
    region: RegionShape
    annotation_image_asset_id: UUID = Field(alias="annotationImageAssetId")


type RepairFeedback = Annotated[
    PointFeedback | RegionFeedback,
    Field(discriminator="schema_name"),
]


class RepairRequest(DomainModel):
    """Immutable user intent that starts one durable repair run."""

    client_request_id: UUID
    owner_id: str = Field(min_length=1, max_length=256)
    project_id: UUID
    project_revision: int = Field(ge=1)
    goal: str = Field(min_length=1, max_length=2_000)
    feedback: RepairFeedback

    @model_validator(mode="after")
    def validate_feedback_binding(self) -> "RepairRequest":
        """Ensure the visual selection belongs to the requested project revision."""
        if self.feedback.project_id != self.project_id:
            raise ValueError("feedback project does not match the repair request")
        if self.feedback.project_revision != self.project_revision:
            raise ValueError("feedback revision does not match the repair request")
        return self


class RepairBudget(DomainModel):
    """Hard limits enforced independently from planner output."""

    max_plan_attempts: int = Field(default=3, ge=1, le=8)
    max_replans: int = Field(default=2, ge=0, le=6)
    max_tool_calls: int = Field(default=18, ge=1, le=64)
    max_plan_steps: int = Field(default=4, ge=1, le=12)
    max_model_tokens: int = Field(default=40_000, ge=1_000, le=1_000_000)
    max_estimated_cost_usd: float = Field(default=2.0, gt=0, le=1_000)
    max_run_age_seconds: int = Field(default=86_400, ge=60, le=604_800)


class RepairAction(StrEnum):
    """High-level actions the planner may request in goal 1."""

    CHANGE_CAD_PARAMETERS = "change_cad_parameters"
    CREATE_CAD_DESIGN = "create_cad_design"
    CHANGE_VISUAL_MESH = "change_visual_mesh"
    NEEDS_ENGINEERING_REVIEW = "needs_engineering_review"


class PlanDisposition(StrEnum):
    """Whether a plan is executable by the current controlled tool set."""

    EXECUTABLE = "executable"
    HUMAN_REQUIRED = "human_required"


class RepairStep(DomainModel):
    """One planner-selected engineering action with explicit success criteria."""

    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    action: RepairAction
    part_id: UUID | None = None
    design_id: UUID | None = None
    parameters: dict[str, JsonValue] = Field(default_factory=dict)
    reason: str = Field(min_length=1, max_length=2_000)
    success_criteria: tuple[str, ...] = Field(min_length=1, max_length=12)


class RepairPlan(DomainModel):
    """Structured output produced by Planner or Replanner."""

    schema_version: Literal[1] = 1
    version: int = Field(ge=1, le=20)
    disposition: PlanDisposition = PlanDisposition.EXECUTABLE
    summary: str = Field(min_length=1, max_length=4_000)
    rationale: str = Field(min_length=1, max_length=4_000)
    steps: tuple[RepairStep, ...] = Field(min_length=1, max_length=12)
    questions: tuple[str, ...] = Field(default=(), max_length=20)
    required_checks: tuple[str, ...] = Field(default=(), max_length=30)
    risk_flags: tuple[str, ...] = Field(default=(), max_length=30)


class ModelUsage(DomainModel):
    """Provider-reported token usage and configuration-derived cost estimate."""

    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    total_tokens: int = Field(ge=1)
    estimated_cost_usd: float = Field(ge=0)


class PlannedRepair(DomainModel):
    """A structured plan plus metering facts from the same model response."""

    plan: RepairPlan
    usage: ModelUsage


class ProjectContext(DomainModel):
    """Sanitized project facts returned by the TypeScript Tool Gateway."""

    project_id: UUID
    revision: int = Field(ge=1)
    input_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    selected_part_id: UUID
    project: dict[str, JsonValue]
    evidence: tuple[dict[str, JsonValue], ...] = ()
    limitations: tuple[str, ...] = ()


class ToolName(StrEnum):
    """Allow-listed deterministic operations used by the executor."""

    APPLY_DESIGN_CHANGE = "apply_design_change"
    CREATE_CAD_JOB = "create_cad_job"
    START_CAD_EXECUTION = "start_cad_execution"
    POLL_CAD_EXECUTION = "poll_cad_execution"
    ATTACH_CAD_RESULT = "attach_cad_result"
    VERIFY_REVISION = "verify_revision"
    APPLY_VISUAL_EDIT = "apply_visual_edit"
    VERIFY_VISUAL_REVISION = "verify_visual_revision"


class ToolOutcome(StrEnum):
    """Normalized outcome independent from HTTP or provider status codes."""

    SUCCEEDED = "succeeded"
    PENDING = "pending"
    FAILED = "failed"


class ToolErrorKind(StrEnum):
    """Failure class used by the verifier and replanner."""

    RETRYABLE = "retryable"
    NON_RETRYABLE = "non_retryable"
    STATE_UNKNOWN = "state_unknown"
    HUMAN_REQUIRED = "human_required"


class ToolInvocation(DomainModel):
    """One idempotent call from the executor to the Tool Gateway."""

    run_id: UUID
    plan_version: int = Field(ge=1)
    step_id: str
    tool_index: int = Field(ge=0)
    tool: ToolName
    idempotency_key: str = Field(min_length=1, max_length=240)
    owner_id: str
    project_id: UUID
    expected_revision: int = Field(ge=1)
    arguments: dict[str, JsonValue]


class ToolResult(DomainModel):
    """Schema-validated result from a Tool Gateway operation."""

    invocation: ToolInvocation
    outcome: ToolOutcome
    summary: str = Field(min_length=1, max_length=2_000)
    output: dict[str, JsonValue] = Field(default_factory=dict)
    evidence: tuple[dict[str, JsonValue], ...] = ()
    error_code: str | None = Field(default=None, max_length=160)
    error_kind: ToolErrorKind | None = None

    @model_validator(mode="after")
    def validate_failure_shape(self) -> "ToolResult":
        """Require a classified code for failures and forbid one on success."""
        if self.outcome == ToolOutcome.FAILED and (
            self.error_code is None or self.error_kind is None
        ):
            raise ValueError("failed tool results require an error code and kind")
        if self.outcome != ToolOutcome.FAILED and (
            self.error_code is not None or self.error_kind is not None
        ):
            raise ValueError("non-failed tool results cannot contain an error classification")
        return self


class VerificationOutcome(StrEnum):
    """Routing decision produced by the deterministic verifier."""

    CONTINUE = "continue"
    WAIT = "wait"
    REPLAN = "replan"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class VerificationResult(DomainModel):
    """Evidence-backed decision about the most recent tool result."""

    outcome: VerificationOutcome
    summary: str = Field(min_length=1, max_length=2_000)
    evidence: tuple[dict[str, JsonValue], ...] = ()
    failure_code: str | None = Field(default=None, max_length=160)


class ApprovalChoice(StrEnum):
    """Actions accepted by the human approval interrupt."""

    APPROVE = "approve"
    REJECT = "reject"
    MODIFY = "modify"


class ApprovalDecision(DomainModel):
    """Validated resume value supplied to the approval interrupt."""

    choice: ApprovalChoice
    feedback: str | None = Field(default=None, max_length=2_000)

    @model_validator(mode="after")
    def require_feedback_for_modification(self) -> "ApprovalDecision":
        """Modification requests must explain what the planner should change."""
        if self.choice == ApprovalChoice.MODIFY and not self.feedback:
            raise ValueError("modification approval requires feedback")
        return self


class ClarificationResponse(DomainModel):
    """Ordered answers used to resume a planner clarification interrupt."""

    answers: tuple[Annotated[str, Field(min_length=1, max_length=4_000)], ...] = Field(
        min_length=1, max_length=20
    )


class RunPhase(StrEnum):
    """Externally visible workflow phase stored in every checkpoint."""

    PENDING = "pending"
    LOADING_CONTEXT = "loading_context"
    PLANNING = "planning"
    WAITING_FOR_CLARIFICATION = "waiting_for_clarification"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    EXECUTING = "executing"
    WAITING_FOR_TOOL = "waiting_for_tool"
    VERIFYING = "verifying"
    REPLANNING = "replanning"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"


class TimelineEvent(DomainModel):
    """Append-only audit event rendered by the future run timeline."""

    sequence: int = Field(ge=0)
    phase: RunPhase
    kind: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=2_000)
    created_at: str
    details: dict[str, JsonValue] = Field(default_factory=dict)
