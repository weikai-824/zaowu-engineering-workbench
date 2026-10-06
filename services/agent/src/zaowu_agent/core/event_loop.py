"""Platform event-loop compatibility required by asynchronous Psycopg."""

import asyncio
import sys
from collections.abc import Callable


def configure_event_loop_policy() -> None:
    """Use the Psycopg-compatible selector loop before Windows creates a loop."""
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def psycopg_event_loop_factory(*, use_subprocess: bool = False) -> asyncio.AbstractEventLoop:
    """Create the loop Uvicorn must use for async Psycopg on Windows."""
    del use_subprocess
    if sys.platform == "win32":
        return asyncio.SelectorEventLoop()
    factory: Callable[[], asyncio.AbstractEventLoop] = asyncio.new_event_loop
    return factory()
