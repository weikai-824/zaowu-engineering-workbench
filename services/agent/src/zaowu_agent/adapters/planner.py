"""LangChain structured-output implementation of Planner and Replanner."""

import json
import os
from typing import cast

import certifi
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ContentBlock, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from zaowu_agent.core.config import Settings
from zaowu_agent.domain.repair import (
    ModelUsage,
    PlannedRepair,
    ProjectContext,
    RepairBudget,
    RepairPlan,
    RepairRequest,
    VerificationResult,
)
from zaowu_agent.ports.repair import PlannerOutputError

_SYSTEM_PROMPT = """You are the planning component of an engineering repair Agent.
Return only a RepairPlan that matches the supplied schema. You plan; you never execute tools.

The global workflow is Planner -> human approval -> Executor -> deterministic Verifier ->
Replanner. Do not collapse those responsibilities. Executable actions are
change_cad_parameters, create_cad_design, and change_visual_mesh. Use change_visual_mesh only
for a selected Tripo or previously region-edited visual reference with a captured worldPath and
normal. It changes mesh vertices inside the selected region while keeping the source revision.
Use needs_engineering_review with disposition human_required if the requested shape needs new
topology, holes, added parts, semantic regeneration, unknown dimensions, or a locked interface
would change. Never imply that a visual mesh edit yields manufacturing-ready geometry.

The screen-space region identifies intent but does not prove hidden geometry or dimensions.
Never claim that a screenshot proves wall thickness, topology, manufacturability, slicing, or
physical validation. Preserve locked interfaces. Use only IDs and current evidence present in
the supplied context. Keep the plan within the supplied step and tool budgets. Each executable
step must have measurable success criteria and concrete parameters. A revised plan must address
the supplied verifier or human feedback and increment the plan version exactly once.
For visual mesh edits, success criteria may only claim bounded vertex movement inside the region,
preservation of the unselected vertices, source-asset lineage, file hash integrity, and creation
of a new version. The controlled tools do not check self-intersections, wall thickness,
manufacturability, or unchanged global bounding dimensions, so never list these as passed
criteria. The same captured region may be edited only once per plan.

For change_cad_parameters, part_id and design_id are required and parameters must contain only
existing unlocked CAD parameter names mapped directly to finite numeric target values. Do not
nest those values. For create_cad_design, parameters must contain exactly one design_spec value
that conforms to the product's cad-plan-v1 schema supplied in context; otherwise choose
needs_engineering_review. Never invent IDs, parameter names, evidence, or tool results.
For change_visual_mesh, part_id must match the selected visual part, design_id must be null, and
parameters must contain operation (offset, flatten, or translate), amount_mm, falloff_mm, and
depth_mm. Translate also requires direction as a three-number world-space vector. Amount is a
signed displacement along the captured normal for offset and flatten. Pick conservative numeric
values from the user's request; if a necessary dimension is missing, ask for clarification.
"""


