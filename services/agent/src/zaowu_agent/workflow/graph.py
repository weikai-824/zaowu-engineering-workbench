"""Construction of the durable repair StateGraph."""

from collections.abc import Awaitable, Callable
from typing import Any, overload

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime

from zaowu_agent.workflow.nodes import (
    approval_node,
    canceled_node,
    clarification_node,
    executor_node,
    failed_node,
    load_context_node,
    planner_node,
    replanner_node,
    route_after_approval,
    route_after_clarification,
    route_after_context,
    route_after_planner,
    route_after_replanner,
    route_after_verifier,
    succeeded_node,
    tool_wait_node,
    verifier_node,
)
from zaowu_agent.workflow.state import RepairState, RepairWorkflowContext

RepairGraph = CompiledStateGraph[
    RepairState,
    RepairWorkflowContext,
    RepairState,
    RepairState,
]


@overload
def create_repair_graph_builder(
    *, runtime_context: None = None
) -> StateGraph[RepairState, RepairWorkflowContext, RepairState, RepairState]: ...


@overload
def create_repair_graph_builder(
    *, runtime_context: RepairWorkflowContext
) -> StateGraph[RepairState, None, RepairState, RepairState]: ...


def create_repair_graph_builder(
    *, runtime_context: RepairWorkflowContext | None = None
) -> StateGraph[RepairState, Any, RepairState, RepairState]:
    """Define the shared workflow topology for production and Studio.

    Production supplies runtime dependencies on every invocation. The Studio
    adapter binds the same dependencies into node wrappers so Agent Server can
    expose a JSON-compatible graph schema without serializing live clients.
    """
    runtime_node = Callable[..., Awaitable[dict[str, object]]]
    load_context_handler: runtime_node
    planner_handler: runtime_node
    executor_handler: runtime_node
    replanner_handler: runtime_node
    if runtime_context is None:
        builder = StateGraph(RepairState, context_schema=RepairWorkflowContext)
        load_context_handler = load_context_node
        planner_handler = planner_node
        executor_handler = executor_node
        replanner_handler = replanner_node
    else:
        runtime = Runtime(context=runtime_context)

        async def studio_load_context(state: RepairState) -> dict[str, object]:
            return await load_context_node(state, runtime)

        async def studio_planner(state: RepairState) -> dict[str, object]:
            return await planner_node(state, runtime)

        async def studio_executor(state: RepairState) -> dict[str, object]:
            return await executor_node(state, runtime)

        async def studio_replanner(state: RepairState) -> dict[str, object]:
            return await replanner_node(state, runtime)

        load_context_handler = studio_load_context
        planner_handler = studio_planner
        executor_handler = studio_executor
        replanner_handler = studio_replanner
        builder = StateGraph(RepairState)

    builder.add_node("load_context", load_context_handler)
    builder.add_node("planner", planner_handler)
    builder.add_node("clarification", clarification_node)
    builder.add_node("approval", approval_node)
    builder.add_node("executor", executor_handler)
    builder.add_node("verifier", verifier_node)
    builder.add_node("tool_wait", tool_wait_node)
    builder.add_node("replanner", replanner_handler)
    builder.add_node("succeeded", succeeded_node)
    builder.add_node("failed", failed_node)
    builder.add_node("canceled", canceled_node)

    builder.add_edge(START, "load_context")
    builder.add_conditional_edges("load_context", route_after_context)
    builder.add_conditional_edges("planner", route_after_planner)
    builder.add_conditional_edges("clarification", route_after_clarification)
    builder.add_conditional_edges("approval", route_after_approval)
    builder.add_edge("executor", "verifier")
    builder.add_conditional_edges("verifier", route_after_verifier)
    builder.add_edge("tool_wait", "executor")
    builder.add_conditional_edges("replanner", route_after_replanner)
    builder.add_edge("succeeded", END)
    builder.add_edge("failed", END)
    builder.add_edge("canceled", END)
    return builder


def build_repair_graph(checkpointer: BaseCheckpointSaver[str]) -> RepairGraph:
    """Compile the production graph with its durable PostgreSQL checkpointer."""
    return create_repair_graph_builder().compile(
        checkpointer=checkpointer,
        name="zaowu_repair_workflow",
    )
