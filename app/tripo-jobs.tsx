'use client';
import {useState,useEffect,useRef,useCallback,useEffectEvent} from 'react';
import {Activity,Check,Clock3,Download,RotateCcw,Eye,Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {toast} from 'sonner';
import {type Project,type Part} from '@/lib/engineering';
import {importModel,measure,type ModelMap} from '@/lib/geometry';
import {sha256} from '@/lib/slice-contract';
import {randomUuid} from '@/lib/crypto-portable';
import type {RecoveredAsset,TripoIntakeRecord} from '@/lib/tripo-recovery';
import ModelViewer from './model-viewer';
type Job={id:string;kind:string;status:string;baseRevision:number;createdAt:string;provider:{taskId?:string;status:string;progress?:number;generatedImageUrl?:string;queriedAt?:string}|null;recovery:{attemptCount:number;errorCode?:string;message?:string}|null;asset:(RecoveredAsset&{url:string})|null;intake:TripoIntakeRecord|null;attachment:{revision:number;partId:string}|null};
const statusLabels:Record<string,string>={preparing:'准备生成',preparation_failed:'参考图准备失败，未提交生成',submitting:'正在提交',submission_unknown:'提交结果未知，请核对供应商',queued:'供应商排队中',running:'供应商生成中',recovering:'正在回收模型',recovered:'结果已保存，待工程审查',attached:'已加入项目',conversion_required:'原文件已保存，需要格式转换',failed:'供应商任务失败',cancelled:'供应商任务取消',banned:'供应商拒绝任务，请修改输入',invalid_glb:'模型文件校验未通过',download_host_unconfigured:'需核对下载主机',download_url_unavailable:'下载地址刷新中',download_failed:'模型下载中断，自动重试中',provider_unreachable:'连接波动，自动恢复中',provider_query_failed:'查询暂时失败，自动重试中',recovery_failed:'模型回收未完成',provider_state_unknown:'供应商状态待处理'};
const topologyLabels:Record<string,string>={no_topology_issue_detected:'未发现拓扑问题',tolerance_sensitive:'结果受容差影响',topology_issues:'发现拓扑问题'};
const retryStatuses=new Set(['provider_unreachable','provider_query_failed','download_failed','download_url_unavailable']);
const liveStatuses=new Set(['submission_unknown','queued','running','recovering',...retryStatuses]);
const progressStatuses=new Set(['preparing','submitting','submission_unknown','queued','running','recovering','recovered','conversion_required','attached',...retryStatuses]);
const generationStages=['需求提交','任务排队','三维生成','结果回收','载入工作台'];
const conceptStages=['需求提交','任务排队','设定图生成','图片回收'];
const POLL_INTERVAL_MS=8000;
const MIN_POLL_VISIBLE_MS=1200;
function stageIndex(job:Job){if(job.status==='attached')return 5;if(job.status==='recovered'||job.status==='conversion_required')return 4;if(job.status==='recovering'||retryStatuses.has(job.status)&&job.provider?.status==='success')return 3;if(job.status==='running'||retryStatuses.has(job.status))return 2;if(job.status==='queued'||job.status==='submission_unknown')return 1;return 0;}
function durationLabel(milliseconds:number){const seconds=Math.max(0,Math.floor(milliseconds/1000)),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);if(hours)return `${hours} 小时 ${minutes%60} 分`;if(minutes)return `${minutes} 分 ${seconds%60} 秒`;return `${seconds} 秒`;}
function timeLabel(value?:string){if(!value)return '等待首次状态回传';const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'刚刚';}
function GenerationProgress({job,now,nextPollAt,polling,pollCount,pollSecondsLeft}:{job:Job;now:number;nextPollAt:number|null;polling:boolean;pollCount:number;pollSecondsLeft:number}){
 if(!progressStatuses.has(job.status))return null;
 const concept=job.kind==='concept_image',stages=concept?conceptStages:generationStages,currentStage=stageIndex(job),complete=job.status==='attached'||concept&&job.status==='recovered',live=liveStatuses.has(job.status),retrying=retryStatuses.has(job.status),finishing=job.status==='recovered'||job.status==='conversion_required',rawProgress=job.provider?.progress,providerProgress=typeof rawProgress==='number'?Math.round(Math.max(0,Math.min(100,rawProgress))):null,nearComplete=job.status==='running'&&providerProgress!==null&&providerProgress>=99;
 const headline=retrying?'连接短暂波动，正在自动恢复':job.status==='queued'?'任务已接收，正在等待生成资源':concept&&nearComplete?'设定图生成接近完成，正在等待结果文件':concept&&job.status==='running'?'正在生成设定图':concept&&job.status==='recovering'?'生成完成，正在下载设定图':concept&&job.status==='recovered'?'设定图已回收，可作为三维参考图':nearComplete?'模型生成接近完成，正在等待结果文件':job.status==='running'?'正在生成三维模型':job.status==='recovering'?'生成完成，正在下载并检查模型':job.status==='recovered'||job.status==='conversion_required'?'模型已回收，正在准备载入工作台':job.status==='attached'?'三维方案已经载入工作台':job.status==='submission_unknown'?'正在确认任务是否提交成功':'正在提交生成需求';
 const detail=retrying?'原任务仍然保留，不会重新生成或重复扣费；页面每 8 秒自动重试。':nearComplete?'供应商仍报告任务处理中；页面每 8 秒继续确认，结果可下载后会立即回收。':live?'后台任务持续运行，页面每 8 秒自动获取真实状态。':concept&&complete?'图片已保存；可下载，或点击“作为 3D 参考图”。':complete?'全部步骤已经完成。':'模型文件已经保存，正在放入当前项目。';
 const countdown=live?(polling?`正在进行第 ${pollCount} 次查询`:nextPollAt?`${pollSecondsLeft} 秒后自动查询${pollCount?` · 已查询 ${pollCount} 次`:''}`:'准备自动查询'):finishing&&!concept?'正在自动载入工作台':'当前阶段已完成';
 return <section className={'generation-progress '+(complete?'complete':'')} aria-live="polite">
  <div className="generation-progress-heading"><div className="generation-pulse" aria-hidden="true"><Activity size={18}/></div><div><strong>{headline}{(job.status==='running'||retrying)&&providerProgress!==null?` · ${providerProgress}%`:''}</strong><p>{detail}</p></div></div>
  <div className={'generation-progress-bar '+(providerProgress===null&&live?'indeterminate':'')} role="progressbar" aria-label={concept?'设定图生成进度':'三维方案生成进度'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={providerProgress??undefined}><span style={providerProgress!==null?{width:`${providerProgress}%`}:undefined}/></div>
  <div className="generation-stage-list">{stages.map((label,index)=>{const done=complete||index<currentStage,active=!complete&&index===currentStage;return <div className={done?'done':active?'active':''} key={label}><span>{done?<Check size={13}/>:index+1}</span><small>{label}</small></div>;})}</div>
  <div className="generation-heartbeat"><span><Clock3 size={14}/>已运行 {durationLabel(now-Date.parse(job.createdAt))}</span><span><RotateCcw size={14}/>最近查询 {timeLabel(job.provider?.queriedAt)}</span><span className={polling?'checking':''}><Activity size={14}/>{countdown}</span></div>
 </section>;
}
async function api<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,init);const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error??'操作未完成');return data as T;}
export default function TripoJobs({project,save,run,onImported,onUseImage,autoImportJobId,canAutoImport=true,onAutoImportHandled}:{project:Project;save:()=>Promise<Project>;run:(label:string,fn:()=>Promise<void>)=>Promise<void>;onImported:(p:Project)=>Promise<void>;onUseImage?:(asset:{id:string;url:string;filename:string})=>void;autoImportJobId?:string|null;canAutoImport?:boolean;onAutoImportHandled?:()=>void}){
 const[jobs,setJobs]=useState<Job[]>([]),[message,setMessage]=useState(''),[sizes,setSizes]=useState<Record<string,number>>({}),[preview,setPreview]=useState<{jobId:string;project:Project;models:ModelMap}|null>(null),[clock,setClock]=useState(()=>Date.now()),[nextPollAt,setNextPollAt]=useState<number|null>(null),[pollingNow,setPollingNow]=useState(false),[pollCount,setPollCount]=useState(0),[pollSecondsLeft,setPollSecondsLeft]=useState(POLL_INTERVAL_MS/1000);const polling=useRef(false),jobsRef=useRef<Job[]>([]),pollNowRef=useRef<(()=>Promise<void>)|null>(null);
 const load=useCallback(async()=>{setJobs(await api<Job[]>('/api/tripo/jobs?projectId='+project.id));setMessage('');},[project.id]);
 const autoImportAttempt=useRef<string|null>(null);
 const importGenerated=useEffectEvent(async(job:Job)=>{
  await run('正在显示生成的三维方案',async()=>{
   try{
    if(job.attachment){await onImported(await api<Project>('/api/projects?id='+project.id));return;}
    if(project.revision!==job.baseRevision)throw Error('生成已完成，但项目已修改。请在任务卡片中确认加入当前版本。');
    const endpoint=job.status==='conversion_required'?'/api/tripo/intake':'/api/tripo/attach';
    const result=await api<{project:Project}>(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id,projectRevision:project.revision,targetLongestMm:project.targetSize})});
    await onImported(result.project);
    toast.success('三维方案已生成，并自动显示在工作台。');
   }catch(error){setMessage(error instanceof Error?error.message:'模型自动显示未完成，请使用任务卡片继续。');throw error;}
   finally{onAutoImportHandled?.();}
  });
 });
 useEffect(()=>{
  if(!autoImportJobId||!canAutoImport||autoImportAttempt.current===autoImportJobId)return;
  const job=jobs.find(value=>value.id===autoImportJobId);
  if(!job?.asset||!['recovered','conversion_required','attached'].includes(job.status))return;
  autoImportAttempt.current=autoImportJobId;
  void importGenerated(job);
 },[autoImportJobId,canAutoImport,jobs]);
 const process=async(job:Job,operation:'segment'|'complete'|'decimate'|'texture'|'convert')=>{
  if(!job.provider?.taskId)throw Error('该任务尚未返回可处理的 Tripo 编号。');
  const extra=operation==='convert'?{format:'STL',bake:true}:operation==='decimate'?{faceLimit:10000,bake:true}:operation==='texture'?{textureQuality:'detailed',pbr:true}:operation==='segment'?{model:'v2.0-20260430',segmentationGranularity:'balanced',splitByConnectivity:true}:{};
  const result=await api<Job>('/api/tripo/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientRequestId:randomUuid(),projectId:project.id,projectRevision:project.revision,sourceJobId:job.id,operation,...extra})});
  await load();toast.info(result.status==='queued'?'后处理任务已提交，可继续查询回收。':'后处理任务：'+result.status);
 };
 useEffect(()=>{let active=true;api<Job[]>('/api/tripo/jobs?projectId='+project.id).then(d=>{if(active){setJobs(d);setMessage('');}}).catch(e=>{if(active)setMessage(e.message);});return()=>{active=false;};},[project.id,project.revision]);
 useEffect(()=>{jobsRef.current=jobs;},[jobs]);
 const hasLiveJobs=jobs.some(job=>liveStatuses.has(job.status));
 useEffect(()=>{if(!hasLiveJobs)return;const timer=window.setInterval(()=>setClock(Date.now()),1000);return()=>window.clearInterval(timer);},[hasLiveJobs]);
 useEffect(()=>{if(!hasLiveJobs||pollingNow||nextPollAt===null)return;const timer=window.setTimeout(()=>setPollSecondsLeft(value=>Math.max(1,value-1)),1000);return()=>window.clearTimeout(timer);},[hasLiveJobs,nextPollAt,pollSecondsLeft,pollingNow]);
 useEffect(()=>{
  if(!hasLiveJobs)return;
  let cancelled=false,timer:number|undefined;
  const schedule=(nextAt=Date.now()+POLL_INTERVAL_MS)=>{if(cancelled)return;setNextPollAt(nextAt);setPollSecondsLeft(Math.min(POLL_INTERVAL_MS/1000,Math.max(1,Math.ceil((nextAt-Date.now())/1000))));timer=window.setTimeout(()=>void tick(),Math.max(0,nextAt-Date.now()));};
  const tick=async()=>{
   if(cancelled)return;
   if(timer!==undefined){window.clearTimeout(timer);timer=undefined;}
   if(document.visibilityState==='hidden'){schedule();return;}
   if(polling.current)return;
   const targets=jobsRef.current.filter(job=>liveStatuses.has(job.status));
   if(!targets.length){setNextPollAt(null);return;}
   polling.current=true;setPollCount(value=>value+1);setPollingNow(true);setNextPollAt(null);
   const startedAt=Date.now();
   try{await Promise.allSettled(targets.map(job=>api<Job>('/api/tripo/jobs?id='+job.id,{method:'PATCH'})));if(!cancelled)await load();}
   finally{
    const visibleFor=Date.now()-startedAt;
    if(visibleFor<MIN_POLL_VISIBLE_MS)await new Promise<void>(resolve=>window.setTimeout(resolve,MIN_POLL_VISIBLE_MS-visibleFor));
    polling.current=false;
    if(!cancelled){setClock(Date.now());setPollingNow(false);schedule(startedAt+POLL_INTERVAL_MS);}
   }
  };
  pollNowRef.current=tick;
  const resume=()=>{if(document.visibilityState!=='visible'||cancelled)return;if(timer!==undefined)window.clearTimeout(timer);void tick();};
  schedule();
  document.addEventListener('visibilitychange',resume);
  return()=>{cancelled=true;if(timer!==undefined)window.clearTimeout(timer);if(pollNowRef.current===tick)pollNowRef.current=null;document.removeEventListener('visibilitychange',resume);};
 },[hasLiveJobs,load]);
 const candidate=async(job:Job)=>{const asset=job.asset;if(!asset?.summary)throw Error('候选尚未准备好。');const response=await fetch(asset.url);if(!response.ok)throw Error('候选附件读取失败。');const bytes=await response.arrayBuffer();if(await sha256(bytes)!==asset.sha256)throw Error('候选附件指纹不一致。');const target=sizes[job.id]??project.targetSize;if(!Number.isFinite(target)||target<=0||target>100000)throw Error('请填写有效的加入尺寸。');const scale=1000*target/Math.max(...asset.summary.dimensionsMm),object=await importModel(bytes,asset.filename,scale),m=measure(object);const part:Part={id:job.id,name:'候选预览',kind:'asset',params:{unitScale:scale},position:[0,0,0],assetId:asset.id,assetName:asset.filename,interfaceLocked:false,color:'#8ab9cd',dimensions:m.size,triangles:m.triangles};return{part,object,target};};
 return <div className="job-list"><div className="section-title"><h2>三维方案生成进度</h2><div className="toolbar-actions"><Button variant="outline" size="sm" onClick={()=>void run('刷新三维任务',load)}><RotateCcw size={14}/>刷新</Button><Button variant="outline" size="sm" onClick={()=>void run('检查全部三维任务',async()=>{const result=await api<{processed:number;results:unknown[]}>('/api/tripo/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,limit:20})});await load();toast.info('已检查 '+result.processed+' 个未完成任务。');})}><RotateCcw size={14}/>检查全部任务</Button></div></div><p className="hint">页面会持续显示当前阶段、运行时间和查询心跳。生成完成后会自动保存并载入三维视图，无需重复提交。</p>{message&&<p className="hint">{message}</p>}{jobs.map(job=><article className="tripo-job" key={job.id}><div className="slice-job-heading"><div><h3>{job.kind==='image'?'图片生成':job.kind==='multiview'?'多视图生成':job.kind==='model'?'三维文件导入':job.kind==='concept_image'?'设定图生成':job.kind==='postprocess'?'模型后处理':'文字生成'} · {job.id.slice(0,8)}</h3><p>生成开始于 v{job.baseRevision} · {new Date(job.createdAt).toLocaleString()}</p></div><span className="reference-tag">{statusLabels[job.status]??'结果待处理'}</span></div><GenerationProgress job={job} now={clock} nextPollAt={nextPollAt} polling={pollingNow} pollCount={pollCount} pollSecondsLeft={pollSecondsLeft}/>{job.recovery?.message&&<p className="hint">{job.recovery.message}</p>}{job.asset&&<><p className="hint">{job.intake?'工程化派生文件已保存':'原文件已保存'} · {(job.asset.bytes/1024/1024).toFixed(2)} MB · 指纹 {job.asset.sha256.slice(0,12)}…</p>{job.asset.issue&&<p className="hint">{job.asset.issue}</p>}{job.intake&&<div className="hint"><strong>工程化候选已接入</strong> · 原始资产 {job.intake.originalAsset.id.slice(0,8)}… 已保留；派生方法 {job.intake.method}。<br/>模型质量：{job.intake.qualityReport.geometry.triangles.toLocaleString()} 个三角面 · {job.intake.qualityReport.geometry.dimensionsMm.map(value=>value.toFixed(2)).join(' × ')} mm · 单位比例 {job.intake.qualityReport.geometry.unitScale.toFixed(6)}<br/>拓扑检查：{topologyLabels[job.intake.qualityReport.topology.verdict]??'待复核'} · 边界边 {job.intake.qualityReport.topology.boundaryEdges} · 非流形边 {job.intake.qualityReport.topology.nonManifoldEdges} · 非流形顶点 {job.intake.qualityReport.topology.nonManifoldVertices}<br/>工程阶段：{job.intake.qualityReport.stageGate.allowedIntoNextEngineeringStage?'可继续工程检查':'需修复后继续'}；尚未通过生产验收</div>}{job.kind==='concept_image'&&<img src={job.asset.url} alt="三维方案设定图" className="reference-image"/>}{job.asset.summary&&<><p>{job.asset.summary.meshNodeCount} 个网格节点 · {job.asset.summary.triangles.toLocaleString()} 个三角面</p><p className="hint">原始尺寸：{job.asset.summary.dimensionsMm.map(v=>v.toFixed(2)).join(' × ')} mm。网格节点数量不等于可制造零件数量。</p>{job.asset.summary.warnings.map(w=><p className="hint" key={w}>{w}</p>)}{!job.attachment&&<div className="candidate-size"><label htmlFor={'size-'+job.id}>加入时最长尺寸 / mm</label><Input id={'size-'+job.id} type="number" min="0.1" max="100000" value={sizes[job.id]??project.targetSize} onChange={e=>setSizes(s=>({...s,[job.id]:+e.target.value}))}/></div>}</>}{job.attachment&&<p className="hint">已在 v{job.attachment.revision} 加入，零件编号 {job.attachment.partId.slice(0,8)}。之后的修改以项目版本为准。</p>}</>}
 <div className="toolbar-actions">{!job.asset&&<Button size="sm" variant="outline" onClick={()=>void run('检查生成进度',async()=>{if(liveStatuses.has(job.status)&&pollNowRef.current){await pollNowRef.current();toast.info('已检查最新生成进度。');return;}const updated=await api<Job>('/api/tripo/jobs?id='+job.id,{method:'PATCH'});await load();toast.info(statusLabels[updated.status]??updated.recovery?.message??updated.status);})}><RotateCcw size={14}/>立即检查进度</Button>}{job.asset&&<Button asChild size="sm" variant="outline"><a href={job.asset.url} download={job.asset.filename}><Download size={14}/>下载 {job.asset.filename.toUpperCase().endsWith('.GLB')?'GLB':job.kind==='concept_image'?'设定图':'结果文件'}</a></Button>}{job.status==='conversion_required'&&!job.intake&&<Button size="sm" onClick={()=>void run('工程化接入候选',async()=>{const result=await api<{project:Project;alreadyIntaked:boolean}>('/api/tripo/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id,projectRevision:project.revision,targetLongestMm:sizes[job.id]??project.targetSize})});await onImported(result.project);toast.info(result.alreadyIntaked?'该候选已接入，已载入项目。':'已保留原始 GLB，并以几何派生候选接入工程检查。');})}><Plus size={14}/>工程化接入候选</Button>}{job.kind==='concept_image'&&job.asset&&onUseImage&&<Button size="sm" variant="outline" onClick={()=>onUseImage({id:job.asset!.id,url:job.asset!.url,filename:job.asset!.filename})}><Plus size={14}/>作为 3D 参考图</Button>}{job.asset?.summary&&<Button size="sm" variant="outline" onClick={()=>void run('解析候选模型',async()=>{const c=await candidate(job);setPreview({jobId:job.id,project:{...project,parts:[c.part]},models:new Map([[c.part.id,c.object]])});})}><Eye size={14}/>预览</Button>}{job.asset?.summary&&!job.attachment&&<Button size="sm" onClick={()=>void run('加入候选模型',async()=>{const c=await candidate(job);const p=await save();const result=await api<{project:Project;alreadyAttached:boolean}>('/api/tripo/attach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id,projectRevision:p.revision,acceptNewerBase:true,targetLongestMm:c.target})});await onImported(result.project);toast.success(result.alreadyAttached?'该候选已加入过，已载入当前项目。':'已追加模型并保存新版本，现有零件与接口保留。');})}><Plus size={14}/>加入当前项目</Button>}{job.provider?.taskId&&job.provider.status==='success'&&job.kind!=='concept_image'&&<><Button size="sm" variant="outline" onClick={()=>void run('提交 Tripo 分件',()=>process(job,'segment'))}>自动分件</Button><Button size="sm" variant="outline" onClick={()=>void run('提交 STL 转换',()=>process(job,'convert'))}>导出 STL</Button><Button size="sm" variant="outline" onClick={()=>void run('提交网格减面',()=>process(job,'decimate'))}>网格减面</Button><Button size="sm" variant="outline" onClick={()=>void run('提交贴图重算',()=>process(job,'texture'))}>贴图重算</Button></>}</div>{job.asset?.summary&&!job.attachment&&<p className="hint">加入操作只追加候选并保存新版本。模型后处理会保留源任务，可继续查询并回收；分件与切片仍需工程审查。</p>}{preview?.jobId===job.id&&<div className="candidate-viewer"><ModelViewer project={preview.project} models={preview.models} epoch={1} onSelect={()=>{}}/></div>}</article>)}{!jobs.length&&<p className="hint">尚无三维生成任务。连接生成服务后可从文字、图片或设定图开始。</p>}</div>;
}