class LangChainRepairPlanner:
    """Use an OpenAI-compatible chat model through LangChain structured output."""

    def __init__(
        self,
        model: BaseChatModel,
        *,
        input_cost_per_million_usd: float = 0,
        output_cost_per_million_usd: float = 0,
    ) -> None:
        self._system_prompt = (
            _SYSTEM_PROMPT
            + "\nThe exact RepairPlan JSON Schema is:\n"
            + json.dumps(RepairPlan.model_json_schema(), ensure_ascii=False, separators=(",", ":"))
        )
        self._structured_model = model.with_structured_output(
            RepairPlan,
            method="json_mode",
            include_raw=True,
        )
        self._input_cost = input_cost_per_million_usd
        self._output_cost = output_cost_per_million_usd

    async def _invoke(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        budget: RepairBudget,
        annotation_image_data_url: str | None,
        previous_plan: RepairPlan | None = None,
        verification: VerificationResult | None = None,
        human_feedback: str | None = None,
    ) -> PlannedRepair:
        payload = {
            "request": request.model_dump(mode="json", by_alias=True),
            "project_context": context.model_dump(mode="json"),
            "budget": budget.model_dump(mode="json"),
            "expected_plan_version": 1 if previous_plan is None else previous_plan.version + 1,
            "previous_plan": previous_plan.model_dump(mode="json") if previous_plan else None,
            "verification": verification.model_dump(mode="json") if verification else None,
            "human_feedback": human_feedback,
        }
        content: list[ContentBlock] = [
            {
                "type": "text",
                "text": (
                    "Produce the bounded repair plan from this JSON context:\n"
                    + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                ),
            }
        ]
        if annotation_image_data_url:
            content.append(
                {
                    "type": "image",
                    "url": annotation_image_data_url,
                }
            )
        response = cast(
            dict[str, object],
            await self._structured_model.ainvoke(
                [
                    SystemMessage(content=self._system_prompt),
                    HumanMessage(content_blocks=content),
                ]
            ),
        )
        raw = response.get("raw")
        if not isinstance(raw, AIMessage) or raw.usage_metadata is None:
            raise ValueError("model response did not include token usage metadata")
        input_tokens = raw.usage_metadata["input_tokens"]
        output_tokens = raw.usage_metadata["output_tokens"]
        total_tokens = raw.usage_metadata["total_tokens"]
        estimated_cost = (
            input_tokens * self._input_cost + output_tokens * self._output_cost
        ) / 1_000_000
        usage = ModelUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            estimated_cost_usd=estimated_cost,
        )
        parsing_error = response.get("parsing_error")
        if parsing_error is not None:
            raise PlannerOutputError(
                message=(
                    f"model returned an invalid structured plan: {type(parsing_error).__name__}"
                ),
                usage=usage,
            )
        parsed = response.get("parsed")
        plan = parsed if isinstance(parsed, RepairPlan) else RepairPlan.model_validate(parsed)
        return PlannedRepair(
            plan=plan,
            usage=usage,
        )

    async def create_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        """Create the first structured plan."""
        return await self._invoke(
            request=request,
            context=context,
            budget=budget,
            annotation_image_data_url=annotation_image_data_url,
        )

    async def revise_plan(
        self,
        *,
        request: RepairRequest,
        context: ProjectContext,
        previous_plan: RepairPlan,
        verification: VerificationResult | None,
        human_feedback: str | None,
        annotation_image_data_url: str | None,
        budget: RepairBudget,
    ) -> PlannedRepair:
        """Create a new plan version from explicit feedback."""
        return await self._invoke(
            request=request,
            context=context,
            budget=budget,
            annotation_image_data_url=annotation_image_data_url,
            previous_plan=previous_plan,
            verification=verification,
            human_feedback=human_feedback,
        )


def create_langchain_planner(settings: Settings) -> LangChainRepairPlanner:
    """Build the configured OpenAI-compatible LangChain planner."""
    if not settings.model_api_key or not settings.model_base_url or not settings.model_name:
        raise ValueError("repair model configuration is incomplete")
    # OpenAI SDK 3 uses httpx2, whose Windows truststore backend can crash while
    # validating some provider certificates. An explicit Mozilla CA bundle keeps
    # TLS verification enabled while avoiding that native Windows code path.
    if os.name == "nt":
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    base_url = str(settings.model_base_url)
    extra_body: dict[str, object] | None = None
    if "maas.aliyuncs.com" in base_url and settings.model_name.startswith("qwen"):
        # Qwen's non-thinking path is faster and more reliable for strict JSON
        # planning output; the deterministic verifier still owns all safety checks.
        extra_body = {"enable_thinking": False}
    model = ChatOpenAI(
        api_key=settings.model_api_key,
        base_url=base_url,
        model=settings.model_name,
        temperature=0.1,
        timeout=settings.model_timeout_seconds,
        max_completion_tokens=settings.model_max_output_tokens,
        max_retries=0,
        extra_body=extra_body,
    )
    return LangChainRepairPlanner(
        model,
        input_cost_per_million_usd=settings.model_input_cost_per_million_usd,
        output_cost_per_million_usd=settings.model_output_cost_per_million_usd,
    )
