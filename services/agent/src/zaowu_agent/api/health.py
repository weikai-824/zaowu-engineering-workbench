"""Process and dependency health endpoints."""

from fastapi import APIRouter, Request

from zaowu_agent.api.models import ErrorEnvelope, HealthResponse
from zaowu_agent.container import get_container
from zaowu_agent.core.errors import ServiceError

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", response_model=HealthResponse)
async def liveness(request: Request) -> HealthResponse:
    """Confirm that the HTTP process and configuration are alive."""
    settings = get_container(request).settings
    return HealthResponse(
        status="ok",
        service=settings.service_name,
        version=settings.service_version,
    )


@router.get(
    "/ready",
    response_model=HealthResponse,
    responses={503: {"model": ErrorEnvelope}},
)
async def readiness(request: Request) -> HealthResponse:
    """Confirm that PostgreSQL can serve LangGraph checkpoint operations."""
    container = get_container(request)
    if not await container.checkpoints.is_ready():
        raise ServiceError(
            code="checkpoint_store_unavailable",
            message="PostgreSQL checkpoint storage is not ready.",
            status_code=503,
            retryable=True,
        )
    return HealthResponse(
        status="ok",
        service=container.settings.service_name,
        version=container.settings.service_version,
        checkpoint_store="postgresql",
    )
