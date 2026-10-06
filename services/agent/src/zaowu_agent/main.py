"""ASGI factory and Psycopg-compatible Uvicorn entry point."""

import argparse
from collections.abc import Sequence

import uvicorn

from zaowu_agent.application import create_app


def main(argv: Sequence[str] | None = None) -> None:
    """Run Uvicorn with an explicit cross-platform async-Psycopg loop factory."""
    parser = argparse.ArgumentParser(description="Run the Zaowu Agent service.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args(argv)
    uvicorn.run(
        "zaowu_agent.main:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        reload=args.reload,
        loop="zaowu_agent.core.event_loop:psycopg_event_loop_factory",
    )


if __name__ == "__main__":
    main()


__all__ = ["create_app", "main"]
