"""Typed service configuration loaded from environment variables."""

from pathlib import Path
from typing import Literal, Self

from pydantic import AnyHttpUrl, Field, PostgresDsn, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"
MAX_SYNCHRONOUS_PLANNING_SECONDS = 450.0


class Settings(BaseSettings):
    """Runtime configuration for the Agent service.

    Secrets and connection strings come from environment variables or the
    service-local ignored `.env` file. They are never accepted through the API.
    """

    model_config = SettingsConfigDict(
        env_file=DEFAULT_ENV_FILE,
        env_file_encoding="utf-8",
        env_prefix="AGENT_",
        env_ignore_empty=True,
        extra="ignore",
        frozen=True,
    )

    service_name: str = "zaowu-agent-service"
    service_version: str = "0.2.0"
    environment: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    database_url: PostgresDsn
    database_pool_min_size: int = Field(default=1, ge=1, le=20)
    database_pool_max_size: int = Field(default=5, ge=1, le=50)
    database_connect_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    checkpoint_auto_setup: bool = True
    service_token: SecretStr | None = None
    gateway_url: AnyHttpUrl | None = None
    gateway_token: SecretStr | None = None
    gateway_timeout_seconds: float = Field(default=20.0, gt=0, le=120)
    model_api_key: SecretStr | None = None
    model_base_url: AnyHttpUrl | None = None
    model_name: str | None = Field(default=None, min_length=1, max_length=200)
    model_timeout_seconds: float = Field(default=60.0, gt=0, le=300)
    model_max_output_tokens: int = Field(default=4_000, ge=256, le=32_000)
    model_input_cost_per_million_usd: float = Field(default=0.0, ge=0, le=1_000)
    model_output_cost_per_million_usd: float = Field(default=0.0, ge=0, le=1_000)
    langsmith_tracing: bool = False
    langsmith_api_key: SecretStr | None = None
    langsmith_endpoint: AnyHttpUrl = AnyHttpUrl("https://api.smith.langchain.com")
    langsmith_project: str = Field(default="zaowu-agent-development", min_length=1, max_length=200)
    langsmith_workspace_id: str | None = Field(default=None, max_length=200)
    langsmith_flush_timeout_seconds: float = Field(default=5.0, gt=0, le=30)
    max_plan_attempts: int = Field(default=3, ge=1, le=8)
    max_replans: int = Field(default=2, ge=0, le=6)
    max_tool_calls: int = Field(default=18, ge=1, le=64)
    max_plan_steps: int = Field(default=4, ge=1, le=12)
    max_model_tokens: int = Field(default=40_000, ge=1_000, le=1_000_000)
    max_estimated_cost_usd: float = Field(default=2.0, gt=0, le=1_000)
    max_run_age_seconds: int = Field(default=86_400, ge=60, le=604_800)

    @model_validator(mode="after")
    def validate_pool_bounds(self) -> Self:
        """Reject settings that violate shared infrastructure budgets."""
        if self.database_pool_min_size > self.database_pool_max_size:
            raise ValueError("database_pool_min_size cannot exceed database_pool_max_size")
        # A create request performs one context load plus one image load and one
        # model call per planning attempt.  Keep that worst-case retry budget
        # below the product proxy's 480-second timeout (30 seconds of transport
        # and tracing slack remain).  This prevents a seemingly valid Agent
        # configuration from being guaranteed to time out at the caller.
        planning_seconds = self.gateway_timeout_seconds + self.max_plan_attempts * (
            self.gateway_timeout_seconds + self.model_timeout_seconds
        )
        if planning_seconds > MAX_SYNCHRONOUS_PLANNING_SECONDS:
            raise ValueError(
                "planning retry budget exceeds the 450-second synchronous request limit"
            )
        if self.langsmith_tracing and (
            self.langsmith_api_key is None or not self.langsmith_api_key.get_secret_value().strip()
        ):
            raise ValueError("langsmith_api_key is required when langsmith_tracing is enabled")
        return self

    @property
    def database_connection_string(self) -> str:
        """Return the PostgreSQL URL for database drivers without logging it."""
        return str(self.database_url)

    @property
    def repair_workflow_configured(self) -> bool:
        """Return whether every external dependency required by goal 1 is configured."""
        return all(
            (
                self.service_token,
                self.gateway_url,
                self.gateway_token,
                self.model_api_key,
                self.model_base_url,
                self.model_name,
            )
        )


def load_settings() -> Settings:
    """Load settings from the service environment and ignored `.env` file."""
    return Settings()
