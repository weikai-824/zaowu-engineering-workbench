"""Contract tests for the model and TypeScript Tool Gateway adapters."""

import json
from pathlib import Path
from typing import cast
from uuid import UUID

import httpx
import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage

from tests.test_repair_workflow import FakePlanner, repair_request
from zaowu_agent.adapters.planner import LangChainRepairPlanner, create_langchain_planner
from zaowu_agent.adapters.tool_gateway import HttpRepairToolGateway, _trace_gateway_inputs
from zaowu_agent.core.config import Settings
from zaowu_agent.domain.repair import (
    PointFeedback,
    ProjectContext,
    RepairBudget,
    RepairPlan,
    ToolErrorKind,
    ToolInvocation,
    ToolName,
    ToolResult,
)
from zaowu_agent.ports.repair import ToolGatewayError


def invocation() -> ToolInvocation:
    """Return one stable request used to validate response identity."""
    request = repair_request()
    return ToolInvocation(
        run_id=UUID("00000000-0000-4000-8000-000000000010"),
        plan_version=1,
        step_id="change-enclosure",
        tool_index=0,
        tool=ToolName.APPLY_DESIGN_CHANGE,
        idempotency_key="repair:test:1",
        owner_id=request.owner_id,
        project_id=request.project_id,
        expected_revision=7,
        arguments={},
    )


def test_gateway_trace_inputs_exclude_credential_owning_adapter() -> None:
    adapter = object()
    traced = _trace_gateway_inputs(
        {"self": adapter, "path": "execute", "payload": {"project_id": "project-1"}}
    )
    assert "self" not in traced
    assert traced == {"path": "execute", "payload": {"project_id": "project-1"}}


def test_shared_tool_contract_fixture_matches_python_models() -> None:
    fixture_path = Path(__file__).parents[3] / "contracts" / "repair-tool-v1.fixture.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    parsed_invocation = ToolInvocation.model_validate(fixture["invocation"])
    parsed_result = ToolResult.model_validate(fixture["result"])
    assert parsed_result.invocation == parsed_invocation


def gateway_response(request: httpx.Request) -> httpx.Response:
    """Serve every successful Tool Gateway contract from one mock transport."""
    assert request.headers["authorization"] == "Bearer gateway-secret"
    assert request.headers["x-zaowu-owner-id"] == "test-owner"
    if request.url.path.endswith("/context"):
        return httpx.Response(
            200,
            json={
                "project_id": "00000000-0000-4000-8000-000000000001",
                "revision": 7,
                "input_hash": "a" * 64,
                "selected_part_id": "00000000-0000-4000-8000-000000000003",
                "project": {"revision": 7},
                "evidence": [],
                "limitations": ["Physical validation has not run."],
            },
        )
    if request.url.path.endswith("/annotation"):
        return httpx.Response(200, json={"data_url": "data:image/png;base64,dGVzdA=="})
    requested = invocation()
    return httpx.Response(
        200,
        json={
            "invocation": requested.model_dump(mode="json"),
            "outcome": "succeeded",
            "summary": "Applied.",
            "output": {"project_revision": 8},
            "evidence": [],
            "error_code": None,
            "error_kind": None,
        },
    )


@pytest.mark.asyncio
async def test_http_gateway_covers_context_image_and_tool_contract() -> None:
    async with httpx.AsyncClient(transport=httpx.MockTransport(gateway_response)) as client:
        gateway = HttpRepairToolGateway(
            client=client,
            base_url="https://product.test/api/agent-tools/",
            token="gateway-secret",
        )
        request = repair_request()
        context = await gateway.load_project_context(request, accept_newer_revision=True)
        image = await gateway.load_annotation_image(request)
        result = await gateway.execute(invocation())
    assert context.revision == 7
    assert image == "data:image/png;base64,dGVzdA=="
    assert result.output["project_revision"] == 8


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "expected_code", "expected_kind"),
    [
        (
            httpx.Response(
                409,
                json={
                    "code": "revision_conflict",
                    "message": "Changed.",
                    "kind": "retryable",
                },
            ),
            "revision_conflict",
            ToolErrorKind.RETRYABLE,
        ),
        (
            httpx.Response(503, json={"unexpected": True}),
            "tool_gateway_error",
            ToolErrorKind.RETRYABLE,
        ),
        (
            httpx.Response(502, text="not json"),
            "tool_gateway_invalid_json",
            ToolErrorKind.STATE_UNKNOWN,
        ),
    ],
)
async def test_http_gateway_classifies_failures(
    response: httpx.Response,
    expected_code: str,
    expected_kind: ToolErrorKind,
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: response)
    ) as client:
        gateway = HttpRepairToolGateway(
            client=client, base_url="https://product.test", token="secret"
        )
        with pytest.raises(ToolGatewayError) as captured:
            await gateway.execute(invocation())
    assert captured.value.code == expected_code
    assert captured.value.kind == expected_kind


