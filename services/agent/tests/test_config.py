"""Configuration boundary tests."""

import pytest
from pydantic import ValidationError

from zaowu_agent.core.config import Settings


def _settings(values: dict[str, object]) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


def test_database_url_is_required() -> None:
    with pytest.raises(ValidationError):
        _settings({"environment": "test"})


def test_database_url_is_not_exposed_by_connection_property() -> None:
    settings = _settings(
        {
            "database_url": "postgresql://agent:secret@127.0.0.1:5432/agent",
            "environment": "test",
        }
    )
    assert settings.database_connection_string.startswith("postgresql://agent:secret@")


def test_invalid_database_url_is_rejected() -> None:
    with pytest.raises(ValidationError):
        _settings({"database_url": "not-a-postgres-url"})


def test_invalid_pool_bounds_are_rejected() -> None:
    with pytest.raises(ValidationError, match="database_pool_min_size"):
        _settings(
            {
                "database_url": "postgresql://agent:test@127.0.0.1:5432/agent",
                "database_pool_min_size": 3,
                "database_pool_max_size": 2,
            }
        )


def test_langsmith_tracing_is_disabled_by_default() -> None:
    settings = _settings({"database_url": "postgresql://agent:test@127.0.0.1:5432/agent"})
    assert settings.langsmith_tracing is False
    assert settings.langsmith_api_key is None


def test_langsmith_tracing_requires_api_key() -> None:
    with pytest.raises(ValidationError, match="langsmith_api_key"):
        _settings(
            {
                "database_url": "postgresql://agent:test@127.0.0.1:5432/agent",
                "langsmith_tracing": True,
            }
        )


def test_optional_empty_values_do_not_override_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_MODEL_NAME", "")
    monkeypatch.setenv("AGENT_LANGSMITH_WORKSPACE_ID", "")
    settings = _settings(
        {
            "database_url": "postgresql://agent:test@127.0.0.1:5432/agent",
        }
    )
    assert settings.model_name is None
    assert settings.langsmith_workspace_id is None


def test_planning_retry_budget_fits_product_proxy_timeout() -> None:
    settings = _settings(
        {
            "database_url": "postgresql://agent:test@127.0.0.1:5432/agent",
            "gateway_timeout_seconds": 20,
            "model_timeout_seconds": 120,
            "max_plan_attempts": 3,
        }
    )
    assert settings.model_timeout_seconds == 120


def test_planning_retry_budget_rejects_guaranteed_proxy_timeout() -> None:
    with pytest.raises(ValidationError, match="planning retry budget"):
        _settings(
            {
                "database_url": "postgresql://agent:test@127.0.0.1:5432/agent",
                "gateway_timeout_seconds": 30,
                "model_timeout_seconds": 150,
                "max_plan_attempts": 3,
            }
        )
