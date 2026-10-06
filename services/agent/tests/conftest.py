"""Shared fixtures for the Agent service API."""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

from zaowu_agent.application import CheckpointRuntimeFactory, create_app
from zaowu_agent.core.config import Settings
from zaowu_agent.persistence.checkpoints import CheckpointRuntime


class FakeCheckpointRuntime:
    """In-memory test double; production never uses it."""

    def __init__(self, *, ready: bool) -> None:
        self._ready = ready
        self._checkpointer = InMemorySaver()

    @property
    def checkpointer(self) -> BaseCheckpointSaver[str]:
        return self._checkpointer

    async def is_ready(self) -> bool:
        return self._ready


def fake_checkpoint_factory(*, ready: bool) -> CheckpointRuntimeFactory:
    @asynccontextmanager
    async def factory(_settings: Settings) -> AsyncIterator[CheckpointRuntime]:
        yield FakeCheckpointRuntime(ready=ready)

    return factory


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        database_url="postgresql://agent:test@127.0.0.1:55433/zaowu_agent_test",
        checkpoint_auto_setup=False,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings, fake_checkpoint_factory(ready=True))
    with TestClient(app) as test_client:
        yield test_client
