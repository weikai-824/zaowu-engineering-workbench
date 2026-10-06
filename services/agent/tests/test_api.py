"""FastAPI contract and lifecycle tests."""

from collections.abc import Iterator
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from zaowu_agent.application import create_app
from zaowu_agent.core.config import Settings
from zaowu_agent.domain.repair import RepairBudget
from zaowu_agent.persistence.checkpoints import CheckpointRuntime
from zaowu_agent.services.repair_runs import RepairRunService
from zaowu_agent.workflow.graph import build_repair_graph
from zaowu_agent.workflow.state import RepairWorkflowContext

from .conftest import fake_checkpoint_factory
from .test_repair_workflow import ClarifyingPlanner, FakeGateway, FakePlanner, repair_request

_SERVICE_TOKEN = "test-agent-service-token"
_OWNER_ID = "test-owner"


def _configured_repair_service(
    _settings: Settings,
    checkpoints: CheckpointRuntime,
    _http_client: httpx.AsyncClient,
) -> RepairRunService:
    budget = RepairBudget()
    context = RepairWorkflowContext(
        planner=FakePlanner(),
        gateway=FakeGateway(),
        budget=budget,
    )
    return RepairRunService(
        graph=build_repair_graph(checkpoints.checkpointer),
        context=context,
    )


def _configured_clarification_service(
    _settings: Settings,
    checkpoints: CheckpointRuntime,
    _http_client: httpx.AsyncClient,
) -> RepairRunService:
    budget = RepairBudget()
    context = RepairWorkflowContext(
        planner=ClarifyingPlanner(),
        gateway=FakeGateway(),
        budget=budget,
    )
    return RepairRunService(
        graph=build_repair_graph(checkpoints.checkpointer),
        context=context,
    )


@pytest.fixture
def configured_client(settings: Settings) -> Iterator[TestClient]:
    configured = settings.model_copy(update={"service_token": SecretStr(_SERVICE_TOKEN)})
    app = create_app(
        configured,
        fake_checkpoint_factory(ready=True),
        _configured_repair_service,
    )
    with TestClient(app) as client:
        yield client


@pytest.fixture
def clarifying_client(settings: Settings) -> Iterator[TestClient]:
    configured = settings.model_copy(update={"service_token": SecretStr(_SERVICE_TOKEN)})
    app = create_app(
        configured,
        fake_checkpoint_factory(ready=True),
        _configured_clarification_service,
    )
    with TestClient(app) as client:
        yield client


def _headers(*, owner_id: str = _OWNER_ID) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_SERVICE_TOKEN}",
        "X-Zaowu-Owner-Id": owner_id,
    }


def _run_payload() -> dict[str, object]:
    request = repair_request()
    return {
        "client_request_id": str(request.client_request_id),
        "project_id": str(request.project_id),
        "project_revision": request.project_revision,
        "goal": request.goal,
        "feedback": request.feedback.model_dump(mode="json", by_alias=True),
    }


def test_service_info_is_honest_when_graph_is_not_configured(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["agent_graph"] == "not_configured"


def test_service_info_reports_available_graph(configured_client: TestClient) -> None:
    response = configured_client.get("/")
    assert response.status_code == 200
    assert response.json()["agent_graph"] == "available"


def test_liveness_returns_request_id(client: TestClient) -> None:
    response = client.get("/health/live", headers={"X-Request-ID": "request-live-1"})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "request-live-1"
    assert response.json()["status"] == "ok"


def test_invalid_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/health/live", headers={"X-Request-ID": "contains spaces"})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] != "contains spaces"


def test_readiness_reports_postgres(client: TestClient) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json()["checkpoint_store"] == "postgresql"


def test_readiness_failure_uses_error_envelope(settings: Settings) -> None:
    app = create_app(settings, fake_checkpoint_factory(ready=False))
    with TestClient(app) as client:
        response = client.get("/health/ready", headers={"X-Request-ID": "request-ready-1"})
    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "checkpoint_store_unavailable",
            "message": "PostgreSQL checkpoint storage is not ready.",
            "request_id": "request-ready-1",
            "retryable": True,
            "details": [],
        }
    }


