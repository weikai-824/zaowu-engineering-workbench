"""Real PostgreSQL checkpoint integration test."""

import os
from typing import TypedDict, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from zaowu_agent.application import create_app
from zaowu_agent.core.config import Settings
from zaowu_agent.persistence.checkpoints import open_postgres_checkpoints


class CounterState(TypedDict):
    value: int


async def increment(state: CounterState) -> CounterState:
    return {"value": state["value"] + 1}


def integration_settings() -> Settings:
    database_url = os.getenv("AGENT_TEST_DATABASE_URL")
    if database_url is None:
        pytest.skip("AGENT_TEST_DATABASE_URL is required for the integration test")
    return Settings(
        _env_file=None,
        environment="test",
        database_url=database_url,
        database_pool_min_size=1,
        database_pool_max_size=2,
        checkpoint_auto_setup=True,
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_checkpoint_round_trip() -> None:
    settings = integration_settings()
    async with open_postgres_checkpoints(settings) as runtime:
        assert await runtime.is_ready()
        builder = StateGraph(CounterState)
        builder.add_node("increment", increment)
        builder.add_edge(START, "increment")
        builder.add_edge("increment", END)
        graph = builder.compile(checkpointer=runtime.checkpointer)
        config: RunnableConfig = {"configurable": {"thread_id": str(uuid4())}}
        result = cast(CounterState, await graph.ainvoke({"value": 41}, config))
        snapshot = await graph.aget_state(config)
    assert result == {"value": 42}
    assert snapshot.values["value"] == 42


@pytest.mark.integration
def test_service_starts_with_real_postgres() -> None:
    app = create_app(integration_settings())
    with TestClient(app) as client:
        live_response = client.get("/health/live")
        ready_response = client.get("/health/ready")
    assert live_response.status_code == 200
    assert ready_response.status_code == 200
    assert ready_response.json()["checkpoint_store"] == "postgresql"