@pytest.mark.asyncio
async def test_http_gateway_rejects_large_and_mismatched_responses() -> None:
    responses = iter(
        [
            httpx.Response(200, content=b"x" * (4 * 1024 * 1024 + 1)),
            httpx.Response(200, json={"data_url": "x" * (3 * 1024 * 1024 + 1)}),
            httpx.Response(
                200,
                json={
                    "invocation": {
                        **invocation().model_dump(mode="json"),
                        "idempotency_key": "wrong-key",
                    },
                    "outcome": "succeeded",
                    "summary": "Applied.",
                    "output": {},
                    "evidence": [],
                    "error_code": None,
                    "error_kind": None,
                },
            ),
        ]
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: next(responses))
    ) as client:
        gateway = HttpRepairToolGateway(
            client=client, base_url="https://product.test", token="secret"
        )
        with pytest.raises(ToolGatewayError, match="size limit"):
            await gateway.execute(invocation())
        with pytest.raises(ToolGatewayError, match="image limit"):
            await gateway.load_annotation_image(repair_request())
        with pytest.raises(ToolGatewayError, match="did not match"):
            await gateway.execute(invocation())


class FakeStructuredModel:
    """Small async model double that records multimodal message construction."""

    def __init__(self, values: list[dict[str, object]]) -> None:
        self.values = iter(values)
        self.calls: list[object] = []

    async def ainvoke(self, messages: object) -> dict[str, object]:
        self.calls.append(messages)
        return next(self.values)


class FakeChatModel:
    """Expose only the structured-output capability used by the adapter."""

    def __init__(self, structured: FakeStructuredModel) -> None:
        self.structured = structured
        self.schema: object | None = None
        self.method = ""

    def with_structured_output(
        self, schema: object, *, method: str, include_raw: bool
    ) -> FakeStructuredModel:
        assert include_raw is True
        self.schema, self.method = schema, method
        return self.structured


@pytest.mark.asyncio
async def test_planner_builds_initial_and_revised_structured_requests() -> None:
    initial = FakePlanner._plan(1)
    revised = FakePlanner._plan(2)
    raw = AIMessage(
        content="{}",
        usage_metadata={"input_tokens": 100, "output_tokens": 20, "total_tokens": 120},
    )
    structured = FakeStructuredModel(
        [
            {"parsed": initial.model_dump(mode="json"), "raw": raw, "parsing_error": None},
            {"parsed": revised, "raw": raw, "parsing_error": None},
        ]
    )
    model = FakeChatModel(structured)
    planner = LangChainRepairPlanner(cast(BaseChatModel, model))
    request = repair_request()
    context = ProjectContext(
        project_id=request.project_id,
        revision=7,
        input_hash="a" * 64,
        selected_part_id=request.feedback.part_id,
        project={"revision": 7},
    )
    created = await planner.create_plan(
        request=request,
        context=context,
        annotation_image_data_url="data:image/png;base64,dGVzdA==",
        budget=RepairBudget(),
    )
    updated = await planner.revise_plan(
        request=request,
        context=context,
        previous_plan=created.plan,
        verification=None,
        human_feedback="Keep the mounting interface.",
        annotation_image_data_url=None,
        budget=RepairBudget(),
    )
    assert model.schema is RepairPlan
    assert model.method == "json_mode"
    assert created.plan.version == 1
    assert updated.plan.version == 2
    assert created.usage.total_tokens == 120
    assert len(structured.calls) == 2
    messages = cast(list[BaseMessage], structured.calls[0])
    assert "schema_version" in str(messages[0].content)


def configured_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "test",
        "database_url": "postgresql://agent:test@127.0.0.1:55433/agent_test",
        "model_api_key": "model-secret",
        "model_base_url": "https://models.test/v1",
        "model_name": "planner-model",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


def test_planner_factory_requires_complete_model_config() -> None:
    with pytest.raises(ValueError, match="incomplete"):
        create_langchain_planner(configured_settings(model_name=None))
    planner = create_langchain_planner(configured_settings())
    assert isinstance(planner, LangChainRepairPlanner)


@pytest.mark.asyncio
async def test_planner_rejects_parse_errors_and_missing_usage() -> None:
    request = repair_request()
    context = ProjectContext(
        project_id=request.project_id,
        revision=7,
        input_hash="a" * 64,
        selected_part_id=request.feedback.part_id,
        project={"revision": 7},
    )
    missing_usage = AIMessage(content="{}")
    invalid_raw = AIMessage(
        content="not-json",
        usage_metadata={"input_tokens": 50, "output_tokens": 5, "total_tokens": 55},
    )
    structured = FakeStructuredModel(
        [
            {"parsed": None, "raw": invalid_raw, "parsing_error": "bad JSON"},
            {
                "parsed": FakePlanner._plan(1),
                "raw": missing_usage,
                "parsing_error": None,
            },
        ]
    )
    planner = LangChainRepairPlanner(cast(BaseChatModel, FakeChatModel(structured)))
    with pytest.raises(ValueError, match="invalid structured plan"):
        await planner.create_plan(
            request=request, context=context, annotation_image_data_url=None, budget=RepairBudget()
        )
    with pytest.raises(ValueError, match="token usage"):
        await planner.create_plan(
            request=request, context=context, annotation_image_data_url=None, budget=RepairBudget()
        )


@pytest.mark.asyncio
async def test_gateway_skips_annotation_call_for_point_feedback() -> None:
    region_request = repair_request()
    point = PointFeedback.model_validate(
        {
            key: value
            for key, value in region_request.feedback.model_dump(mode="json", by_alias=True).items()
            if key not in {"region", "annotationImageAssetId", "annotation_image_asset_id"}
        }
        | {"schema": "design-feedback-v1"}
    )
    point_request = region_request.model_copy(update={"feedback": point})
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: pytest.fail("HTTP should not be called"))
    ) as client:
        gateway = HttpRepairToolGateway(
            client=client, base_url="https://product.test", token="secret"
        )
        assert await gateway.load_annotation_image(point_request) is None
