"""Runtime-loop regression tests for the Windows Agent entry point."""

import asyncio
import sys
from unittest.mock import patch

from zaowu_agent.core.event_loop import psycopg_event_loop_factory
from zaowu_agent.main import main


def test_psycopg_event_loop_factory_returns_usable_loop() -> None:
    loop = psycopg_event_loop_factory(use_subprocess=False)
    try:
        assert not loop.is_closed()
        if sys.platform == "win32":
            assert isinstance(loop, asyncio.SelectorEventLoop)
    finally:
        loop.close()


def test_agent_entry_point_supplies_psycopg_loop_factory() -> None:
    with patch("zaowu_agent.main.uvicorn.run") as run:
        main(["--host", "127.0.0.2", "--port", "8123", "--reload"])

    run.assert_called_once_with(
        "zaowu_agent.main:create_app",
        factory=True,
        host="127.0.0.2",
        port=8123,
        reload=True,
        loop="zaowu_agent.core.event_loop:psycopg_event_loop_factory",
    )
