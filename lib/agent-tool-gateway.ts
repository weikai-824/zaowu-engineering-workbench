import {z} from 'zod';
import runnerContract from '@/data/executor.json';
import {
 failedToolResult,
 pendingToolResult,
 toolResult,
 type AgentToolEvidence,
 type AgentToolInvocation,
 type AgentToolResult,
 type AgentToolName,
} from './agent-tool-contract';
import {cadCanonical,cadHash,changeCadParameters,parseCad} from './cad-spec';
import {sha256Hex} from './crypto-portable';
import {invalidate,type Part,type Project} from './engineering';
import {sha256} from './slice-contract';
import type {CadTask} from './cad-result';
import type {ExecutionRow} from './execution-contract';
import {editGlbRegion,type RegionEditOperation} from './glb-region-edit';
import {regionFeedbackSchema} from './design-feedback';

type Runtime={DB:D1Database;BUCKET:R2Bucket};
type RepairMarker={idempotencyKey:string;runId:string;planVersion:number;stepId:string;toolIndex:number;tool:AgentToolName;fromRevision:number;toRevision:number;createdAt:string};
type RepairProject=Project&{agentRepairs?:RepairMarker[]};
type JobRow={id:string;project_id:string;base_revision:number;status:string;request:string;result:string|null};
type PriorResult={tool:AgentToolName;outcome:'succeeded'|'pending'|'failed';output:Record<string,unknown>};
const CAD_REPAIR_SEQUENCE:readonly AgentToolName[]=['apply_design_change','create_cad_job','start_cad_execution','poll_cad_execution','attach_cad_result','verify_revision'];
const VISUAL_REPAIR_SEQUENCE:readonly AgentToolName[]=['apply_visual_edit','verify_visual_revision'];
const ACTIVE_EXECUTOR_WINDOW_MS=30_000;

const priorResultSchema=z.object({tool:z.enum(['apply_design_change','create_cad_job','start_cad_execution','poll_cad_execution','attach_cad_result','verify_revision','apply_visual_edit','verify_visual_revision']),outcome:z.enum(['succeeded','pending','failed']),output:z.record(z.unknown())}).strict();
const applyArgumentsSchema=z.object({
 action:z.enum(['change_cad_parameters','create_cad_design']),
 part_id:z.string().uuid().nullable(),
 design_id:z.string().uuid().nullable(),
 parameters:z.record(z.unknown()),
 success_criteria:z.array(z.string()).max(12),
 prior_results:z.array(priorResultSchema).max(64),
}).strict();
const subsequentArgumentsSchema=z.object({
 action:z.enum(['change_cad_parameters','create_cad_design']),
 part_id:z.string().uuid().nullable(),
 design_id:z.string().uuid().nullable(),
 parameters:z.record(z.unknown()),
 success_criteria:z.array(z.string()).max(12),
 prior_results:z.array(priorResultSchema).max(64),
}).strict();
const sha256Schema=z.string().regex(/^[0-9a-f]{64}$/);
const vectorSchema=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const visualArgumentsSchema=z.object({
 action:z.literal('change_visual_mesh'),part_id:z.string().uuid(),design_id:z.null(),
 parameters:z.object({operation:z.enum(['offset','flatten','translate']),amount_mm:z.number().finite().min(-50).max(50),falloff_mm:z.number().finite().min(0.1).max(50),depth_mm:z.number().finite().min(0.1).max(100),direction:vectorSchema.optional()}).strict().refine(value=>(value.operation==='translate')===!!value.direction),
 success_criteria:z.array(z.string()).max(12),prior_results:z.array(priorResultSchema).max(64),feedback:regionFeedbackSchema,
}).strict();
const archivedCadResultSchema=z.object({
 designId:z.string().uuid(),
 designSha256:sha256Schema,
 artifactSha256:sha256Schema,
 assets:z.array(z.object({partId:z.string().uuid(),assetId:z.string().uuid(),sha256:sha256Schema,position:vectorSchema,dimensions:z.tuple([z.number().positive(),z.number().positive(),z.number().positive()]),triangles:z.number().int().nonnegative()}).strict()).min(1).max(200),
 executionProof:z.object({verification:z.string()}).passthrough().optional(),
 summary:z.object({verification:z.string().optional(),interfaceCount:z.number().int().nonnegative().optional(),overlapCount:z.number().int().nonnegative().optional(),notChecked:z.unknown().optional()}).passthrough().optional(),
}).passthrough();
const cadTaskIdentitySchema=z.object({projectId:z.string().uuid(),projectRevision:z.number().int().positive(),designJson:z.string(),designSha256:sha256Schema}).passthrough();

