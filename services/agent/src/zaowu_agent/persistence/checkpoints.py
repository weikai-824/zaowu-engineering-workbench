"""PostgreSQL lifecycle for LangGraph checkpoints."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Protocol

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from psycopg import AsyncConnection, Error
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool

from zaowu_agent.core.config import Settings

logger = logging.getLogger(__name__)


class CheckpointRuntime(Protocol):
    """Resources required by a compiled LangGraph and readiness checks."""

    @property
    def checkpointer(self) -> BaseCheckpointSaver[str]:
        """Return the checkpointer passed to `StateGraph.compile`."""

    async def is_ready(self) -> bool:
        """Return whether PostgreSQL can serve checkpoint operations."""


class PostgresCheckpointRuntime:
    """Own the PostgreSQL pool and the official asynchronous checkpointer."""

    def __init__(
        self,
        pool: AsyncConnectionPool[AsyncConnection[DictRow]],
        checkpointer: AsyncPostgresSaver,
    ) -> None:
        self._pool = pool
        self._checkpointer = checkpointer

    @property
    def checkpointer(self) -> BaseCheckpointSaver[str]:
        """Return the initialized LangGraph checkpointer."""
        return self._checkpointer

    async def is_ready(self) -> bool:
        """Execute a bounded database round trip for readiness."""
        try:
            async with self._pool.connection() as connection:
                cursor = await connection.execute("SELECT 1 AS ready")
                row = await cursor.fetchone()
                return row is not None and row["ready"] == 1
        except Error:
            logger.exception("checkpoint_database_readiness_failed")
            return False


@asynccontextmanager
async def open_postgres_checkpoints(settings: Settings) -> AsyncIterator[CheckpointRuntime]:
    """Open, initialize and close the PostgreSQL checkpoint resources."""
    pool = AsyncConnectionPool[AsyncConnection[DictRow]](
        conninfo=settings.database_connection_string,
        min_size=settings.database_pool_min_size,
        max_size=settings.database_pool_max_size,
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,
            "row_factory": dict_row,
        },
        open=False,
        timeout=settings.database_connect_timeout_seconds,
    )
    await pool.open(wait=True, timeout=settings.database_connect_timeout_seconds)
    serializer = JsonPlusSerializer(allowed_msgpack_modules=None)
    checkpointer = AsyncPostgresSaver(conn=pool, serde=serializer)
    try:
        if settings.checkpoint_auto_setup:
            await checkpointer.setup()
        yield PostgresCheckpointRuntime(pool=pool, checkpointer=checkpointer)
    finally:
        await pool.close()
