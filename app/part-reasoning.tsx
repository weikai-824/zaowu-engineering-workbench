'use client';
import {useEffect,useState} from 'react';
import {BrainCircuit} from 'lucide-react';
import {projectPartReasoning,type PartReasoning} from '@/lib/part-reasoning';
import type {Part,Project} from '@/lib/engineering';

type ReasoningViewProps={result:PartReasoning;pending?:boolean;error?:string;dirty?:boolean};
type RemoteReasoningProps={project:Project;part:Part;fallback:PartReasoning};

function ReasoningView({result,pending=false,error='',dirty=false}:ReasoningViewProps){
 return <section className="part-reasoning" aria-label="工程选择依据">
  <div className="part-reasoning-heading"><h3><BrainCircuit size={16}/>工程选择依据</h3><span>{result.source==='ai'?'AI 工程解释':'工程数据摘要'}</span></div>
  <p className="reasoning-role">{result.role}</p>
  <p className="reasoning-main">{result.selectionReason}</p>
  <div className="reasoning-section"><strong>方案取舍</strong><ul>{result.tradeoffs.map((item,index)=><li key={index}>{item}</li>)}</ul></div>
  <div className="reasoning-section"><strong>依据记录</strong><ul>{result.evidence.map((item,index)=><li key={index}>{item}</li>)}</ul></div>
  <div className="reasoning-section"><strong>待确认</strong><ul>{result.pendingChecks.map((item,index)=><li key={index}>{item}</li>)}</ul></div>
  {result.source==='ai'&&<p className="reasoning-meta">建议置信度 {Math.round(result.confidence*100)}%{result.model?` · ${result.model}`:''} · 需人工复核</p>}
  {pending&&<p className="reasoning-meta" role="status">正在结合项目要求与零件证据生成解释…</p>}
  {!pending&&error&&<p className="reasoning-meta">AI 分析暂不可用：{error}</p>}
  {dirty&&<p className="reasoning-meta">保存当前修改后更新 AI 解释</p>}
 </section>;
}

function RemoteReasoning({project,part,fallback}:RemoteReasoningProps){
 const[result,setResult]=useState<PartReasoning|null>(null),[pending,setPending]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/ai/part-reasoning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,projectRevision:project.revision,partId:part.id}),signal:controller.signal})
   .then(async response=>{const body=await response.json() as PartReasoning&{error?:string};if(!response.ok)throw Error(body.error??'AI 分析暂不可用');return body;})
   .then(value=>{if(!controller.signal.aborted)setResult(value);})
   .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'AI 分析暂不可用');})
   .finally(()=>{if(!controller.signal.aborted)setPending(false);});
  return()=>controller.abort();
 },[project.id,project.revision,part.id]);
 return <ReasoningView result={result??fallback} pending={pending} error={error}/>;
}

export default function PartReasoningPanel({project,part,configured,dirty}:{project:Project;part:Part;configured:boolean;dirty:boolean}){
 const fallback=projectPartReasoning(project,part);
 if(!configured||dirty||project.revision<1)return <ReasoningView result={fallback} dirty={dirty}/>;
 return <RemoteReasoning key={`${project.id}:${project.revision}:${part.id}`} project={project} part={part} fallback={fallback}/>;
}
