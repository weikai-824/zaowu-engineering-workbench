"""Correlation context and JSON logging tests."""

import asyncio
import json
import logging
import sys

from zaowu_agent.core.context import bind_log_context, get_log_context
from zaowu_agent.core.event_loop import configure_event_loop_policy
from zaowu_agent.core.logging import JsonLogFormatter, configure_logging


def test_log_context_is_nested_and_restored() -> None:
    assert get_log_context().request_id == "unbound"
    with bind_log_context(request_id="request-1", run_id="run-1"):
        assert get_log_context().request_id == "request-1"
        with bind_log_context(thread_id="thread-1"):
            assert get_log_context().thread_id == "thread-1"
        assert get_log_context().thread_id is None
    assert get_log_context().request_id == "unbound"


def test_json_formatter_adds_execution_context() -> None:
    formatter = JsonLogFormatter()
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="checkpoint ready",
        args=(),
        exc_info=None,
    )
    record.status_code = 200
    with bind_log_context(request_id="request-2", run_id="run-2", thread_id="thread-2"):
        payload = json.loads(formatter.format(record))
    assert payload["request_id"] == "request-2"
    assert payload["run_id"] == "run-2"
    assert payload["thread_id"] == "thread-2"
    assert payload["status_code"] == 200


def test_configure_logging_is_idempotent() -> None:
    configure_logging("INFO")
    configure_logging("DEBUG")
    root_logger = logging.getLogger()
    assert root_logger.level == logging.DEBUG
    assert len(root_logger.handlers) == 1


def test_event_loop_policy_is_psycopg_compatible_on_windows() -> None:
    configure_event_loop_policy()
    if sys.platform == "win32":
        assert isinstance(asyncio.get_event_loop_policy(), asyncio.WindowsSelectorEventLoopPolicy)
