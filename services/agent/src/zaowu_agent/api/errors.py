"""Global translation from service exceptions to the public error envelope."""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from zaowu_agent.api.models import ErrorBody, ErrorDetail, ErrorEnvelope
from zaowu_agent.core.context import get_log_context
from zaowu_agent.core.errors import ServiceError

logger = logging.getLogger(__name__)


def error_response(
    *,
    code: str,
    message: str,
    status_code: int,
    retryable: bool,
    details: tuple[ErrorDetail, ...] = (),
) -> JSONResponse:
    """Build the single error representation used by all handlers."""
    envelope = ErrorEnvelope(
        error=ErrorBody(
            code=code,
            message=message,
            request_id=get_log_context().request_id,
            retryable=retryable,
            details=details,
        )
    )
    return JSONResponse(status_code=status_code, content=envelope.model_dump(mode="json"))


def register_error_handlers(app: FastAPI) -> None:
    """Install exception mapping once at the HTTP edge."""

    @app.exception_handler(ServiceError)
    async def handle_service_error(_request: Request, error: ServiceError) -> JSONResponse:
        return error_response(
            code=error.code,
            message=error.message,
            status_code=error.status_code,
            retryable=error.retryable,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, error: RequestValidationError
    ) -> JSONResponse:
        details = tuple(
            ErrorDetail(
                location=tuple(item["loc"]),
                message=item["msg"],
                type=item["type"],
            )
            for item in error.errors()
        )
        return error_response(
            code="request_validation_failed",
            message="The request does not match the API contract.",
            status_code=422,
            retryable=False,
            details=details,
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(_request: Request, error: HTTPException) -> JSONResponse:
        message = (
            error.detail if isinstance(error.detail, str) else "The request could not be handled."
        )
        return error_response(
            code="http_error",
            message=message,
            status_code=error.status_code,
            retryable=False,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, error: Exception) -> JSONResponse:
        logger.exception("unhandled_service_error", exc_info=error)
        return error_response(
            code="internal_error",
            message="The Agent service encountered an unexpected error.",
            status_code=500,
            retryable=False,
        )
