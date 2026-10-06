"""LangSmith integration tests without external trace delivery."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, TypedDict, cast
from uuid import UUID

import httpx
import pytest
from langgraph.graph import END, START, StateGraph
from langsmith import Client
from langsmith.client import ID_TYPE, RUN_TYPE_T
from pydantic import SecretStr

from zaowu_agent.adapters.tool_gateway import HttpRepairToolGateway
from zaowu_agent.core.config import Settings
from zaowu_agent.observability import langsmith as langsmith_observability
from zaowu_agent.observability.langsmith import (
    LangSmithTracing,
    create_langsmith_tracing,
    redact_trace_payload,
    repair_trace_metadata,
)


class FakeClient:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.closed_with: float | None = None

    def close(self, *, timeout: float | None = None) -> None:
        self.closed_with = timeout


class RecordingClient(Client):
    def __init__(self) -> None:
        super().__init__(
            api_url="http://127.0.0.1:9",
            api_key="test-only-key",
            auto_batch_tracing=False,
        )
        self.created: list[tuple[str, str, ID_TYPE | None]] = []
        self.created_inputs: list[dict[str, Any]] = []

    def create_run(
        self,
        name: str,
        inputs: dict[str, Any],
        run_type: RUN_TYPE_T,
        **kwargs: Any,
    ) -> None:
        self.created.append((name, run_type, kwargs.get("parent_run_id")))
        self.created_inputs.append(inputs)

    def update_run(self, run_id: ID_TYPE, **kwargs: Any) -> None:
        del run_id, kwargs


class FailingRunClient(RecordingClient):
    def create_run(
        self,
        name: str,
        inputs: dict[str, Any],
        run_type: RUN_TYPE_T,
        **kwargs: Any,
    ) -> None:
        del name, inputs, run_type, kwargs
        raise RuntimeError("delivery unavailable")

    def update_run(self, run_id: ID_TYPE, **kwargs: Any) -> None:
        del run_id, kwargs
        raise RuntimeError("delivery unavailable")


class TraceProbeState(TypedDict):
    value: int


def _increment_probe(state: TraceProbeState) -> TraceProbeState:
    return {"value": state["value"] + 1}


def _settings(**updates: object) -> Settings:
    base: dict[str, object] = {
        "database_url": "postgresql://agent:test@127.0.0.1:5432/agent",
        "environment": "test",
    }
    base.update(updates)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


def test_trace_redaction_is_recursive_and_does_not_mutate_source() -> None:
    provider_key = "sk-" + ("a" * 32)
    payload: dict[str, Any] = {
        "request": {
            "owner_id": "owner@example.com",
            "goal": "Keep this engineering goal visible.",
            "annotation": "data:image/png;base64,QUJDREVGRw==",
            "authorization": "Bearer raw-credential-value",
        },
        "messages": [f"credential={provider_key}"],
    }

    redacted = redact_trace_payload(payload)

    assert redacted["request"]["owner_id"] == "[OWNER_ID_REDACTED]"
    assert redacted["request"]["annotation"] == "[IMAGE_DATA_REDACTED]"
    assert redacted["request"]["authorization"] == "[SENSITIVE_FIELD_REDACTED]"
    assert redacted["request"]["goal"] == "Keep this engineering goal visible."
    assert provider_key not in redacted["messages"][0]
    assert payload["request"]["owner_id"] == "owner@example.com"


def test_repair_trace_metadata_correlates_resumed_invocations() -> None:
    run_id = UUID("00000000-0000-4000-8000-000000000001")
    project_id = UUID("00000000-0000-4000-8000-000000000002")
    metadata = repair_trace_metadata(
        run_id=run_id,
        project_id=project_id,
        project_revision=7,
        operation="approve",
        plan_version=2,
    )

    assert metadata["repair_run_id"] == str(run_id)
    assert metadata["thread_id"] == str(run_id)
    assert metadata["project_id"] == str(project_id)
    assert metadata["project_revision"] == 7
    assert metadata["agent_operation"] == "approve"
    assert metadata["plan_version"] == 2


def test_disabled_tracing_uses_noop_scope() -> None:
    tracing = create_langsmith_tracing(_settings())

    with tracing.scope(metadata={}, operation="create"):
        pass

    assert tracing.enabled is False
    tracing.close()


def test_enabled_tracing_uses_redacting_client_and_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeClient()
    contexts: list[dict[str, object]] = []

    def fake_client_factory(**kwargs: object) -> FakeClient:
        fake_client.kwargs = kwargs
        return fake_client

    @contextmanager
    def fake_tracing_context(**kwargs: object) -> Iterator[None]:
        contexts.append(kwargs)
        yield

    monkeypatch.setattr(langsmith_observability, "Client", fake_client_factory)
    monkeypatch.setattr(langsmith_observability, "tracing_context", fake_tracing_context)
    settings = _settings(
        langsmith_tracing=True,
        langsmith_api_key=SecretStr("lsv2_pt_test_key_value"),
        langsmith_project="zaowu-tests",
        langsmith_flush_timeout_seconds=3.0,
    )

    tracing = create_langsmith_tracing(settings)
    metadata = {"thread_id": "run-1", "agent_operation": "clarify"}
    with tracing.scope(metadata=metadata, operation="clarify"):
        pass
    tracing.close()

    assert tracing.enabled is True
    assert fake_client.kwargs["api_key"] == "lsv2_pt_test_key_value"
    assert fake_client.kwargs["anonymizer"] is redact_trace_payload
    assert fake_client.kwargs["omit_traced_runtime_info"] is True
    assert contexts[0]["project_name"] == "zaowu-tests"
    assert contexts[0]["parent"] is False
    assert contexts[0]["enabled"] is True
    assert contexts[0]["metadata"] == {
        **metadata,
        "environment": "test",
    }
    assert "operation:clarify" in cast(list[str], contexts[0]["tags"])
    assert fake_client.closed_with == 3.0


@pytest.mark.asyncio
async def test_enabled_scope_produces_langgraph_root_and_child_spans() -> None:
    client = RecordingClient()
    builder = StateGraph(TraceProbeState)
    builder.add_node("increment", _increment_probe)
    builder.add_edge(START, "increment")
    builder.add_edge("increment", END)
    graph = builder.compile(name="trace_probe_graph")
    tracing = LangSmithTracing(
        client=client,
        project_name="zaowu-tests",
        environment="test",
        flush_timeout_seconds=1.0,
    )

    with tracing.scope(metadata={"thread_id": "probe-1"}, operation="create"):
        result = await graph.ainvoke({"value": 1})
    client.close()

    assert result == {"value": 2}
    assert [span[0] for span in client.created] == ["trace_probe_graph", "increment"]
    assert client.created[0][2] is None
    assert client.created[1][2] is not None


@pytest.mark.asyncio
async def test_trace_delivery_failure_does_not_change_graph_result() -> None:
    builder = StateGraph(TraceProbeState)
    builder.add_node("increment", _increment_probe)
    builder.add_edge(START, "increment")
    builder.add_edge("increment", END)
    graph = builder.compile(name="failing_trace_probe_graph")
    client = FailingRunClient()
    tracing = LangSmithTracing(
        client=client,
        project_name="zaowu-tests",
        environment="test",
        flush_timeout_seconds=1.0,
    )

    with tracing.scope(metadata={"thread_id": "probe-2"}, operation="create"):
        result = await graph.ainvoke({"value": 1})
    client.close()

    assert result == {"value": 2}


@pytest.mark.asyncio
async def test_gateway_http_request_is_a_redactable_tool_span() -> None:
    client = RecordingClient()
    tracing = LangSmithTracing(
        client=client,
        project_name="zaowu-tests",
        environment="test",
        flush_timeout_seconds=1.0,
    )
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={"ok": True}))
    async with httpx.AsyncClient(transport=transport) as http_client:
        gateway = HttpRepairToolGateway(
            client=http_client,
            base_url="https://product.test/api/agent-tools",
            token="private-gateway-token",
        )
        with tracing.scope(metadata={"thread_id": "probe-3"}, operation="create"):
            await gateway._post(
                path="context",
                owner_id="private-owner-id",
                payload={"project_id": "project-1"},
            )
    client.close()

    assert client.created == [("zaowu_tool_gateway_request", "tool", None)]
    assert "self" not in client.created_inputs[0]
    assert client.created_inputs[0]["path"] == "context"


def test_close_does_not_raise_when_trace_delivery_fails(caplog: pytest.LogCaptureFixture) -> None:
    class FailingClient(FakeClient):
        def close(self, *, timeout: float | None = None) -> None:
            raise RuntimeError("delivery unavailable")

    tracing = LangSmithTracing(
        client=cast(Client, FailingClient()),
        project_name="zaowu-tests",
        environment="test",
        flush_timeout_seconds=1.0,
    )

    tracing.close()

    assert "langsmith_trace_flush_failed" in caplog.text
