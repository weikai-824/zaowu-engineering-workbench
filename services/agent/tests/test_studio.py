"""Tests for the local LangSmith Studio adapter."""

import importlib
import sys
from types import ModuleType
from typing import Any, cast

import pytest

from zaowu_agent.domain.repair import ProjectContext, RepairRequest, ToolInvocation, ToolResult


def _import_studio(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    values = {
        "AGENT_DATABASE_URL": "postgresql://agent:test@127.0.0.1:5432/agent",
        "AGENT_GATEWAY_URL": "http://127.0.0.1:8787/api/agent-tools",
        "AGENT_GATEWAY_TOKEN": "studio-test-token",
        "AGENT_MODEL_API_KEY": "studio-test-model-key",
        "AGENT_MODEL_BASE_URL": "https://model.invalid/v1",
        "AGENT_MODEL_NAME": "studio-test-model",
        "AGENT_LANGSMITH_TRACING": "false",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    sys.modules.pop("zaowu_agent.studio", None)
    return importlib.import_module("zaowu_agent.studio")


def test_studio_exports_the_real_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    studio: Any = _import_studio(monkeypatch)

    graph = studio.graph.get_graph()
    assert "planner" in graph.nodes
    assert "approval" in graph.nodes
    assert "executor" in graph.nodes
    assert "replanner" in graph.nodes
    assert studio.graph.get_context_jsonschema() is None


@pytest.mark.asyncio
async def test_studio_gateway_uses_a_fresh_client_per_operation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    studio: Any = _import_studio(monkeypatch)
    entered_clients: list[object] = []
    calls: list[tuple[str, bool | None]] = []
    project_context = cast(ProjectContext, object())
    tool_result = cast(ToolResult, object())

    class FakeClient:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            entered_clients.append(self)
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

    class FakeGateway:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def load_project_context(
            self,
            _request: RepairRequest,
            *,
            accept_newer_revision: bool = False,
        ) -> ProjectContext:
            calls.append(("context", accept_newer_revision))
            return project_context

        async def load_annotation_image(self, _request: RepairRequest) -> str | None:
            calls.append(("annotation", None))
            return "data:image/png;base64,demo"

        async def execute(self, _invocation: ToolInvocation) -> ToolResult:
            calls.append(("execute", None))
            return tool_result

    monkeypatch.setattr(studio.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(studio, "HttpRepairToolGateway", FakeGateway)
    gateway = studio.StudioToolGateway(
        base_url="http://127.0.0.1:8787/api/agent-tools",
        token="token",
        timeout_seconds=2,
    )
    request = cast(RepairRequest, object())
    invocation = cast(ToolInvocation, object())

    assert (
        await gateway.load_project_context(request, accept_newer_revision=True) is project_context
    )
    assert await gateway.load_annotation_image(request) == "data:image/png;base64,demo"
    assert await gateway.execute(invocation) is tool_result
    assert calls == [("context", True), ("annotation", None), ("execute", None)]
    assert len(entered_clients) == 3