async function deterministicUuid(value:string){
 const hash=await sha256Hex(value),version=`5${hash.slice(13,16)}`,variant=((parseInt(hash[16],16)&3)|8).toString(16);
 return `${hash.slice(0,8)}-${hash.slice(8,12)}-${version}-${variant}${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

function markerFor(invocation:AgentToolInvocation,toRevision:number):RepairMarker{
 return{idempotencyKey:invocation.idempotency_key,runId:invocation.run_id,planVersion:invocation.plan_version,stepId:invocation.step_id,toolIndex:invocation.tool_index,tool:invocation.tool,fromRevision:invocation.expected_revision,toRevision,createdAt:new Date().toISOString()};
}

function hasMarker(project:RepairProject,invocation:AgentToolInvocation){
 return project.agentRepairs?.some(value=>value.idempotencyKey===invocation.idempotency_key&&value.runId===invocation.run_id&&value.planVersion===invocation.plan_version&&value.stepId===invocation.step_id&&value.toolIndex===invocation.tool_index&&value.tool===invocation.tool&&value.fromRevision===invocation.expected_revision)??false;
}

function withMarker(project:Project,marker:RepairMarker):RepairProject{
 const previous=(project as RepairProject).agentRepairs??[];
 return{...project,agentRepairs:[...previous.slice(-49),marker]};
}

async function loadProject(rt:Runtime,ownerId:string,projectId:string){
 const row=await rt.DB.prepare('SELECT body,revision FROM projects WHERE id=? AND owner_id=?').bind(projectId,ownerId).first<{body:string;revision:number}>();
 if(!row)return null;
 const project=JSON.parse(row.body) as RepairProject;
 return project.revision===row.revision?project:null;
}

async function loadRevision(rt:Runtime,ownerId:string,projectId:string,revision:number){
 const row=await rt.DB.prepare('SELECT body FROM revisions WHERE project_id=? AND owner_id=? AND number=?').bind(projectId,ownerId,revision).first<{body:string}>();
 return row?JSON.parse(row.body) as RepairProject:null;
}

function latestPrior(argumentsValue:{prior_results:PriorResult[]},tool:AgentToolName){
 return [...argumentsValue.prior_results].reverse().find(value=>value.tool===tool&&value.outcome==='succeeded') as PriorResult|undefined;
}

function stringOutput(result:PriorResult|undefined,key:string){
 const value=result?.output[key];
 return typeof value==='string'?value:null;
}

function parsedJson(value:string):unknown{
 try{return JSON.parse(value);}catch{return null;}
}

function evidence(kind:string,values:Record<string,string|number|boolean|null>):AgentToolEvidence{return{kind,...values};}

async function replayedProjectResult(rt:Runtime,ownerId:string,invocation:AgentToolInvocation,summary:string){
 const revision=await loadRevision(rt,ownerId,invocation.project_id,invocation.expected_revision+1);
 if(!revision||!hasMarker(revision,invocation))return null;
 return toolResult(invocation,summary,{project_revision:revision.revision},[evidence('idempotent_replay',{project_revision:revision.revision})]);
}

async function applyDesignChange(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 const replay=await replayedProjectResult(rt,ownerId,invocation,'已返回先前完成的同一设计变更。');
 if(replay)return replay;
 const args=applyArgumentsSchema.parse(invocation.arguments),project=await loadProject(rt,ownerId,invocation.project_id);
 if(!project)return failedToolResult(invocation,'project_not_found','non_retryable','项目不存在或快照无效。');
 if(project.revision!==invocation.expected_revision)return failedToolResult(invocation,'project_revision_conflict','retryable','项目版本已变化，需要基于最新版本重规划。',[evidence('revision_conflict',{expected:invocation.expected_revision,actual:project.revision})]);
 let changed:Project,designId:string;
 try{
  if(args.action==='change_cad_parameters'){
   if(!args.design_id||!args.part_id)return failedToolResult(invocation,'repair_target_invalid','non_retryable','CAD 参数修改缺少设计或零件编号。');
   const design=project.cadDesigns?.find(value=>value.id===args.design_id);
   if(!design||!design.parts.some(part=>part.id===args.part_id))return failedToolResult(invocation,'cad_design_not_found','non_retryable','目标零件不属于当前 CAD 参数设计。');
   const values=z.record(z.number().finite()).parse(args.parameters);
   const nextDesign=changeCadParameters(design,values);
   changed={...project,cadDesigns:project.cadDesigns!.map(value=>value.id===design.id?nextDesign:value)};
   designId=design.id;
  }else{
   if(Object.keys(args.parameters).length!==1||!Object.hasOwn(args.parameters,'design_spec'))return failedToolResult(invocation,'cad_design_change_rejected','non_retryable','创建 CAD 设计时 parameters 只能包含 design_spec。');
   const design=parseCad(args.parameters.design_spec);
   if((project.cadDesigns?.length??0)>=12||project.cadDesigns?.some(value=>value.id===design.id)||design.parts.some(part=>project.parts.some(value=>value.id===part.id)||(project.cadDesigns??[]).some(value=>value.parts.some(existing=>existing.id===part.id))))return failedToolResult(invocation,'cad_design_identity_conflict','non_retryable','CAD 设计或零件编号冲突。');
   changed={...project,cadDesigns:[...(project.cadDesigns??[]),design]};
   designId=design.id;
  }
 }catch(error){return failedToolResult(invocation,'cad_design_change_rejected','non_retryable',error instanceof Error?error.message:'CAD 设计修改不符合工程约束。');}
 const now=new Date().toISOString(),nextRevision=project.revision+1;
 const next=withMarker({...invalidate(changed,'Agent 已应用经人工批准的 CAD 参数修改；旧检查需复核。'),revision:nextRevision,updatedAt:now},markerFor(invocation,nextRevision));
 const body=JSON.stringify(next);
 try{
  const results=await rt.DB.batch([
   rt.DB.prepare('INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) VALUES(?,?,?,?,?,?)').bind(await deterministicUuid(`revision:${invocation.idempotency_key}`),project.id,ownerId,nextRevision,body,now),
   rt.DB.prepare('UPDATE projects SET body=?,revision=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?').bind(body,nextRevision,now,project.id,ownerId,project.revision),
  ]);
  if(results.some(result=>result.meta.changes!==1))throw Error('project revision compare-and-swap failed');
 }catch(error){
  const repeated=await replayedProjectResult(rt,ownerId,invocation,'并发恢复后返回已完成的设计变更。');
  if(repeated)return repeated;
  throw error;
 }
 return toolResult(invocation,'已创建包含受控 CAD 设计变更的新项目版本。',{project_revision:nextRevision,design_id:designId},[evidence('project_revision',{from_revision:project.revision,to_revision:nextRevision,design_id:designId})]);
}

async function createCadJob(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 const args=subsequentArgumentsSchema.parse(invocation.arguments),apply=latestPrior(args,'apply_design_change');
 const createdDesign=z.object({id:z.string().uuid()}).passthrough().safeParse(args.parameters.design_spec);
 const designId=stringOutput(apply,'design_id')??args.design_id??(createdDesign.success?createdDesign.data.id:null);
 if(!designId)return failedToolResult(invocation,'cad_design_not_resolved','non_retryable','无法确定要执行的 CAD 设计。');
 const id=await deterministicUuid(`cad-job:${invocation.idempotency_key}`);
 const existing=await rt.DB.prepare("SELECT request FROM jobs WHERE id=? AND owner_id=? AND kind='cad_build'").bind(id,ownerId).first<{request:string}>();
 if(existing){
  const task=cadTaskIdentitySchema.safeParse(parsedJson(existing.request));
  const storedDesign=task.success?z.object({id:z.string().uuid()}).passthrough().safeParse(parsedJson(task.data.designJson)):null;
  if(!task.success||!storedDesign?.success||task.data.projectId!==invocation.project_id||task.data.projectRevision!==invocation.expected_revision||storedDesign.data.id!==designId)return failedToolResult(invocation,'cad_job_identity_conflict','state_unknown','CAD 任务幂等标识与现有记录冲突。');
  return toolResult(invocation,'已返回先前创建的同一 CAD 构建任务。',{project_revision:task.data.projectRevision,design_id:designId,cad_job_id:id,design_sha256:task.data.designSha256},[evidence('idempotent_replay',{cad_job_id:id,project_revision:task.data.projectRevision})]);
 }
 const project=await loadProject(rt,ownerId,invocation.project_id);
 if(!project)return failedToolResult(invocation,'project_not_found','non_retryable','项目不存在或快照无效。');
 if(project.revision!==invocation.expected_revision)return failedToolResult(invocation,'project_revision_conflict','retryable','创建 CAD 任务前项目版本已变化。');
 const design=project.cadDesigns?.find(value=>value.id===designId);
 if(!design)return failedToolResult(invocation,'cad_design_not_found','non_retryable','当前版本中不存在计划指定的 CAD 设计。');
 const now=new Date().toISOString();
 const task:CadTask={schema:'cad-task-v1',jobId:id,projectId:project.id,projectRevision:project.revision,designJson:cadCanonical(design),designSha256:await cadHash(design)};
 await rt.DB.prepare("INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,created_at,updated_at) VALUES(?,?,?,?,?,'prepared',?,?,?) ON CONFLICT(id) DO NOTHING").bind(id,ownerId,project.id,project.revision,'cad_build',JSON.stringify(task),now,now).run();
 const stored=await rt.DB.prepare("SELECT request FROM jobs WHERE id=? AND owner_id=? AND kind='cad_build'").bind(id,ownerId).first<{request:string}>();
 if(!stored||stored.request!==JSON.stringify(task))return failedToolResult(invocation,'cad_job_identity_conflict','state_unknown','CAD 任务幂等标识与现有记录冲突。');
 return toolResult(invocation,'受控 CAD 构建任务已创建。',{project_revision:project.revision,design_id:designId,cad_job_id:id,design_sha256:task.designSha256},[evidence('cad_job',{cad_job_id:id,design_sha256:task.designSha256})]);
}

async function startCadExecution(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 const args=subsequentArgumentsSchema.parse(invocation.arguments),jobId=stringOutput(latestPrior(args,'create_cad_job'),'cad_job_id');
 if(!jobId)return failedToolResult(invocation,'cad_job_not_resolved','non_retryable','无法确定要执行的 CAD 任务。');
 const job=await rt.DB.prepare("SELECT project_id,request,result FROM jobs WHERE id=? AND owner_id=? AND kind='cad_build'").bind(jobId,ownerId).first<{project_id:string;request:string;result:string|null}>();
 if(!job)return failedToolResult(invocation,'cad_job_not_found','non_retryable','CAD 任务不存在。');
 if(job.project_id!==invocation.project_id)return failedToolResult(invocation,'cad_job_project_mismatch','non_retryable','CAD 任务不属于当前返工项目。');
 const task=cadTaskIdentitySchema.safeParse(parsedJson(job.request));
 if(!task.success||task.data.projectId!==invocation.project_id||task.data.projectRevision!==invocation.expected_revision)return failedToolResult(invocation,'cad_job_revision_mismatch','non_retryable','CAD 任务与当前项目版本不匹配。');
 const existing=await rt.DB.prepare('SELECT * FROM execution_runs WHERE job_id=? AND owner_id=?').bind(jobId,ownerId).first<ExecutionRow>();
 if(existing){
  if(existing.project_id!==invocation.project_id)return failedToolResult(invocation,'cad_execution_project_mismatch','state_unknown','现有 CAD 执行任务与当前项目不一致。');
  return toolResult(invocation,'已返回先前提交的同一 CAD 执行任务。',{project_revision:invocation.expected_revision,cad_job_id:jobId,execution_run_id:existing.id,execution_status:existing.status},[evidence('execution_run',{execution_run_id:existing.id,status:existing.status,device_id:existing.device_id})]);
 }
 if(job.result)return failedToolResult(invocation,'cad_job_already_completed','non_retryable','CAD 任务已经存在归档结果。');
 const recentlySeen=new Date(Date.now()-ACTIVE_EXECUTOR_WINDOW_MS).toISOString();
 const device=await rt.DB.prepare("SELECT id FROM execution_devices WHERE owner_id=? AND status='active' AND updated_at>=? ORDER BY updated_at DESC LIMIT 1").bind(ownerId,recentlySeen).first<{id:string}>();
 if(!device)return failedToolResult(invocation,'cad_executor_unavailable','human_required','没有最近 30 秒内在线且已授权的本机 CAD 执行器。请先在 CAD 建模页恢复或重新完成本机配对。');
 const id=await deterministicUuid(`execution-run:${invocation.idempotency_key}`),now=new Date().toISOString();
 await rt.DB.prepare("INSERT INTO execution_runs(id,owner_id,project_id,job_id,device_id,status,attempt,input_sha256,runner_sha256,created_at,updated_at) VALUES(?,?,?,?,?,'queued',0,?,?,?,?) ON CONFLICT(job_id) DO NOTHING").bind(id,ownerId,job.project_id,jobId,device.id,await sha256(job.request),runnerContract.runnerSha256,now,now).run();
 const run=await rt.DB.prepare('SELECT * FROM execution_runs WHERE job_id=? AND owner_id=?').bind(jobId,ownerId).first<ExecutionRow>();
 if(!run)return failedToolResult(invocation,'cad_execution_submit_unknown','state_unknown','CAD 执行任务提交结果未知。');
 return toolResult(invocation,'CAD 任务已提交到受控本机执行器。',{project_revision:invocation.expected_revision,cad_job_id:jobId,execution_run_id:run.id,execution_status:run.status},[evidence('execution_run',{execution_run_id:run.id,status:run.status,device_id:run.device_id})]);
}

async function pollCadExecution(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 const args=subsequentArgumentsSchema.parse(invocation.arguments),runId=stringOutput(latestPrior(args,'start_cad_execution'),'execution_run_id');
 if(!runId)return failedToolResult(invocation,'execution_run_not_resolved','non_retryable','无法确定要查询的 CAD 执行任务。');
 const run=await rt.DB.prepare('SELECT * FROM execution_runs WHERE id=? AND owner_id=? AND project_id=?').bind(runId,ownerId,invocation.project_id).first<ExecutionRow>();
 if(!run)return failedToolResult(invocation,'execution_run_not_found','non_retryable','CAD 执行任务不存在。');
 const facts={project_revision:invocation.expected_revision,cad_job_id:run.job_id,execution_run_id:run.id,execution_status:run.status,attempt:run.attempt};
 const proof=[evidence('execution_status',{execution_run_id:run.id,status:run.status,attempt:run.attempt,device_id:run.device_id})];
 if(run.status==='queued'||run.status==='leased')return pendingToolResult(invocation,run.status==='queued'?'CAD 任务正在等待本机执行器领取。':'本机执行器正在运行 CAD 任务。',facts,proof);
 if(run.status==='succeeded'){
  const job=await rt.DB.prepare("SELECT result FROM jobs WHERE id=? AND owner_id=? AND project_id=? AND kind='cad_build'").bind(run.job_id,ownerId,invocation.project_id).first<{result:string|null}>();
  if(!job?.result)return failedToolResult(invocation,'cad_result_state_unknown','state_unknown','执行器报告成功，但 CAD 结果尚未完成归档。',proof);
  const parsed=archivedCadResultSchema.safeParse(parsedJson(job.result));
  if(!parsed.success)return failedToolResult(invocation,'cad_result_invalid','non_retryable','归档的 CAD 结果不符合受控契约。',proof);
  const result=parsed.data;
  return toolResult(invocation,'CAD 执行完成，签名结果已归档。',{...facts,artifact_sha256:result.artifactSha256},proof);
 }
 if(run.status==='failed'||run.status==='interrupted')return failedToolResult(invocation,'cad_execution_failed','retryable',run.error||'本机 CAD 执行失败。',proof);
 return failedToolResult(invocation,'cad_execution_canceled','non_retryable',run.error||'CAD 执行任务已取消。',proof);
}

async function attachCadResult(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 const replay=await replayedProjectResult(rt,ownerId,invocation,'已返回先前附加完成的 CAD 项目版本。');
 if(replay){
  const revision=await loadRevision(rt,ownerId,invocation.project_id,invocation.expected_revision+1);
  const args=subsequentArgumentsSchema.parse(invocation.arguments),jobId=stringOutput(latestPrior(args,'create_cad_job'),'cad_job_id');
  const assets=revision?.parts.filter(part=>part.source?.kind==='cad'&&part.source.jobId===jobId).map(part=>part.assetId).filter((id):id is string=>!!id)??[];
  return toolResult(invocation,replay.summary,{project_revision:invocation.expected_revision+1,asset_ids:assets},replay.evidence);
 }
 const args=subsequentArgumentsSchema.parse(invocation.arguments),jobId=stringOutput(latestPrior(args,'create_cad_job'),'cad_job_id');
 if(!jobId)return failedToolResult(invocation,'cad_job_not_resolved','non_retryable','无法确定要附加的 CAD 任务。');
 const row=await rt.DB.prepare("SELECT id,project_id,base_revision,status,request,result FROM jobs WHERE id=? AND owner_id=? AND kind='cad_build'").bind(jobId,ownerId).first<JobRow>();
 if(!row?.result)return failedToolResult(invocation,'cad_result_not_ready','state_unknown','CAD 结果尚未归档。');
 if(row.project_id!==invocation.project_id||row.base_revision!==invocation.expected_revision)return failedToolResult(invocation,'cad_job_project_mismatch','non_retryable','CAD 结果不属于当前项目版本。');
 if(row.status!=='result_archived'&&row.status!=='attached')return failedToolResult(invocation,'cad_result_not_ready','state_unknown','CAD 结果尚未进入可附加状态。');
 const project=await loadProject(rt,ownerId,invocation.project_id);
 if(!project)return failedToolResult(invocation,'project_not_found','non_retryable','项目不存在或快照无效。');
 if(project.revision!==invocation.expected_revision)return failedToolResult(invocation,'project_revision_conflict','retryable','附加 CAD 结果前项目版本已变化。',[evidence('revision_conflict',{expected:invocation.expected_revision,actual:project.revision})]);
 const parsedResult=archivedCadResultSchema.safeParse(parsedJson(row.result));
 if(!parsedResult.success)return failedToolResult(invocation,'cad_result_invalid','non_retryable','归档的 CAD 结果不符合受控契约。');
 const result=parsedResult.data;
 const design=project.cadDesigns?.find(value=>value.id===result.designId);
 if(!design||await cadHash(design)!==result.designSha256)return failedToolResult(invocation,'cad_design_result_mismatch','non_retryable','CAD 参数设计已经变化，旧结果不能附加。');
 if(result.executionProof?.verification!=='registered_device_signature_verified')return failedToolResult(invocation,'cad_execution_proof_missing','non_retryable','CAD 结果没有通过已登记执行器签名验证。');
 const parts:Part[]=project.parts.filter(value=>value.source?.kind!=='cad'||value.source.designId!==design.id);
 for(const asset of result.assets){
  if(parts.some(value=>value.id===asset.partId))return failedToolResult(invocation,'cad_part_identity_conflict','non_retryable','CAD 零件编号与其他模型冲突。');
  const spec=design.parts.find(value=>value.id===asset.partId);
  if(!spec)return failedToolResult(invocation,'cad_result_part_unknown','non_retryable','CAD 结果包含参数设计以外的零件。');
  const previous=project.parts.find(value=>value.id===asset.partId);
  parts.push({engineeringRole:'manufacturing',id:spec.id,name:spec.name,kind:'asset',params:{unitScale:1},position:asset.position,assetId:asset.assetId,assetName:`${spec.id}.stl`,dimensions:asset.dimensions,triangles:asset.triangles,color:spec.color,profileId:previous?.profileId??project.processConfiguration?.profileId,interfaceLocked:false,source:{kind:'cad',jobId:row.id,designId:design.id,designSha256:result.designSha256,assetSha256:asset.sha256,logicalPartId:spec.id,importerVersion:'controlled-cad-v1'}});
 }
 if(parts.length>200)return failedToolResult(invocation,'project_part_limit_exceeded','non_retryable','附加结果后项目零件数量超过限制。');
 const validIds=new Set(parts.map(part=>part.id)),now=new Date().toISOString(),nextRevision=project.revision+1;
 const next=withMarker({...invalidate({...project,parts,checks:project.checks.filter(check=>!check.partId||validIds.has(check.partId))},'Agent 已附加签名 CAD 实体；软件数字检查证据已归档，生产与实机检查未执行。'),revision:nextRevision,updatedAt:now},markerFor(invocation,nextRevision));
 const body=JSON.stringify(next),revisionId=await deterministicUuid(`revision:${invocation.idempotency_key}`);
 try{
  const rows=await rt.DB.batch([
   rt.DB.prepare("INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND revision=?) AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND owner_id=? AND project_id=? AND base_revision=? AND status IN ('result_archived','attached') AND result=?)").bind(revisionId,project.id,ownerId,nextRevision,body,now,project.id,ownerId,project.revision,row.id,ownerId,project.id,project.revision,row.result),
   rt.DB.prepare('UPDATE projects SET body=?,revision=?,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)').bind(body,nextRevision,now,project.id,ownerId,project.revision,revisionId),
   rt.DB.prepare("UPDATE jobs SET status='attached',updated_at=? WHERE id=? AND owner_id=? AND project_id=? AND base_revision=? AND status IN ('result_archived','attached') AND EXISTS(SELECT 1 FROM revisions WHERE id=?)").bind(now,row.id,ownerId,project.id,project.revision,revisionId),
  ]);
  if(rows.some(value=>value.meta.changes!==1))throw Error('CAD result attachment compare-and-swap failed');
 }catch(error){
  const repeated=await replayedProjectResult(rt,ownerId,invocation,'并发恢复后返回已附加的 CAD 结果。');
  if(repeated)return repeated;
  throw error;
 }
 const assetIds=result.assets.map(asset=>asset.assetId);
 return toolResult(invocation,'CAD 资产已附加到新的项目版本。',{project_revision:nextRevision,cad_job_id:jobId,design_id:design.id,asset_ids:assetIds,artifact_sha256:result.artifactSha256},[
  evidence('project_revision',{from_revision:project.revision,to_revision:nextRevision}),
  evidence('cad_artifact',{cad_job_id:jobId,artifact_sha256:result.artifactSha256,asset_count:assetIds.length}),
 ]);
}

async function verifyRevision(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 const args=subsequentArgumentsSchema.parse(invocation.arguments),jobId=stringOutput(latestPrior(args,'create_cad_job'),'cad_job_id');
 if(!jobId)return failedToolResult(invocation,'cad_job_not_resolved','non_retryable','无法确定需要验证的 CAD 任务。');
 const project=await loadProject(rt,ownerId,invocation.project_id);
 if(!project)return failedToolResult(invocation,'project_not_found','non_retryable','项目不存在或快照无效。');
 if(project.revision!==invocation.expected_revision)return failedToolResult(invocation,'project_revision_conflict','retryable','验证前项目版本已变化。',[evidence('revision_conflict',{expected:invocation.expected_revision,actual:project.revision})]);
 const row=await rt.DB.prepare("SELECT status,result FROM jobs WHERE id=? AND owner_id=? AND project_id=? AND kind='cad_build'").bind(jobId,ownerId,project.id).first<{status:string;result:string|null}>();
 if(!row?.result||row.status!=='attached')return failedToolResult(invocation,'cad_result_not_attached','non_retryable','CAD 结果尚未附加到当前项目版本。');
 const parsedResult=archivedCadResultSchema.safeParse(parsedJson(row.result));
 if(!parsedResult.success)return failedToolResult(invocation,'cad_result_invalid','non_retryable','归档的 CAD 结果不符合受控契约。');
 const result=parsedResult.data;
 const design=project.cadDesigns?.find(value=>value.id===result.designId),designSha=design?await cadHash(design):null;
 const assetIds=result.assets.map(asset=>asset.assetId);
 const sourcesMatch=result.assets.length>0&&result.assets.every(asset=>project.parts.some(part=>part.id===asset.partId&&part.assetId===asset.assetId&&part.source?.kind==='cad'&&part.source.jobId===jobId&&part.source.designSha256===result.designSha256&&part.source.assetSha256===asset.sha256));
 const checksPassed=typeof result.summary?.interfaceCount==='number'&&typeof result.summary?.overlapCount==='number'&&result.summary.overlapCount===0;
 const verified=designSha===result.designSha256&&sourcesMatch&&checksPassed&&result.executionProof?.verification==='registered_device_signature_verified';
 const verificationEvidence=[
  evidence('revision_binding',{project_revision:project.revision,design_hash_matches:designSha===result.designSha256,asset_sources_match:sourcesMatch}),
  evidence('cad_digital_checks',{interface_gauges_passed:checksPassed,interface_count:result.summary?.interfaceCount??-1,overlap_count:result.summary?.overlapCount??-1,verification:result.summary?.verification??'missing'}),
  evidence('execution_provenance',{signature_verified:result.executionProof?.verification==='registered_device_signature_verified',physical_validation:false,production_ready:false}),
 ];
 if(!verified)return failedToolResult(invocation,'repair_verification_failed','retryable','新版本未满足 CAD 来源、哈希、接口检查或执行签名要求。',verificationEvidence);
 return toolResult(invocation,'新项目版本、CAD 资产来源、参数哈希、接口量规、交叠检查和执行签名均已验证。',{verified:true,project_revision:project.revision,asset_ids:assetIds,cad_job_id:jobId,artifact_sha256:result.artifactSha256,physical_validation:'not_run',production_ready:false},verificationEvidence);
}

async function applyVisualEdit(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 const args=visualArgumentsSchema.parse(invocation.arguments);
 const replay=await loadRevision(rt,ownerId,invocation.project_id,invocation.expected_revision+1);
 if(replay&&hasMarker(replay,invocation)){
  const part=replay.parts.find(value=>value.id===args.part_id);
  if(part?.source?.kind==='visual_edit'&&part.assetId)return toolResult(invocation,'已返回先前完成的同一外观改形。',{project_revision:replay.revision,asset_ids:[part.assetId],visual_job_id:part.source.jobId},[evidence('idempotent_replay',{project_revision:replay.revision,asset_id:part.assetId})]);
 }
 const project=await loadProject(rt,ownerId,invocation.project_id);
 if(!project)return failedToolResult(invocation,'project_not_found','non_retryable','项目不存在或快照无效。');
 if(project.revision!==invocation.expected_revision)return failedToolResult(invocation,'project_revision_conflict','retryable','项目版本已变化，需要基于最新版本重规划。');
 const feedback=args.feedback,part=project.parts.find(value=>value.id===args.part_id);
 if(feedback.partId!==args.part_id||feedback.projectId!==project.id||feedback.projectRevision>project.revision||!feedback.region.worldPath||!feedback.location.normal)return failedToolResult(invocation,'visual_region_invalid','non_retryable','三维圈选与当前零件或版本不匹配。');
 if(!part||part.kind!=='asset'||!part.assetId||!part.source||!['tripo','visual_edit'].includes(part.source.kind)||part.interfaceLocked)return failedToolResult(invocation,'visual_target_invalid','non_retryable','目标不是可编辑的 Tripo 外观模型，或其接口已锁定。');
 const parent=await rt.DB.prepare('SELECT object_key FROM assets WHERE id=? AND owner_id=?').bind(part.assetId,ownerId).first<{object_key:string}>();
 const object=parent?await rt.BUCKET.get(parent.object_key):null;
 if(!object)return failedToolResult(invocation,'visual_source_missing','state_unknown','外观原件缺失，已停止改形。');
 const sourceBytes=await object.arrayBuffer(),sourceSha=await sha256(sourceBytes);
 if(sourceSha!==part.source.assetSha256)return failedToolResult(invocation,'visual_source_hash_mismatch','non_retryable','外观原件哈希与归档来源不一致。');
 const values=args.parameters;
 const operation:RegionEditOperation=values.operation==='translate'
  ?{kind:'translate',amountMm:values.amount_mm,falloffMm:values.falloff_mm,depthMm:values.depth_mm,direction:values.direction!}
  :{kind:values.operation,amountMm:values.amount_mm,falloffMm:values.falloff_mm,depthMm:values.depth_mm};
 let edited:ReturnType<typeof editGlbRegion>;
 try{edited=editGlbRegion(sourceBytes,{pathMm:feedback.region.worldPath,anchorMm:feedback.location.world,normal:feedback.location.normal,unitScale:part.params.unitScale,partPositionMm:part.position,operation});}
 catch(error){return failedToolResult(invocation,'visual_edit_rejected','non_retryable',error instanceof Error?error.message:'模型改形未通过约束校验。');}
 const assetSha=await sha256(edited.bytes),assetId=await deterministicUuid(`visual-asset:${invocation.idempotency_key}`),jobId=await deterministicUuid(`visual-job:${invocation.idempotency_key}`);
 const now=new Date().toISOString(),nextRevision=project.revision+1,key=`${ownerId}/visual-edits/${jobId}/${assetSha}.glb`,name=`visual-edit-${jobId.slice(0,8)}.glb`;
 const nextSource:Extract<Part['source'],{kind:'visual_edit'}>={kind:'visual_edit',jobId,assetSha256:assetSha,parentAssetId:part.assetId,parentAssetSha256:sourceSha,importerVersion:'glb-region-edit-v1'};
 const changed:Project={...project,parts:project.parts.map(value=>value.id===part.id?{...value,assetId,assetName:name,source:nextSource,engineeringRole:'visual_reference',dimensions:edited.report.resultDimensionsMm}:value)};
 const next=withMarker({...invalidate(changed,'已在圈选区域生成受控外观网格改形；原始资产与旧版本保留，制造检查需重新执行。'),revision:nextRevision,updatedAt:now},markerFor(invocation,nextRevision));
 const request={schema:'visual-edit-v1',partId:part.id,sourceAssetId:part.assetId,sourceSha256:sourceSha,unitScale:part.params.unitScale,partPositionMm:part.position,arguments:args};
 const result={schema:'visual-edit-result-v1',partId:part.id,assetId,assetSha256:assetSha,sourceAssetId:part.assetId,sourceSha256:sourceSha,fromRevision:project.revision,toRevision:nextRevision,report:edited.report};
 await rt.BUCKET.put(key,edited.bytes,{httpMetadata:{contentType:'model/gltf-binary'}});
 try{
  const rows=await rt.DB.batch([
   rt.DB.prepare('INSERT INTO assets(id,owner_id,filename,content_type,size,object_key,created_at) VALUES(?,?,?,?,?,?,?)').bind(assetId,ownerId,name,'model/gltf-binary',edited.bytes.byteLength,key,now),
   rt.DB.prepare("INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,result,created_at,updated_at) VALUES(?,?,?,?,?,'attached',?,?,?,?)").bind(jobId,ownerId,project.id,project.revision,'visual_edit',JSON.stringify(request),JSON.stringify(result),now,now),
   rt.DB.prepare('INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) VALUES(?,?,?,?,?,?)').bind(await deterministicUuid(`revision:${invocation.idempotency_key}`),project.id,ownerId,nextRevision,JSON.stringify(next),now),
   rt.DB.prepare('UPDATE projects SET body=?,revision=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?').bind(JSON.stringify(next),nextRevision,now,project.id,ownerId,project.revision),
  ]);
  if(rows.some(row=>row.meta.changes!==1))throw Error('visual revision compare-and-swap failed');
 }catch(error){
  const repeated=await loadRevision(rt,ownerId,invocation.project_id,nextRevision);
  if(!repeated||!hasMarker(repeated,invocation))throw error;
 }
 return toolResult(invocation,'圈选区域改形已生成新资产与项目版本。',{project_revision:nextRevision,asset_ids:[assetId],visual_job_id:jobId},[
  evidence('visual_geometry',{changed_vertices:edited.report.changedVertices,total_vertices:edited.report.totalVertices,max_displacement_mm:edited.report.maxDisplacementMm,unselected_vertices_unchanged:true}),
  evidence('asset_lineage',{source_asset_id:part.assetId,asset_id:assetId,source_sha256:sourceSha,asset_sha256:assetSha}),
 ]);
}

async function verifyVisualRevision(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 const args=visualArgumentsSchema.parse(invocation.arguments),prior=latestPrior(args,'apply_visual_edit');
 const jobId=stringOutput(prior,'visual_job_id'),assetId=stringOutput(prior,'asset_ids')??(Array.isArray(prior?.output.asset_ids)?String(prior.output.asset_ids[0]):null);
 if(!jobId||!assetId)return failedToolResult(invocation,'visual_result_missing','non_retryable','缺少已归档的外观改形结果。');
 const project=await loadProject(rt,ownerId,invocation.project_id);
 if(!project||project.revision!==invocation.expected_revision)return failedToolResult(invocation,'project_revision_conflict','retryable','外观改形验证前版本已变化。');
 const part=project.parts.find(value=>value.id===args.part_id),source=part?.source;
 const row=await rt.DB.prepare("SELECT request,result,status,base_revision FROM jobs WHERE id=? AND owner_id=? AND project_id=? AND kind='visual_edit'").bind(jobId,ownerId,project.id).first<{request:string;result:string|null;status:string;base_revision:number}>();
 const result=row?.result?parsedJson(row.result) as Record<string,unknown>:null;
 if(!row||row.status!=='attached'||!result||source?.kind!=='visual_edit'||part?.assetId!==assetId||source.jobId!==jobId||source.assetSha256!==result.assetSha256||source.parentAssetId!==result.sourceAssetId||source.parentAssetSha256!==result.sourceSha256||result.toRevision!==project.revision||result.fromRevision!==row.base_revision)return failedToolResult(invocation,'visual_lineage_invalid','non_retryable','新版本与外观资产来源记录不一致。');
 const asset=await rt.DB.prepare('SELECT object_key FROM assets WHERE id=? AND owner_id=?').bind(assetId,ownerId).first<{object_key:string}>(),object=asset?await rt.BUCKET.get(asset.object_key):null;
 if(!object)return failedToolResult(invocation,'visual_asset_missing','state_unknown','新外观资产文件缺失。');
 const actual=await sha256(await object.arrayBuffer());
 if(actual!==source.assetSha256)return failedToolResult(invocation,'visual_asset_hash_mismatch','non_retryable','新外观资产哈希验证失败。');
 const archivedRequest=z.object({schema:z.literal('visual-edit-v1'),partId:z.string().uuid(),sourceAssetId:z.string().uuid(),sourceSha256:sha256Schema,unitScale:z.number().positive(),partPositionMm:vectorSchema,arguments:visualArgumentsSchema}).safeParse(parsedJson(row.request));
 if(!archivedRequest.success||archivedRequest.data.partId!==part.id||archivedRequest.data.sourceAssetId!==source.parentAssetId||archivedRequest.data.sourceSha256!==source.parentAssetSha256)return failedToolResult(invocation,'visual_request_invalid','non_retryable','归档的圈选改形输入与模型来源不一致。');
 const parentAsset=await rt.DB.prepare('SELECT object_key FROM assets WHERE id=? AND owner_id=?').bind(source.parentAssetId,ownerId).first<{object_key:string}>(),parentObject=parentAsset?await rt.BUCKET.get(parentAsset.object_key):null;
 if(!parentObject)return failedToolResult(invocation,'visual_source_missing','state_unknown','归档原件缺失，无法复核改形。');
 const sourceBytes=await parentObject.arrayBuffer();
 if(await sha256(sourceBytes)!==source.parentAssetSha256)return failedToolResult(invocation,'visual_source_hash_mismatch','non_retryable','归档原件哈希验证失败。');
 const stored=archivedRequest.data,values=stored.arguments.parameters,feedback=stored.arguments.feedback;
 const operation:RegionEditOperation=values.operation==='translate'
  ?{kind:'translate',amountMm:values.amount_mm,falloffMm:values.falloff_mm,depthMm:values.depth_mm,direction:values.direction!}
  :{kind:values.operation,amountMm:values.amount_mm,falloffMm:values.falloff_mm,depthMm:values.depth_mm};
 let expected:string;
 try{expected=await sha256(editGlbRegion(sourceBytes,{pathMm:feedback.region.worldPath!,anchorMm:feedback.location.world,normal:feedback.location.normal!,unitScale:stored.unitScale,partPositionMm:stored.partPositionMm,operation}).bytes);}
 catch{return failedToolResult(invocation,'visual_recompute_failed','non_retryable','归档输入无法重算外观改形结果。');}
 if(expected!==actual)return failedToolResult(invocation,'visual_geometry_mismatch','non_retryable','新模型与原件和圈选输入的确定性重算结果不一致。');
 return toolResult(invocation,'新版本、原件来源与改形资产哈希均已验证。',{verified:true,project_revision:project.revision,asset_ids:[assetId],visual_job_id:jobId,physical_validation:'not_run',production_ready:false},[
  evidence('visual_revision',{project_revision:project.revision,asset_id:assetId,source_asset_id:source.parentAssetId,asset_sha256:actual,physical_validation:false}),
 ]);
}

export async function executeAgentTool(rt:Runtime,ownerId:string,invocation:AgentToolInvocation):Promise<AgentToolResult>{
 if(invocation.owner_id!==ownerId)return failedToolResult(invocation,'owner_identity_mismatch','non_retryable','调用身份与工具请求不一致。');
 const expectedKey=`repair:${invocation.run_id}:plan:${invocation.plan_version}:step:${invocation.step_id}:tool:${invocation.tool_index}`;
 if((CAD_REPAIR_SEQUENCE[invocation.tool_index]!==invocation.tool&&VISUAL_REPAIR_SEQUENCE[invocation.tool_index]!==invocation.tool)||invocation.idempotency_key!==expectedKey)return failedToolResult(invocation,'tool_invocation_identity_invalid','non_retryable','工具顺序或幂等标识不符合受控返工协议。');
 try{
  if(invocation.tool==='apply_visual_edit')return await applyVisualEdit(rt,ownerId,invocation);
  if(invocation.tool==='verify_visual_revision')return await verifyVisualRevision(rt,ownerId,invocation);
  if(invocation.tool==='apply_design_change')return await applyDesignChange(rt,ownerId,invocation);
  if(invocation.tool==='create_cad_job')return await createCadJob(rt,ownerId,invocation);
  if(invocation.tool==='start_cad_execution')return await startCadExecution(rt,ownerId,invocation);
  if(invocation.tool==='poll_cad_execution')return await pollCadExecution(rt,ownerId,invocation);
  if(invocation.tool==='attach_cad_result')return await attachCadResult(rt,ownerId,invocation);
  return await verifyRevision(rt,ownerId,invocation);
 }catch(error){
  if(error instanceof z.ZodError)return failedToolResult(invocation,'tool_arguments_invalid','non_retryable','Planner 生成的工具参数不符合受控契约。');
  throw error;
 }
}
