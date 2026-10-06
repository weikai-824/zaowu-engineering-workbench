export type AgentRunStatus =
  | "pending"
  | "loading_context"
  | "planning"
  | "waiting_for_clarification"
  | "waiting_for_approval"
  | "executing"
  | "waiting_for_tool"
  | "verifying"
  | "replanning"
  | "failed"
  | "canceled"
  | "succeeded";

export type TimelineEvent = {
  sequence: number;
  phase: AgentRunStatus;
  kind: string;
  message: string;
  created_at: string;
  details: Record<string, unknown>;
};

export type AgentRunPresentationSource = {
  run_id: string;
  status: AgentRunStatus;
  project_revision: number;
  current_revision: number;
  plan: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
  pending_action: "clarification" | "approval" | "tool_wait" | null;
  failure: Record<string, unknown> | null;
  final_asset_ids: string[];
  tool_call_count: number;
  replan_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowStageId = "selection" | "planning" | "approval" | "execution" | "verification" | "result";
export type WorkflowStageState = "pending" | "running" | "action" | "done" | "retry" | "failed" | "canceled";

export type WorkflowFact = {
  label: string;
  value: string;
};

export type WorkflowStage = {
  id: WorkflowStageId;
  index: number;
  title: string;
  description: string;
  state: WorkflowStageState;
  stateLabel: string;
  durationMs: number;
  durationKind: "elapsed" | "waiting";
  input: WorkflowFact[];
  output: WorkflowFact[];
  error: string | null;
  eventCount: number;
};

export type ToolAttempt = {
  sequence: number;
  ordinal: number;
  tool: string;
  label: string;
  description: string;
  outcome: string;
  outcomeLabel: string;
  verificationOutcome: string | null;
  verificationLabel: string | null;
  message: string;
  idempotencyKey: string | null;
  planVersion: number | null;
  stepId: string | null;
  toolIndex: number | null;
  executionDurationMs: number;
  verificationDurationMs: number;
  startedAt: string;
  completedAt: string;
  tone: "pending" | "success" | "warning" | "failed";
};

export type WorkflowException = {
  key: string;
  label: string;
  message: string;
  count: number;
  createdAt: string;
  tone: "info" | "warning" | "danger" | "neutral";
};

export type AgentRunPresentation = {
  stages: WorkflowStage[];
  focusStageId: WorkflowStageId;
  events: TimelineEvent[];
  invalidEventCount: number;
  toolAttempts: ToolAttempt[];
  exceptions: WorkflowException[];
};

const RUN_STATUSES = new Set<AgentRunStatus>([
  "pending",
  "loading_context",
  "planning",
  "waiting_for_clarification",
  "waiting_for_approval",
  "executing",
  "waiting_for_tool",
  "verifying",
  "replanning",
  "failed",
  "canceled",
  "succeeded",
]);

const STAGE_META: Record<WorkflowStageId, Pick<WorkflowStage, "index" | "title" | "description">> = {
  selection: {
    index: 1,
    title: "理解圈选",
    description: "绑定三维定位、视角和工程版本，并读取可验证的项目上下文。",
  },
  planning: {
    index: 2,
    title: "生成方案",
    description: "Planner 根据圈选反馈、工程约束和现有证据生成结构化返工计划。",
  },
  approval: {
    index: 3,
    title: "人工确认",
    description: "在产生任何工程副作用前，由用户批准、驳回或要求重规划。",
  },
  execution: {
    index: 4,
    title: "执行修改",
    description: "Executor 按批准的计划调用受控工具，并归档新模型与版本。",
  },
  verification: {
    index: 5,
    title: "安全校验",
    description: "Verifier 对每次工具结果做确定性检查，只有证据完整时才允许继续。",
  },
  result: {
    index: 6,
    title: "载入新模型",
    description: "确认新版本和模型资产已经归档，再把结果载入当前工程。",
  },
};

const STAGE_STATE_LABEL: Record<WorkflowStageState, string> = {
  pending: "未开始",
  running: "进行中",
  action: "等待操作",
  done: "已完成",
  retry: "重试中",
  failed: "失败",
  canceled: "已取消",
};

const TOOL_META: Record<string, { label: string; description: string }> = {
  apply_design_change: { label: "应用设计变更", description: "以目标 revision 为前提写入受控参数变更。" },
  create_cad_job: { label: "创建 CAD 任务", description: "为本次计划建立可追踪、幂等的计算任务。" },
  start_cad_execution: { label: "启动本机执行", description: "把任务交给已配对的本机 CAD 执行器。" },
  poll_cad_execution: { label: "查询执行进度", description: "使用同一幂等键等待或读取本机计算结果。" },
  attach_cad_result: { label: "归档 CAD 结果", description: "核验执行签名和文件哈希后归档输出资产。" },
  verify_revision: { label: "验证工程版本", description: "核对新版本、资产来源和数字检查证据。" },
  apply_visual_edit: { label: "圈选区域改形", description: "只修改圈选范围内的网格顶点，并保留原件。" },
  verify_visual_revision: { label: "验证外观版本", description: "核对新版本、来源记录与模型哈希。" },
};

const EVENT_LABELS: Record<string, string> = {
  run_created: "任务已创建",
  context_loaded: "工程上下文已载入",
  context_load_failed: "工程上下文读取失败",
  context_rejected: "工程上下文不匹配",
  planning_retry_scheduled: "Planner 自动重试",
  planning_failed: "方案生成失败",
  clarification_requested: "需要补充工程信息",
  clarification_received: "已收到补充信息",
  plan_ready: "返工方案已生成",
  plan_approved: "方案已批准",
  plan_change_requested: "已要求重规划",
  plan_rejected: "方案已驳回",
  tool_result_received: "工具结果已回传",
  tool_result_verified: "工具结果已校验",
  tool_status_check_requested: "已检查本机执行进度",
  replanning_retry_scheduled: "Replanner 自动重试",
  replanning_failed: "重规划失败",
  revised_plan_ready: "修订方案已生成",
  replan_budget_exhausted: "重规划次数已用尽",
  model_budget_exhausted: "模型预算已用尽",
  engineering_review_required: "需要工程师处理",
  run_succeeded: "返工闭环已完成",
  run_failed: "返工任务失败",
  run_canceled: "返工任务已取消",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function eventTime(event: TimelineEvent): number {
  const value = Date.parse(event.created_at);
  return Number.isFinite(value) ? value : 0;
}

function detailString(event: TimelineEvent | undefined, key: string): string | null {
  return event ? stringValue(event.details[key]) : null;
}

function detailNumber(event: TimelineEvent | undefined, key: string): number | null {
  return event ? numberValue(event.details[key]) : null;
}

function parseTimelineEvent(value: Record<string, unknown>): TimelineEvent | null {
  const sequence = numberValue(value.sequence);
  const phase = stringValue(value.phase);
  const kind = stringValue(value.kind);
  const message = stringValue(value.message);
  const createdAt = stringValue(value.created_at);
  const details = value.details;
  if (
    sequence === null ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    phase === null ||
    !RUN_STATUSES.has(phase as AgentRunStatus) ||
    kind === null ||
    message === null ||
    createdAt === null ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !isRecord(details)
  ) {
    return null;
  }
  return { sequence, phase: phase as AgentRunStatus, kind, message, created_at: createdAt, details };
}

export function parseTimelineEvents(values: Array<Record<string, unknown>>): TimelineEvent[] {
  return values
    .map(parseTimelineEvent)
    .filter((event): event is TimelineEvent => event !== null)
    .sort((left, right) => left.sequence - right.sequence || eventTime(left) - eventTime(right));
}

export function eventKindLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind.replaceAll("_", " ");
}

export function formatWorkflowDuration(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  if (safe < 1_000) return "< 1 秒";
  const seconds = Math.floor(safe / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
}

function latestEvent(events: TimelineEvent[], predicate: (event: TimelineEvent) => boolean): TimelineEvent | undefined {
  return [...events].reverse().find(predicate);
}

function latestKind(events: TimelineEvent[], ...kinds: string[]): TimelineEvent | undefined {
  const accepted = new Set(kinds);
  return latestEvent(events, (event) => accepted.has(event.kind));
}

function sequenceOf(event: TimelineEvent | undefined): number {
  return event?.sequence ?? -1;
}

function stageAfterEvent(event: TimelineEvent): WorkflowStageId {
  if (event.kind === "run_created") return "selection";
  if (event.kind === "context_loaded" || event.kind === "clarification_received" || event.kind === "plan_change_requested") return "planning";
  if (event.kind === "plan_ready" || event.kind === "revised_plan_ready") return "approval";
  if (event.kind === "plan_approved" || event.kind === "tool_status_check_requested") return "execution";
  if (event.kind === "tool_result_received") return "verification";
  if (event.kind === "tool_result_verified") {
    const outcome = detailString(event, "outcome");
    if (outcome === "replan") return "planning";
    if (outcome === "succeeded") return "result";
    return outcome === "failed" ? "verification" : "execution";
  }
  if (event.kind === "clarification_requested" || event.kind.includes("planning") || event.kind.includes("replan") || event.kind === "engineering_review_required" || event.kind === "model_budget_exhausted") return "planning";
  if (event.kind === "plan_rejected" || event.kind === "run_canceled") return "approval";
  if (event.kind === "run_succeeded") return "result";
  if (event.kind.startsWith("context_")) return "selection";
  if (event.phase === "pending" || event.phase === "loading_context") return "selection";
  if (event.phase === "planning" || event.phase === "replanning" || event.phase === "waiting_for_clarification") return "planning";
  if (event.phase === "waiting_for_approval" || event.phase === "canceled") return "approval";
  if (event.phase === "executing" || event.phase === "waiting_for_tool") return "execution";
  if (event.phase === "verifying" || event.phase === "failed") return "verification";
  return "result";
}

function stageDurations(events: TimelineEvent[], run: AgentRunPresentationSource, now: number): Record<WorkflowStageId, number> {
  const durations: Record<WorkflowStageId, number> = { selection: 0, planning: 0, approval: 0, execution: 0, verification: 0, result: 0 };
  const terminal = run.status === "succeeded" || run.status === "failed" || run.status === "canceled";
  const updatedAt = Date.parse(run.updated_at);
  const boundary = terminal && Number.isFinite(updatedAt) ? updatedAt : now;
  events.forEach((event, index) => {
    const start = eventTime(event);
    const next = events[index + 1];
    const end = next ? eventTime(next) : boundary;
    if (!start || !end || end < start) return;
    durations[stageAfterEvent(event)] += end - start;
  });
  return durations;
}

function failureMessage(run: AgentRunPresentationSource): string | null {
  return isRecord(run.failure) ? stringValue(run.failure.message) : null;
}

function failureCode(run: AgentRunPresentationSource): string {
  return (isRecord(run.failure) ? stringValue(run.failure.code) : null) ?? "";
}

function inferFailureStage(run: AgentRunPresentationSource, events: TimelineEvent[]): WorkflowStageId | null {
  if (run.status !== "failed") return null;
  const code = failureCode(run);
  if (code.includes("context") || code.includes("project_revision")) return "selection";
  if (code.includes("planning") || code.includes("replan") || code.includes("model_budget") || code.includes("engineering_review") || code.includes("safe_executable")) return "planning";
  if (code.includes("tool_gateway") || code.includes("tool_budget") || code.includes("run_age") || code.includes("execution")) return "execution";
  if (code.includes("verification") || code.includes("cursor") || code.includes("evidence")) return "verification";
  const last = latestEvent(events, (event) => event.kind !== "run_failed");
  if (!last) return "selection";
  if (last.kind.startsWith("context_")) return "selection";
  if (last.kind.includes("planning") || last.kind.includes("replan") || last.kind === "engineering_review_required") return "planning";
  if (last.kind.startsWith("plan_")) return "approval";
  if (last.kind === "tool_result_received") return detailString(last, "outcome") === "failed" ? "execution" : "verification";
  return stageAfterEvent(last);
}

function parsePlan(run: AgentRunPresentationSource): {
  version: number | null;
  summary: string | null;
  stepCount: number;
  riskCount: number;
} {
  const plan = run.plan;
  return {
    version: plan ? numberValue(plan.version) : null,
    summary: plan ? stringValue(plan.summary) : null,
    stepCount: plan && Array.isArray(plan.steps) ? plan.steps.length : 0,
    riskCount: plan && Array.isArray(plan.risk_flags) ? plan.risk_flags.length : 0,
  };
}

function outcomeLabel(outcome: string | null): string {
  return (
    {
      succeeded: "已成功",
      pending: "等待中",
      failed: "失败",
      continue: "继续执行",
      wait: "等待本机",
      replan: "需要重规划",
    } as Record<string, string>
  )[outcome ?? ""] ?? (outcome || "已返回");
}

function toolAttempts(events: TimelineEvent[]): ToolAttempt[] {
  const receivedEvents = events.filter((event) => event.kind === "tool_result_received");
  return receivedEvents.map((received, ordinal) => {
    const position = events.findIndex((event) => event.sequence === received.sequence);
    const nextReceivedSequence = receivedEvents[ordinal + 1]?.sequence ?? Number.POSITIVE_INFINITY;
    const verified = events.find(
      (event) => event.sequence > received.sequence && event.sequence < nextReceivedSequence && event.kind === "tool_result_verified",
    );
    const prior = position > 0 ? events[position - 1] : received;
    const tool = detailString(received, "tool") ?? "unknown_tool";
    const meta = TOOL_META[tool] ?? { label: tool.replaceAll("_", " "), description: "受控工程工具调用。" };
    const outcome = detailString(received, "outcome") ?? "unknown";
    const verificationOutcome = detailString(verified, "outcome");
    const idempotencyKey = detailString(received, "idempotency_key");
    const idempotencyParts = idempotencyKey?.match(/:plan:(\d+):step:([^:]+):tool:(\d+)$/);
    const planVersion = detailNumber(received, "plan_version") ?? (idempotencyParts ? Number(idempotencyParts[1]) : null);
    const stepId = detailString(received, "step_id") ?? idempotencyParts?.[2] ?? null;
    const toolIndex = detailNumber(received, "tool_index") ?? (idempotencyParts ? Number(idempotencyParts[3]) : null);
    const executionDurationMs = Math.max(0, eventTime(received) - eventTime(prior));
    const verificationDurationMs = verified ? Math.max(0, eventTime(verified) - eventTime(received)) : 0;
    const failed = outcome === "failed" || verificationOutcome === "failed";
    const warning = outcome === "pending" || verificationOutcome === "wait" || verificationOutcome === "replan";
    return {
      sequence: received.sequence,
      ordinal: ordinal + 1,
      tool,
      label: meta.label,
      description: meta.description,
      outcome,
      outcomeLabel: outcomeLabel(outcome),
      verificationOutcome,
      verificationLabel: verificationOutcome ? outcomeLabel(verificationOutcome) : null,
      message: verified?.message ?? received.message,
      idempotencyKey,
      planVersion,
      stepId,
      toolIndex,
      executionDurationMs,
      verificationDurationMs,
      startedAt: prior.created_at,
      completedAt: (verified ?? received).created_at,
      tone: failed ? "failed" : warning ? "warning" : verified ? "success" : "pending",
    };
  });
}

function workflowExceptions(events: TimelineEvent[]): WorkflowException[] {
  const grouped = new Map<string, WorkflowException>();
  const add = (key: string, label: string, event: TimelineEvent, tone: WorkflowException["tone"]) => {
    const current = grouped.get(key);
    grouped.set(key, {
      key,
      label,
      message: event.message,
      count: (current?.count ?? 0) + 1,
      createdAt: event.created_at,
      tone,
    });
  };
  events.forEach((event) => {
    const outcome = detailString(event, "outcome");
    if (event.kind === "clarification_requested") add("clarification", "等待补充工程信息", event, "warning");
    else if (event.kind === "planning_retry_scheduled" || event.kind === "replanning_retry_scheduled") add("planner-retry", "模型输出自动重试", event, "info");
    else if (event.kind === "plan_change_requested") add("plan-change", "人工要求重规划", event, "info");
    else if (event.kind === "plan_rejected") add("plan-rejected", "方案被人工驳回", event, "neutral");
    else if (event.kind === "tool_result_received" && outcome === "pending") add("tool-wait", "等待本机 CAD", event, "warning");
    else if (event.kind === "tool_result_received" && outcome === "failed") add(`tool-failed:${detailString(event, "tool") ?? "unknown"}`, "工程工具返回失败", event, "danger");
    else if (event.kind === "tool_result_verified" && outcome === "replan") add("verification-replan", "校验触发重规划", event, "warning");
    else if (event.kind === "tool_result_verified" && outcome === "failed") add("verification-failed", "确定性校验失败", event, "danger");
    else if (event.kind.endsWith("_failed") || event.kind.includes("budget_exhausted") || event.kind === "engineering_review_required") add(event.kind, eventKindLabel(event.kind), event, "danger");
  });
  return [...grouped.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function focusStage(run: AgentRunPresentationSource, failedStage: WorkflowStageId | null): WorkflowStageId {
  if (failedStage) return failedStage;
  if (run.status === "waiting_for_approval") return "approval";
  if (run.status === "waiting_for_clarification" || run.status === "planning" || run.status === "replanning") return "planning";
  if (run.status === "executing" || run.status === "waiting_for_tool") return "execution";
  if (run.status === "verifying") return "verification";
  if (run.status === "succeeded") return "result";
  if (run.status === "canceled") return "approval";
  return "selection";
}

export function buildAgentRunPresentation(run: AgentRunPresentationSource, now = Date.now()): AgentRunPresentation {
  const events = parseTimelineEvents(run.events);
  const invalidEventCount = run.events.length - events.length;
  const durations = stageDurations(events, run, now);
  const plan = parsePlan(run);
  const attempts = toolAttempts(events);
  const failedStage = inferFailureStage(run, events);
  const error = failureMessage(run);
  const contextLoaded = latestKind(events, "context_loaded");
  const planReady = latestKind(events, "plan_ready", "revised_plan_ready");
  const approved = latestKind(events, "plan_approved");
  const planChanged = latestKind(events, "plan_change_requested", "clarification_received");
  const verifierReplan = latestEvent(events, (event) => event.kind === "tool_result_verified" && detailString(event, "outcome") === "replan");
  const replanTriggerSequence = Math.max(sequenceOf(planChanged), sequenceOf(verifierReplan));
  const planIsCurrent = sequenceOf(planReady) > replanTriggerSequence;
  const currentPlanApproved = planIsCurrent && sequenceOf(approved) > sequenceOf(planReady);
  const finalVerification = latestEvent(events, (event) => event.kind === "tool_result_verified" && detailString(event, "outcome") === "succeeded");
  const latestVerification = latestKind(events, "tool_result_verified");
  const latestDecision = latestKind(events, "plan_approved", "plan_change_requested", "plan_rejected");
  const succeeded = run.status === "succeeded" || !!latestKind(events, "run_succeeded");
  const canceled = run.status === "canceled" || !!latestKind(events, "run_canceled");
  const hasExecutionHistory = attempts.length > 0 || !!approved;

  const states: Record<WorkflowStageId, WorkflowStageState> = {
    selection: failedStage === "selection" ? "failed" : contextLoaded ? "done" : "running",
    planning:
      failedStage === "planning"
        ? "failed"
        : run.status === "waiting_for_clarification"
          ? "action"
          : run.status === "planning" || run.status === "replanning"
            ? run.replan_count > 0 ? "retry" : "running"
            : planIsCurrent
              ? "done"
              : contextLoaded
                ? "running"
                : "pending",
    approval:
      canceled
        ? "canceled"
        : failedStage === "approval"
          ? "failed"
          : run.status === "waiting_for_approval"
            ? "action"
            : currentPlanApproved || succeeded
              ? "done"
              : planChanged && sequenceOf(planChanged) > sequenceOf(planReady)
                ? "retry"
                : planReady
                  ? "running"
                  : "pending",
    execution:
      failedStage === "execution"
        ? "failed"
        : succeeded
          ? "done"
          : run.status === "waiting_for_tool"
            ? "action"
            : run.status === "executing"
              ? "running"
              : run.status === "replanning" || (run.status === "waiting_for_approval" && hasExecutionHistory)
                ? "retry"
                : currentPlanApproved
                  ? "running"
                  : "pending",
    verification:
      failedStage === "verification"
        ? "failed"
        : finalVerification || succeeded
          ? "done"
          : run.status === "verifying" || (attempts.length > 0 && run.status !== "canceled" && run.status !== "failed")
            ? "running"
            : "pending",
    result: succeeded ? "done" : "pending",
  };

  const contextRevision = detailNumber(contextLoaded, "project_revision") ?? run.project_revision;
  const latestAttempt = attempts.at(-1);
  const approvalOutput = latestDecision
    ? latestDecision.kind === "plan_approved"
      ? "已批准，允许执行白名单工具"
      : latestDecision.kind === "plan_change_requested"
        ? "已退回 Planner 重规划"
        : "已驳回，未产生后续副作用"
    : "尚未提交人工决定";

  const stageFacts: Record<WorkflowStageId, { input: WorkflowFact[]; output: WorkflowFact[] }> = {
    selection: {
      input: [
        { label: "工程基线", value: `v${run.project_revision}` },
        { label: "用户输入", value: "已提交三维定位与返工建议" },
      ],
      output: contextLoaded
        ? [
            { label: "上下文", value: `已绑定工程 revision v${contextRevision}` },
            { label: "结果", value: "圈选、工程事实与证据已交给 Planner" },
          ]
        : [{ label: "结果", value: "等待读取工程上下文" }],
    },
    planning: {
      input: [
        { label: "输入", value: contextLoaded ? `工程上下文 v${contextRevision} 与用户反馈` : "等待工程上下文" },
        { label: "规划轮次", value: run.replan_count ? `初始方案 + ${run.replan_count} 次重规划` : "初始方案" },
      ],
      output: planReady
        ? [
            { label: "方案", value: plan.summary ?? "结构化返工方案" },
            { label: "规模", value: `v${plan.version ?? "—"} · ${plan.stepCount} 个步骤 · ${plan.riskCount} 个风险提示` },
          ]
        : [{ label: "结果", value: run.status === "waiting_for_clarification" ? "等待补充关键工程事实" : "方案生成中" }],
    },
    approval: {
      input: [{ label: "待审方案", value: plan.version ? `计划 v${plan.version} · ${plan.stepCount} 个步骤` : "等待 Planner 输出" }],
      output: [{ label: "人工决定", value: approvalOutput }],
    },
    execution: {
      input: [
        { label: "执行策略", value: "仅调用 8 类白名单工程工具" },
        { label: "幂等保护", value: "每一步使用稳定幂等键" },
      ],
      output: [
        { label: "调用进度", value: `${run.tool_call_count} 次工具调用已写入 checkpoint` },
        { label: "最近结果", value: latestAttempt ? `${latestAttempt.label}：${latestAttempt.outcomeLabel}` : "尚未调用工程工具" },
      ],
    },
    verification: {
      input: [{ label: "待核对结果", value: `${attempts.length} 条工具回传` }],
      output: [
        { label: "校验次数", value: `${events.filter((event) => event.kind === "tool_result_verified").length} 次确定性校验` },
        { label: "最近结论", value: latestVerification ? `${outcomeLabel(detailString(latestVerification, "outcome"))}：${latestVerification.message}` : "等待工具结果" },
      ],
    },
    result: {
      input: [{ label: "闭环条件", value: "新 revision、资产来源和数字证据全部通过" }],
      output: succeeded
        ? [
            { label: "工程版本", value: `v${run.current_revision}` },
            { label: "模型资产", value: `${run.final_asset_ids.length} 个新资产已归档并可载入` },
          ]
        : [{ label: "结果", value: "等待最终校验通过" }],
    },
  };

  const eventCounts: Record<WorkflowStageId, number> = { selection: 0, planning: 0, approval: 0, execution: 0, verification: 0, result: 0 };
  events.forEach((event) => {
    eventCounts[stageAfterEvent(event)] += 1;
  });

  const stages = (Object.keys(STAGE_META) as WorkflowStageId[]).map((id) => ({
    id,
    ...STAGE_META[id],
    state: states[id],
    stateLabel: STAGE_STATE_LABEL[states[id]],
    durationMs: durations[id],
    durationKind: id === "approval" || (id === "execution" && run.status === "waiting_for_tool") ? "waiting" as const : "elapsed" as const,
    input: stageFacts[id].input,
    output: stageFacts[id].output,
    error: failedStage === id ? error ?? "工作流在此阶段终止。" : null,
    eventCount: eventCounts[id],
  }));

  return {
    stages,
    focusStageId: focusStage(run, failedStage),
    events,
    invalidEventCount,
    toolAttempts: attempts,
    exceptions: workflowExceptions(events),
  };
}