def test_valid_run_request_reports_unconfigured_workflow(client: TestClient) -> None:
    response = client.post(
        "/v1/runs",
        headers={"X-Request-ID": "request-run-1"},
        json=_run_payload(),
    )
    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "repair_workflow_not_configured",
        "message": "The repair workflow dependencies are not configured.",
        "request_id": "request-run-1",
        "retryable": False,
        "details": [],
    }


def test_run_validation_error_has_stable_details(client: TestClient) -> None:
    response = client.post(
        "/v1/runs",
        headers={"X-Request-ID": "request-validation-1"},
        json={"project_revision": 0, "goal": ""},
    )
    payload = response.json()["error"]
    assert response.status_code == 422
    assert payload["code"] == "request_validation_failed"
    assert payload["request_id"] == "request-validation-1"
    assert {detail["location"][-1] for detail in payload["details"]} == {
        "client_request_id",
        "project_id",
        "project_revision",
        "goal",
        "feedback",
    }


def test_run_api_requires_service_authentication(configured_client: TestClient) -> None:
    response = configured_client.post("/v1/runs", json=_run_payload())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "agent_service_unauthorized"


def test_run_create_is_idempotent_and_exposes_approval(
    configured_client: TestClient,
) -> None:
    first = configured_client.post("/v1/runs", headers=_headers(), json=_run_payload())
    second = configured_client.post("/v1/runs", headers=_headers(), json=_run_payload())

    assert first.status_code == 202
    assert second.status_code == 202
    assert first.json()["run_id"] == second.json()["run_id"]
    assert first.json()["status"] == "waiting_for_approval"
    assert first.json()["pending_action"] == "approval"
    assert first.json()["tool_call_count"] == 0


def test_run_can_be_approved_then_queried(configured_client: TestClient) -> None:
    created = configured_client.post("/v1/runs", headers=_headers(), json=_run_payload()).json()
    run_id = created["run_id"]

    approved = configured_client.post(
        f"/v1/runs/{run_id}/decisions",
        headers=_headers(),
        json={"choice": "approve"},
    )
    queried = configured_client.get(f"/v1/runs/{run_id}", headers=_headers())

    assert approved.status_code == 200
    assert approved.json()["status"] == "succeeded"
    assert approved.json()["current_revision"] == 9
    assert approved.json()["tool_call_count"] == 6
    assert queried.status_code == 200
    assert queried.json()["final_asset_ids"] == ["00000000-0000-4000-8000-000000000006"]


def test_run_clarification_validates_answer_count_then_replans(
    clarifying_client: TestClient,
) -> None:
    created = clarifying_client.post("/v1/runs", headers=_headers(), json=_run_payload()).json()
    run_id = created["run_id"]

    mismatch = clarifying_client.post(
        f"/v1/runs/{run_id}/clarifications",
        headers=_headers(),
        json={"answers": ["2.4 mm", "unexpected second answer"]},
    )
    clarified = clarifying_client.post(
        f"/v1/runs/{run_id}/clarifications",
        headers=_headers(),
        json={"answers": ["Preserve at least 2.4 mm."]},
    )

    assert created["status"] == "waiting_for_clarification"
    assert created["pending_action"] == "clarification"
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "repair_run_state_conflict"
    assert clarified.status_code == 200
    assert clarified.json()["status"] == "waiting_for_approval"
    assert clarified.json()["plan"]["version"] == 2


def test_run_lookup_hides_other_owners(configured_client: TestClient) -> None:
    created = configured_client.post("/v1/runs", headers=_headers(), json=_run_payload()).json()
    response = configured_client.get(
        f"/v1/runs/{created['run_id']}",
        headers=_headers(owner_id="different-owner"),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "repair_run_not_found"


def test_unconfigured_run_lookup_returns_service_error(client: TestClient) -> None:
    response = client.get(f"/v1/runs/{uuid4()}")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "repair_workflow_not_configured"


def test_openapi_publishes_run_success_and_error_contracts(client: TestClient) -> None:
    operation = client.get("/openapi.json").json()["paths"]["/v1/runs"]["post"]
    assert set(operation["responses"]) >= {"202", "401", "409", "422", "503"}
