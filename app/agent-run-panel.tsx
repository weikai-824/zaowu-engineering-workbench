'use client';

import {useState} from 'react';
import {AlertTriangle,Check,Clock3,RefreshCw,ShieldCheck,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import AgentRunGraph from './agent-run-graph';
import {eventKindLabel,parseTimelineEvents,type AgentRunStatus} from '@/lib/agent-run-presentation';

export type AgentRun={
 run_id:string;
 thread_id:string;
 status:AgentRunStatus;
 project_id:string;
 project_revision:number;
 current_revision:number;
 plan:Record<string,unknown>|null;
 events:Array<Record<string,unknown>>;
 pending_action:'clarification'|'approval'|'tool_wait'|null;
 failure:Record<string,unknown>|null;
 final_asset_ids:string[];
 tool_call_count:number;
 replan_count:number;
 model_input_tokens:number;
 model_output_tokens:number;
 estimated_cost_usd:number;
 created_at:string;
 updated_at:string;
};

type Props={run:AgentRun;disabled:boolean;onClarify:(answers:string[])=>void;onDecision:(choice:'approve'|'reject'|'modify',feedback?:string)=>void;onContinue:()=>void;onRefresh:()=>void;onReset:()=>void;onShowResult:()=>void};
const statusLabel:Record<AgentRun['status'],string>={pending:'准备中',loading_context:'读取工程上下文',planning:'Planner 正在规划',waiting_for_clarification:'等待补充信息',waiting_for_approval:'等待人工审批',executing:'Executor 正在执行',waiting_for_tool:'等待本机 CAD',verifying:'Verifier 正在验证',replanning:'Replanner 正在重规划',failed:'任务失败',canceled:'已取消',succeeded:'返工完成'};
const actionLabel:Record<string,string>={change_cad_parameters:'修改 CAD 参数',create_cad_design:'创建受控 CAD 设计',change_visual_mesh:'圈选区域改形',needs_engineering_review:'需要工程师处理'};

export default function AgentRunPanel({run,disabled,onClarify,onDecision,onContinue,onRefresh,onReset,onShowResult}:Props){
 const[feedback,setFeedback]=useState('');
 const[clarificationAnswers,setClarificationAnswers]=useState<Record<string,string>>({});
 const plan=run.plan as {version?:number;summary?:string;rationale?:string;questions?:string[];risk_flags?:string[];steps?:Array<{id?:string;action?:string;reason?:string;parameters?:Record<string,unknown>;success_criteria?:string[]}>}|null;
 const visualEdit=plan?.steps?.some(step=>step.action==='change_visual_mesh')??false;
 const questions=plan?.questions??[];
 const answerKey=(index:number)=>`${run.run_id}:${plan?.version??0}:${index}`;
 const failure=typeof run.failure?.message==='string'?run.failure.message:null;
 const timeline=parseTimelineEvents(run.events);
 const terminal=run.status==='succeeded'||run.status==='failed'||run.status==='canceled';
 const needsAttention=run.pending_action==='approval'||run.pending_action==='clarification';
 return <section className={'agent-run-panel '+run.status} aria-live="polite">
  <header className="agent-run-header"><div><span className="agent-run-kicker">设计修改</span><h3>{statusLabel[run.status]}</h3></div><span className="agent-run-id">{run.run_id.slice(0,8)}</span></header>
  <div className="agent-run-metrics"><span>基线 v{run.project_revision} → 当前 v{run.current_revision}</span><span>工程工具 {run.tool_call_count} 次</span></div>
  {run.pending_action==='tool_wait'&&<div className="agent-wait"><Clock3 size={17}/><span>{visualEdit?'外观改形正在归档。':'本机 CAD 正在执行或回传。'}刷新后仍可恢复任务。</span><Button size="sm" variant="outline" disabled={disabled} onClick={onContinue}><RefreshCw size={14}/>检查进度</Button></div>}
  {failure&&<div className="agent-failure"><AlertTriangle size={16}/><span>{failure}</span></div>}
  {run.status==='succeeded'&&<div className="agent-success"><Check size={16}/><span>已验证并载入 v{run.current_revision}，共 {run.final_asset_ids.length} 个新{visualEdit?'外观模型':'CAD'}资产。物理验证仍未执行。</span><Button size="sm" variant="outline" onClick={onShowResult}>查看修改后的模型</Button></div>}
  {!needsAttention&&<AgentRunGraph run={run}/>}
  {plan&&<div className="agent-plan"><strong>{plan.summary??'结构化返工计划'}</strong><ol>{plan.steps?.map((step,index)=><li key={step.id??index}><span>{index+1}</span><div><b>{actionLabel[step.action??'']??step.action??'计划步骤'}</b>{step.parameters&&<code>{JSON.stringify(step.parameters)}</code>}{step.success_criteria?.length?<small>验收：{step.success_criteria.join('；')}</small>:null}{step.reason&&<details className="agent-plan-reason"><summary>为什么这样修改</summary><p>{step.reason}</p></details>}</div></li>)}</ol>{plan.risk_flags?.length?<div className="agent-risk"><AlertTriangle size={14}/>{plan.risk_flags.join('；')}</div>:null}{plan.rationale&&<details className="agent-plan-reason"><summary>查看规划依据</summary><p>{plan.rationale}</p></details>}</div>}
  {run.pending_action==='clarification'&&<div className="agent-approval"><div className="agent-approval-note"><ShieldCheck size={17}/><span>Planner 缺少关键工程事实。回答后进入 Replanner，仍需单独审批才会执行工具。</span></div>{questions.map((question,index)=><label key={`${index}-${question}`}><span>{index+1}. {question}</span><Textarea value={clarificationAnswers[answerKey(index)]??''} onChange={event=>setClarificationAnswers(current=>({...current,[answerKey(index)]:event.target.value}))} rows={2} placeholder="请提供可核对的尺寸、接口或约束"/></label>)}<div className="agent-actions"><Button disabled={disabled||questions.length===0||questions.some((_question,index)=>!clarificationAnswers[answerKey(index)]?.trim())} onClick={()=>onClarify(questions.map((_question,index)=>(clarificationAnswers[answerKey(index)]??'').trim()))}><RefreshCw size={15}/>提交并重规划</Button></div></div>}
  {run.pending_action==='approval'&&<div className="agent-approval"><div className="agent-approval-note"><ShieldCheck size={17}/><span>尚未发生工程副作用。批准后将生成新版本{visualEdit?'与外观模型。':'并启动本机 CAD。'}</span></div><Textarea value={feedback} onChange={event=>setFeedback(event.target.value)} rows={2} placeholder="如需调整计划，请写明必须保留的尺寸、接口或约束"/><div className="agent-actions"><Button disabled={disabled} onClick={()=>onDecision('approve')}><Check size={15}/>批准并执行</Button><Button variant="outline" disabled={disabled||!feedback.trim()} onClick={()=>onDecision('modify',feedback.trim())}><RefreshCw size={15}/>按补充要求重规划</Button><Button variant="ghost" disabled={disabled} onClick={()=>onDecision('reject')}><X size={15}/>拒绝</Button></div></div>}
  {needsAttention&&<AgentRunGraph run={run}/>}
  <details className="agent-timeline" open={run.status==='failed'}><summary>技术事件时间线 · {timeline.length} 条</summary><ol>{timeline.map(event=><li key={`${event.sequence}-${event.kind}`}><span>{String(event.sequence).padStart(2,'0')}</span><div><b>{eventKindLabel(event.kind)}</b><p>{event.message}</p><small>{new Date(event.created_at).toLocaleString()}</small></div></li>)}</ol></details>
  <details className="agent-run-diagnostics"><summary>运行数据</summary><div><span>重规划 {run.replan_count}</span><span>模型 tokens {run.model_input_tokens+run.model_output_tokens}</span><span>估算 ${run.estimated_cost_usd.toFixed(4)}</span></div></details>
  <div className="agent-run-footer-actions"><Button className="agent-refresh" size="sm" variant="ghost" disabled={disabled} onClick={onRefresh}><RefreshCw size={14}/>刷新 checkpoint 状态</Button>{terminal&&<Button size="sm" variant="outline" disabled={disabled} onClick={onReset}><RefreshCw size={14}/>开始新一轮返工</Button>}</div>
 </section>;
}
