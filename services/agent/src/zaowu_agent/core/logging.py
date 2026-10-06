"""JSON logging configured once at the service boundary."""

import json
import logging
from datetime import UTC, datetime

from zaowu_agent.core.context import get_log_context

_STANDARD_LOG_RECORD_FIELDS = frozenset(logging.makeLogRecord({}).__dict__)


class JsonLogFormatter(logging.Formatter):
    """Render logs as one JSON object with correlation identifiers."""

    def format(self, record: logging.LogRecord) -> str:
        context = get_log_context()
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": context.request_id,
        }
        if context.run_id is not None:
            payload["run_id"] = context.run_id
        if context.thread_id is not None:
            payload["thread_id"] = context.thread_id
        for key, value in record.__dict__.items():
            if key not in _STANDARD_LOG_RECORD_FIELDS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str, separators=(",", ":"))


def configure_logging(level: str) -> None:
    """Install the service JSON formatter without duplicating handlers."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(level)
