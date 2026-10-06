"""Request and Agent execution identifiers for structured logs."""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace


@dataclass(frozen=True, slots=True)
class LogContext:
    """Identifiers that correlate HTTP, run and LangGraph thread activity."""

    request_id: str = "unbound"
    run_id: str | None = None
    thread_id: str | None = None


_LOG_CONTEXT: ContextVar[LogContext | None] = ContextVar("agent_log_context", default=None)


def get_log_context() -> LogContext:
    """Return the context associated with the current async task."""
    return _LOG_CONTEXT.get() or LogContext()


@contextmanager
def bind_log_context(
    *, request_id: str | None = None, run_id: str | None = None, thread_id: str | None = None
) -> Iterator[LogContext]:
    """Bind correlation identifiers and restore the previous context on exit."""
    current = get_log_context()
    updated = replace(
        current,
        request_id=request_id if request_id is not None else current.request_id,
        run_id=run_id if run_id is not None else current.run_id,
        thread_id=thread_id if thread_id is not None else current.thread_id,
    )
    token = _LOG_CONTEXT.set(updated)
    try:
        yield updated
    finally:
        _LOG_CONTEXT.reset(token)
