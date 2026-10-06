"""Dependency inversion boundaries for planning and engineering tools."""

from typing import Protocol

from zaowu_agent.domain.repair import (
    ModelUsage,
    PlannedRepair,
    ProjectContext,
    RepairBudget,
    RepairPlan,
    RepairRequest,
    ToolErrorKind,
    ToolInvocation,
    ToolResult,
    VerificationResult,
)


class PlannerOutputError(ValueError):
    """A paid model response that could not satisfy the structured plan contract."""

    def __init__(self, *, message: str, usage: ModelUsage) -> None:
        super().__init__(message)
        self.usage = usage


class ToolGatewayError(Exception):
    """Classified Tool Gateway failure that preserves orchestration semantics."""

    def __init__(self, *, code: str, message: str, kind: ToolErrorKind) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.kind = kind


class RepairPlanner(Protocol):
    """Create and revise structured repair plans without executing tools."""

    async def create_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        """Return the first bounded plan for a repair request."""

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
        """Return a new plan version using explicit failure or human feedback."""


class RepairToolGateway(Protocol):
    """Only route through which the Agent may access product capabilities."""

    async def load_project_context(
        self, request: RepairRequest, *, accept_newer_revision: bool = False
    ) -> ProjectContext:
        """Read a revision-bound, sanitized project snapshot."""

    async def load_annotation_image(self, request: RepairRequest) -> str | None:
        """Return the selected view as a bounded data URL when one exists."""

    async def execute(self, invocation: ToolInvocation) -> ToolResult:
        """Execute one allow-listed idempotent operation."""
