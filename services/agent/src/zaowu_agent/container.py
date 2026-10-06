"""Explicit application dependencies shared by API routes."""

from dataclasses import dataclass
from typing import cast

from fastapi import Request

from zaowu_agent.core.config import Settings
from zaowu_agent.persistence.checkpoints import CheckpointRuntime
from zaowu_agent.services.repair_runs import RepairRunService


@dataclass(frozen=True, slots=True)
class ServiceContainer:
    """Resources created and closed by the FastAPI lifespan."""

    settings: Settings
    checkpoints: CheckpointRuntime
    repair_runs: RepairRunService | None


def get_container(request: Request) -> ServiceContainer:
    """Return initialized service dependencies for the current request."""
    return cast(ServiceContainer, request.app.state.container)
