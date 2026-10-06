"""HTTP adapter for the allow-listed TypeScript Tool Gateway."""

from hmac import compare_digest
from typing import Any

import httpx
from langsmith import traceable
from pydantic import BaseModel, ConfigDict

from zaowu_agent.domain.repair import (
    ProjectContext,
    RepairRequest,
    ToolErrorKind,
    ToolInvocation,
    ToolResult,
)
from zaowu_agent.ports.repair import ToolGatewayError

_MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024
_MAX_ANNOTATION_DATA_URL_LENGTH = 3 * 1024 * 1024


def _trace_gateway_inputs(inputs: dict[str, Any]) -> dict[str, Any]:
    """Exclude the adapter instance, which owns the service credential."""
    return {key: value for key, value in inputs.items() if key != "self"}


class _GatewayModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _AnnotationResponse(_GatewayModel):
    data_url: str | None


class _GatewayErrorBody(_GatewayModel):
    code: str = "tool_gateway_error"
    message: str
    kind: ToolErrorKind = ToolErrorKind.NON_RETRYABLE


class HttpRepairToolGateway:
    """Call product capabilities without giving the Agent direct D1/R2 access."""

    def __init__(self, *, client: httpx.AsyncClient, base_url: str, token: str) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._token = token

    @traceable(
        name="zaowu_tool_gateway_request",
        run_type="tool",
        process_inputs=_trace_gateway_inputs,
    )
    async def _post(self, *, path: str, owner_id: str, payload: dict[str, object]) -> object:
        response = await self._client.post(
            f"{self._base_url}/{path}",
            headers={
                "Authorization": f"Bearer {self._token}",
                "X-Zaowu-Owner-Id": owner_id,
            },
            json=payload,
        )
        if len(response.content) > _MAX_JSON_RESPONSE_BYTES:
            raise ToolGatewayError(
                code="tool_gateway_response_too_large",
                message="Tool Gateway response exceeded the Agent size limit.",
                kind=ToolErrorKind.NON_RETRYABLE,
            )
        try:
            data: object = response.json()
        except ValueError as error:
            raise ToolGatewayError(
                code="tool_gateway_invalid_json",
                message="Tool Gateway returned invalid JSON.",
                kind=ToolErrorKind.STATE_UNKNOWN
                if response.is_server_error
                else ToolErrorKind.NON_RETRYABLE,
            ) from error
        if response.is_error:
            try:
                parsed = _GatewayErrorBody.model_validate(data)
            except ValueError:
                parsed = _GatewayErrorBody(
                    message=f"Tool Gateway request failed with HTTP {response.status_code}.",
                    kind=(
                        ToolErrorKind.RETRYABLE
                        if response.status_code in {408, 429} or response.is_server_error
                        else ToolErrorKind.NON_RETRYABLE
                    ),
                )
            raise ToolGatewayError(code=parsed.code, message=parsed.message, kind=parsed.kind)
        return data

    async def load_project_context(
        self, request: RepairRequest, *, accept_newer_revision: bool = False
    ) -> ProjectContext:
        """Load a revision-bound project snapshot."""
        data = await self._post(
            path="context",
            owner_id=request.owner_id,
            payload={
                "project_id": str(request.project_id),
                "project_revision": request.project_revision,
                "part_id": str(request.feedback.part_id),
                "accept_newer_revision": accept_newer_revision,
            },
        )
        return ProjectContext.model_validate(data)

    async def load_annotation_image(self, request: RepairRequest) -> str | None:
        """Load the bounded annotated viewport only for region feedback."""
        asset_id = getattr(request.feedback, "annotation_image_asset_id", None)
        if asset_id is None:
            return None
        data = await self._post(
            path="annotation",
            owner_id=request.owner_id,
            payload={
                "project_id": str(request.project_id),
                "project_revision": request.project_revision,
                "asset_id": str(asset_id),
            },
        )
        parsed = _AnnotationResponse.model_validate(data)
        if parsed.data_url and len(parsed.data_url) > _MAX_ANNOTATION_DATA_URL_LENGTH:
            raise ToolGatewayError(
                code="annotation_image_too_large",
                message="Annotated viewport exceeded the Agent image limit.",
                kind=ToolErrorKind.NON_RETRYABLE,
            )
        return parsed.data_url

    async def execute(self, invocation: ToolInvocation) -> ToolResult:
        """Execute one allow-listed operation and validate its echoed identity."""
        data = await self._post(
            path="execute",
            owner_id=invocation.owner_id,
            payload=invocation.model_dump(mode="json"),
        )
        result = ToolResult.model_validate(data)
        if not compare_digest(
            result.invocation.idempotency_key,
            invocation.idempotency_key,
        ):
            raise ToolGatewayError(
                code="tool_gateway_identity_mismatch",
                message="Tool Gateway response did not match the requested operation.",
                kind=ToolErrorKind.STATE_UNKNOWN,
            )
        return result
