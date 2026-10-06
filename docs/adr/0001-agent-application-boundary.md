# ADR-0001：Agent 应用边界与编排范式

- 状态：Accepted
- 日期：2026-09-21

## Context

造物工程台已经拥有项目、3D 生成、模型校验、本机 CAD 执行和制造证据链。新增 Agent 的价值在于协调这些长时、异步、可能失败且需要人工确认的动作，而不是替代已经稳定的业务代码。项目的求职方向是 Python Agent 应用开发，不是 TypeScript 全栈 Agent，也不是多 Agent 研究平台。

## Decision

1. 使用一个 LangGraph 状态图实现 Planner–Executor–Verifier–Replanner。
2. ReAct 仅作为 Planner/Replanner 节点内部的有界策略；全局流程由显式状态和确定性边控制。
3. Python/FastAPI 服务拥有 Agent run 生命周期，PostgreSQL 保存 checkpoint、approval 与 Agent 审计。
4. TypeScript 应用继续拥有业务数据与副作用，通过 allow-list Tool Gateway 暴露能力。
5. 所有高成本、高风险或不可轻易撤销的工具调用都必须经过审批、幂等和验证边界。
6. 不引入多 Agent swarm、A2A、角色扮演式协作或新的业务数据库迁移。

## Why not pure ReAct

纯 ReAct 适合短回合、低风险的探索式工具调用，但不适合作为跨页面关闭、外部任务等待、人工审批和失败恢复的全局控制器。显式状态图能给每个节点定义输入输出、重试策略、预算、checkpoint 与终止条件，更符合本项目的工程可靠性目标。

## Consequences

- 优点：状态可恢复、路径可测试、审批可插入、失败可分类、简历能力与 Python Agent 岗位直接对应。
- 代价：需要维护跨语言工具契约与两个持久化边界；本地开发需要 PostgreSQL。
- 约束：Agent 不得直接访问 D1/R2/Tripo；任何例外都必须新增 ADR 并给出安全与一致性理由。
