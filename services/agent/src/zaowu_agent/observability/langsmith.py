"""Opt-in LangSmith tracing with client-side data minimization."""

import logging
import re
from collections.abc import Mapping
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID

from langsmith import Client, tracing_context
from langsmith.anonymizer import create_secret_anonymizer

from zaowu_agent.core.config import Settings

logger = logging.getLogger(__name__)

_IMAGE_DATA_URL_PATTERN = re.compile(
    r"data:image/[A-Za-z0-9.+-]+(?:;[A-Za-z0-9=.+-]+)*,[A-Za-z0-9%+/_=-]+"
)
_IMAGE_PLACEHOLDER = "[IMAGE_DATA_REDACTED]"
_OWNER_PLACEHOLDER = "[OWNER_ID_REDACTED]"
_SENSITIVE_FIELD_PLACEHOLDER = "[SENSITIVE_FIELD_REDACTED]"
_SENSITIVE_KEY_SUFFIXES = (
    "apikey",
    "authtoken",
    "accesstoken",
    "password",
    "passwd",
    "secret",
    "privatekey",
    "accesskey",
)
_SECRET_ANONYMIZER = create_secret_anonymizer()


def _normalized_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def _redact_structured_value(value: object, *, key: str | None = None) -> object:
    if isinstance(value, dict):
        return {
            str(child_key): _redact_structured_value(child_value, key=str(child_key))
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [_redact_structured_value(item) for item in value]
    if isinstance(value, tuple):
        return [_redact_structured_value(item) for item in value]
    if not isinstance(value, str):
        return value

    normalized_key = _normalized_key(key) if key is not None else ""
    if normalized_key == "ownerid":
        return _OWNER_PLACEHOLDER
    if normalized_key in {"authorization", "token"} or normalized_key.endswith(
        _SENSITIVE_KEY_SUFFIXES
    ):
        return _SENSITIVE_FIELD_PLACEHOLDER
    return _IMAGE_DATA_URL_PATTERN.sub(_IMAGE_PLACEHOLDER, value)


def redact_trace_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a redacted copy of a serialized trace payload before upload."""
    structured = _redact_structured_value(payload)
    if not isinstance(structured, dict):
        return {}
    anonymized = _SECRET_ANONYMIZER(structured)
    return cast(dict[str, Any], anonymized)


def repair_trace_metadata(
    *,
    run_id: UUID,
    project_id: UUID,
    project_revision: int,
    operation: str,
    plan_version: int | None,
) -> dict[str, str | int]:
    """Build stable, non-secret attributes shared by every resumed invocation."""
    metadata: dict[str, str | int] = {
        "repair_run_id": str(run_id),
        "thread_id": str(run_id),
        "project_id": str(project_id),
        "project_revision": project_revision,
        "agent_operation": operation,
        "workflow_pattern": "planner-clarification-approval-executor-verifier-replanner",
    }
    if plan_version is not None:
        metadata["plan_version"] = plan_version
    return metadata


@dataclass(frozen=True, slots=True)
class LangSmithTracing:
    """Own the optional LangSmith client, trace context, and shutdown flush."""

    client: Client | None
    project_name: str
    environment: str
    flush_timeout_seconds: float

    @property
    def enabled(self) -> bool:
        return self.client is not None

    def scope(
        self,
        *,
        metadata: Mapping[str, str | int],
        operation: str,
    ) -> AbstractContextManager[None]:
        """Create one root trace for a graph start or resume invocation."""
        if self.client is None:
            return nullcontext()
        trace_metadata: dict[str, Any] = {
            **metadata,
            "environment": self.environment,
        }
        return tracing_context(
            project_name=self.project_name,
            tags=[
                "zaowu-agent",
                "repair-workflow",
                f"environment:{self.environment}",
                f"operation:{operation}",
            ],
            metadata=trace_metadata,
            parent=False,
            enabled=True,
            client=self.client,
        )

    def close(self) -> None:
        """Flush buffered traces without making shutdown depend on LangSmith."""
        if self.client is None:
            return
        try:
            self.client.close(timeout=self.flush_timeout_seconds)
        except Exception:
            logger.warning("langsmith_trace_flush_failed", exc_info=True)


def _report_tracing_error(error: Exception) -> None:
    logger.warning(
        "langsmith_trace_delivery_failed",
        extra={"error_type": type(error).__name__},
    )


def create_langsmith_tracing(settings: Settings) -> LangSmithTracing:
    """Create a disabled tracer or an isolated, redacting LangSmith client."""
    client: Client | None = None
    if settings.langsmith_tracing:
        api_key = settings.langsmith_api_key
        if api_key is None:  # Protected by Settings validation; keeps narrowing explicit.
            raise ValueError("LangSmith tracing requires an API key")
        client = Client(
            api_url=str(settings.langsmith_endpoint),
            api_key=api_key.get_secret_value(),
            workspace_id=settings.langsmith_workspace_id or None,
            anonymizer=redact_trace_payload,
            omit_traced_runtime_info=True,
            tracing_error_callback=_report_tracing_error,
        )
    return LangSmithTracing(
        client=client,
        project_name=settings.langsmith_project,
        environment=settings.environment,
        flush_timeout_seconds=settings.langsmith_flush_timeout_seconds,
    )
