'use client';
import {Button} from '@/components/ui/button';
import {partEngineeringRole,type Project} from '@/lib/engineering';

export type AiPlan={jobId:string;summary:string;questions:string[];proposedActions:{action:string;partId:string|null;designId?:string;parameters:Record<string,unknown>;reason:string}[];evidenceUsed:{id:string;name:string;partId?:string}[];requiredChecks:string[];riskFlags:string[];confidence:number;aiJob?:{model?:string;provider?:string};state?:string};
const actionLabels:Record<string,string>={change_base_dimensions:'调整底座尺寸',recommend_process:'推荐工艺配置',request_engineering_review:'提交工程师复核',change_cad_parameters:'调整 CAD 参数',create_cad_design:'创建受控 CAD 设计'};

export default function AiPlanPanel({plan,project,disabled,onApply}:{plan:AiPlan;project:Project;disabled:boolean;onApply:()=>void}){
 const executable=plan.proposedActions.some(action=>action.action!=='request_engineering_review');
 return <section className="plan-panel" aria-label="AI 改版建议分析结果">
  <div className="plan-heading"><div><strong>改版分析</strong><span>项目 v{project.revision} · 建议置信度 {Math.round(plan.confidence*100)}%</span></div><span className="plan-state">建议待审核</span></div>
  <p className="plan-summary">{plan.summary}</p>
  <div className="plan-grid">
   <section><h3>建议动作</h3>{plan.proposedActions.length?plan.proposedActions.map((action,index)=>{const part=project.parts.find(value=>value.id===action.partId);return <article className="plan-action" key={index}><div><b>{String(index+1).padStart(2,'0')}</b><strong>{actionLabels[action.action]??action.action}</strong></div><small>{part?`${part.name} · ${partEngineeringRole(part)==='visual_reference'?'外观参考':'制造零件'}`:action.designId?'CAD 设计':'项目级建议'}</small><p>{action.reason}</p>{Object.keys(action.parameters??{}).length>0&&<dl>{Object.entries(action.parameters).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}</article>;}):<p className="plan-empty">暂无可执行动作；请先处理待确认问题。</p>}</section>
   <section className="plan-side"><h3>分析依据与检查</h3><div><strong>已引用证据</strong>{plan.evidenceUsed.length?<ul>{plan.evidenceUsed.map(item=><li key={item.id}>{item.name}</li>)}</ul>:<p>没有可引用的当前检查证据</p>}</div><div><strong>后续检查</strong>{plan.requiredChecks.length?<ul>{plan.requiredChecks.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p>暂无新增检查项</p>}</div>{plan.questions.length>0&&<div><strong>待澄清</strong><ul>{plan.questions.map((item,index)=><li key={index}>{item}</li>)}</ul></div>}{plan.riskFlags.length>0&&<div className="plan-risks"><strong>风险提示</strong><ul>{plan.riskFlags.map((item,index)=><li key={index}>{item}</li>)}</ul></div>}</section>
  </div>
  <div className="plan-footer"><span>{plan.aiJob?.model?`模型：${plan.aiJob.model} · `:''}建议不会自动改写三维模型</span><Button size="sm" disabled={disabled||!executable||plan.questions.length>0} onClick={onApply}>应用可执行修改</Button></div>
 </section>;
}
