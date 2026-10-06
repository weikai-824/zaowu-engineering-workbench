'use client';

import {useEffect,useMemo,useState} from 'react';
import type {LucideIcon} from 'lucide-react';
import {AlertTriangle,Box,CheckCircle2,ChevronRight,Clock3,RotateCcw,ScanLine,ShieldCheck,Sparkles,Wrench} from 'lucide-react';
import {
 buildAgentRunPresentation,
 formatWorkflowDuration,
 type AgentRunPresentationSource,
 type WorkflowStageId,
} from '@/lib/agent-run-presentation';

type Props={run:AgentRunPresentationSource};

const stageIcons:Record<WorkflowStageId,LucideIcon>={
 selection:ScanLine,
 planning:Sparkles,
 approval:ShieldCheck,
 execution:Wrench,
 verification:CheckCircle2,
 result:Box,
};

function shortKey(value:string|null){
 if(!value)return null;
 return value.length>34?`${value.slice(0,18)}…${value.slice(-10)}`:value;
}

function timeLabel(value:string){
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
}

export default function AgentRunGraph({run}:Props){
 const terminal=run.status==='succeeded'||run.status==='failed'||run.status==='canceled';
 const updatedAt=Date.parse(run.updated_at);
 const[liveNow,setLiveNow]=useState(()=>Date.now());
 const now=terminal&&Number.isFinite(updatedAt)?updatedAt:liveNow;
 const presentation=useMemo(()=>buildAgentRunPresentation(run,now),[run,now]);
 const[selection,setSelection]=useState<{runId:string;stageId:WorkflowStageId}|null>(null);
 const selectedId=selection?.runId===run.run_id?selection.stageId:presentation.focusStageId;
 const selected=presentation.stages.find(stage=>stage.id===selectedId)??presentation.stages[0];
 const Icon=stageIcons[selected.id];

 useEffect(()=>{
  if(terminal)return;
  const timer=window.setInterval(()=>setLiveNow(Date.now()),1000);
  return()=>window.clearInterval(timer);
 },[run.run_id,terminal]);

 return <div className="agent-graph" aria-label="返工 Agent 六阶段状态图">
  <div className="agent-graph-heading">
   <div><strong>修改进度</strong><span>规划、审批、执行、验证</span></div>
   <small><span className="agent-graph-live"/>持续更新</small>
  </div>
  <div className="agent-flow-scroll">
   <ol className="agent-flow-list">
    {presentation.stages.map(stage=>{
     const StageIcon=stageIcons[stage.id];
     const selectedStage=selected.id===stage.id;
     const duration=stage.state==='pending'?'尚未开始':`${stage.durationKind==='waiting'?'等待':'耗时'} ${formatWorkflowDuration(stage.durationMs)}`;
     return <li key={stage.id} data-state={stage.state}>
      <button type="button" className="agent-flow-node" data-selected={selectedStage||undefined} aria-pressed={selectedStage} aria-label={`${stage.index}. ${stage.title}，${stage.stateLabel}，${duration}`} onClick={()=>setSelection({runId:run.run_id,stageId:stage.id})}>
       <span className="agent-flow-node-top"><span className="agent-flow-icon"><StageIcon size={16}/></span><b>{String(stage.index).padStart(2,'0')}</b></span>
       <strong>{stage.title}</strong>
       <span className="agent-flow-state"><i/>{stage.stateLabel}</span>
       <small>{duration}</small>
      </button>
      {stage.index<presentation.stages.length&&<ChevronRight className="agent-flow-connector" size={15} aria-hidden="true"/>}
     </li>;
    })}
   </ol>
  </div>

  <section className="agent-stage-detail" aria-live="polite">
   <header>
    <span className="agent-stage-detail-icon" data-state={selected.state}><Icon size={18}/></span>
    <div><span>阶段 {String(selected.index).padStart(2,'0')}</span><h4>{selected.title}</h4><p>{selected.description}</p></div>
    <div className="agent-stage-detail-status" data-state={selected.state}><b>{selected.stateLabel}</b><small>{selected.state==='pending'?'—':`${selected.durationKind==='waiting'?'等待':'累计'} ${formatWorkflowDuration(selected.durationMs)}`}</small></div>
   </header>
   <div className="agent-stage-facts">
    <div><strong>输入</strong><dl>{selected.input.map(item=><div key={`${item.label}-${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></div>
    <div><strong>输出</strong><dl>{selected.output.map(item=><div key={`${item.label}-${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></div>
   </div>
   {selected.error&&<div className="agent-stage-error"><AlertTriangle size={15}/><div><strong>该阶段失败</strong><p>{selected.error}</p></div></div>}
   <footer><span>关联事件 {selected.eventCount} 条</span><span>工程任务记录</span></footer>
  </section>

  {selected.id==='execution'&&<div className="agent-tool-detail">
   <div className="agent-tool-detail-heading"><div><Wrench size={15}/><strong>CAD 工具明细</strong></div><span>{presentation.toolAttempts.length} 次调用</span></div>
   {presentation.toolAttempts.length?<ol>{presentation.toolAttempts.map(attempt=><li key={`${attempt.sequence}-${attempt.ordinal}`} data-tone={attempt.tone}>
    <span className="agent-tool-index">{String(attempt.ordinal).padStart(2,'0')}</span>
    <div className="agent-tool-copy"><div><strong>{attempt.label}</strong><span>{attempt.outcomeLabel}{attempt.verificationLabel?` · 校验：${attempt.verificationLabel}`:''}</span></div><p>{attempt.description}</p><small>{attempt.message}</small>{(attempt.stepId||attempt.idempotencyKey)&&<code>{attempt.planVersion?`plan v${attempt.planVersion} · `:''}{attempt.stepId?`step ${attempt.stepId} · `:''}{shortKey(attempt.idempotencyKey)}</code>}</div>
    <div className="agent-tool-time"><b>{formatWorkflowDuration(attempt.executionDurationMs)}</b><span>执行</span>{attempt.verificationDurationMs>0&&<><b>{formatWorkflowDuration(attempt.verificationDurationMs)}</b><span>校验</span></>}</div>
   </li>)}</ol>:<p className="agent-tool-empty">批准方案后，这里会按真实返回顺序展示每次白名单工具调用。</p>}
  </div>}

  {(presentation.exceptions.length>0||presentation.invalidEventCount>0)&&<details className="agent-exceptions" open={run.status==='failed'?true:undefined}>
   <summary><span><RotateCcw size={14}/>异常、等待与重试</span><b>{presentation.exceptions.length+presentation.invalidEventCount}</b></summary>
   <div>{presentation.exceptions.map(item=><article key={item.key} data-tone={item.tone}><span>{item.count>1?`${item.count}×`:'·'}</span><div><strong>{item.label}</strong><p>{item.message}</p></div><time>{timeLabel(item.createdAt)}</time></article>)}{presentation.invalidEventCount>0&&<article data-tone="danger"><span>!</span><div><strong>有事件未通过展示层校验</strong><p>{presentation.invalidEventCount} 条事件格式不完整，已从状态计算中排除。</p></div></article>}</div>
  </details>}
  {!terminal&&<div className="agent-graph-footnote"><Clock3 size={13}/><span>进行中阶段每秒更新耗时；人工审批和本机 CAD 等待时间会单独标记。</span></div>}
 </div>;
}
