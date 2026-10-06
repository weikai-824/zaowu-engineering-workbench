import {ApiError} from './errors';
import {inspectGlb,GlbIssue,type GlbSummary} from './glb-inspect';
import {sha256} from './slice-contract';
import type {QualityBaseline} from './quality-baseline';
import {queryTask,queryTasks,downloadModel,allowedDownloadHosts,tripoRegion,TripoIssue,tripoFetcher,type TripoRegion,type ProviderTask} from './tripo-provider';
export type TripoJob={id:string;owner_id:string;project_id:string;base_revision:number;kind:string;status:string;provider_task_id:string|null;request:string;result:string|null;updated_at:string;created_at:string};
export type RecoveredAsset={id:string;sha256:string;bytes:number;filename:string;contentType?:string;summary:GlbSummary|null;support:'ready'|'conversion_required';issue?:string;downloadHost:string;recoveredAt:string};
export type TripoIntakeQualityReport=QualityBaseline & {viewer:{status:'passed'|'failed'|'not_run';detail:string};engineeringStatus:'engineering_review_required'};
export type TripoIntakeRecord={schema:'tripo-engineering-intake-v1';method:'embedded-texture-strip-v1';originalAsset:{id:string;sha256:string;filename:string;bytes:number;support:'conversion_required';issue?:string};derivedAsset:{id:string;sha256:string;filename:string;bytes:number;contentType:string};revision:number;partId:string;sceneIndex:number;nodeIndices:number[];qualityReport:TripoIntakeQualityReport;createdAt:string};
export type RecoveryState={schemaVersion:1;provider?:{taskId:string;region:TripoRegion;status:string;progress?:number;renderedImageUrl?:string;generatedImageUrl?:string;creditsConsumed?:number;queriedAt:string};recovery?:{attemptId:string;attemptCount:number;leaseExpiresAt?:string;errorCode?:string;message?:string};asset?:RecoveredAsset;intake?:TripoIntakeRecord;attachment?:{revision:number;partId:string};};
export type RecoveryRuntime={DB:D1Database;BUCKET:R2Bucket;TRIPO_API_KEY?:string;TRIPO_REGION?:string;TRIPO_DOWNLOAD_HOSTS?:string;TRIPO_PROXY_URL?:string;TRIPO_PROXY_BRIDGE_URL?:string};
export function recoveryState(job:TripoJob):RecoveryState{try{const state=JSON.parse(job.result??'null');if(state?.schemaVersion===1)return state;}catch{}return{schemaVersion:1};}
export function recoveryDto(job:TripoJob){const s=recoveryState(job);return{id:job.id,kind:job.kind,status:job.status,projectId:job.project_id,baseRevision:job.base_revision,createdAt:job.created_at,provider:s.provider??(job.provider_task_id?{taskId:job.provider_task_id,status:job.status}:null),recovery:s.recovery?{attemptCount:s.recovery.attemptCount,errorCode:s.recovery.errorCode,message:s.recovery.message}:null,asset:s.asset?{...s.asset,url:'/api/assets?id='+s.asset.id}:null,intake:s.intake??null,attachment:s.attachment??null};}
export async function ownedTripoJob(db:D1Database,id:string,ownerId:string){const job=await db.prepare("SELECT * FROM jobs WHERE id=? AND owner_id=? AND kind IN ('text','image','multiview','model','concept_image','postprocess')").bind(id,ownerId).first<TripoJob>();if(!job)throw new ApiError(404,'三维生成任务不存在。');return job;}
function rasterContentType(data:ArrayBuffer){const b=new Uint8Array(data);if(b.length>=8&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&b[4]===0x0d&&b[5]===0x0a&&b[6]===0x1a&&b[7]===0x0a)return'image/png';if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return'image/jpeg';if(b.length>=12&&b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50)return'image/webp';throw new TripoIssue('image_output_invalid','供应商返回的设定图不是受支持的 PNG/JPEG/WebP 文件。');}
async function restoreReceipt(rt:RecoveryRuntime,ownerId:string,job:TripoJob){
 if(job.provider_task_id||!['preparing','submitting','submission_unknown'].includes(job.status))return job;
 const stored=await rt.BUCKET.get(`${ownerId}/tripo-receipts/${job.id}.json`);if(!stored)return job;
 if(stored.size>4096)throw new ApiError(409,'供应商回执格式异常，请核对原任务。');
 let receipt:{jobId:string;taskId:string;apiRegion:TripoRegion;receivedAt:string};
 try{const bytes=await stored.arrayBuffer();if(bytes.byteLength>4096)throw Error();receipt=JSON.parse(new TextDecoder().decode(bytes));const request=JSON.parse(job.request);if(receipt.jobId!==job.id||typeof receipt.taskId!=='string'||!receipt.taskId||receipt.taskId.length>256||receipt.apiRegion!==tripoRegion(request.apiRegion??'global')||typeof receipt.receivedAt!=='string'||!Number.isFinite(Date.parse(receipt.receivedAt)))throw Error();}
 catch{throw new ApiError(409,'供应商回执格式异常，请核对原任务。');}
 await rt.DB.prepare("UPDATE jobs SET provider_task_id=?,status='queued',updated_at=? WHERE id=? AND owner_id=? AND provider_task_id IS NULL AND status=? AND updated_at=? AND request=?").bind(receipt.taskId,new Date().toISOString(),job.id,ownerId,job.status,job.updated_at,job.request).run();
 return ownedTripoJob(rt.DB,job.id,ownerId);
}
export async function recoverTripoJob(rt:RecoveryRuntime,ownerId:string,id:string,fetcher:typeof fetch=tripoFetcher(rt.TRIPO_PROXY_URL,rt.TRIPO_PROXY_BRIDGE_URL),prefetched?:ProviderTask){
 const job=await restoreReceipt(rt,ownerId,await ownedTripoJob(rt.DB,id,ownerId)),previous=recoveryState(job);if(previous.asset||previous.attachment)return recoveryDto(job);if(!job.provider_task_id)return recoveryDto(job);
 if(job.status==='recovering'&&previous.recovery?.leaseExpiresAt&&Date.parse(previous.recovery.leaseExpiresAt)>Date.now())return recoveryDto(job);
 if(!rt.TRIPO_API_KEY)throw new ApiError(503,'Tripo 尚未连接。');let region:TripoRegion;try{region=tripoRegion(JSON.parse(job.request).apiRegion??'global');}catch{throw new ApiError(400,'该任务的供应商地域记录无效。');}
 const now=new Date().toISOString(),deadlineMs=Date.now()+120000;const state:RecoveryState={...previous,schemaVersion:1,recovery:{attemptId:crypto.randomUUID(),attemptCount:(previous.recovery?.attemptCount??0)+1,leaseExpiresAt:new Date(deadlineMs).toISOString()}};const claim=JSON.stringify(state);
 const claimed=await rt.DB.prepare("UPDATE jobs SET status='recovering',result=?,updated_at=? WHERE id=? AND owner_id=? AND status=? AND updated_at=? AND COALESCE(result,'')=?").bind(claim,now,id,ownerId,job.status,job.updated_at,job.result??'').run();if(claimed.meta.changes!==1)return recoveryDto(await ownedTripoJob(rt.DB,id,ownerId));
 let finishing=false;
 const finish=async(status:string,next:RecoveryState,asset?:{id:string;filename:string;contentType:string;size:number;key:string})=>{
  finishing=true;if(Date.now()>=deadlineMs)throw new ApiError(409,'回收尝试已超时，请查询同一任务继续。');
  const at=new Date().toISOString();if(next.recovery)delete next.recovery.leaseExpiresAt;
  const statements:D1PreparedStatement[]=[];
  // The asset insert is the lease check and linearization point in this atomic D1 batch.
  // The following update depends on that exact new row, so crossing the deadline between statements cannot leave a partial commit.
  if(asset){
   statements.push(rt.DB.prepare("INSERT INTO assets(id,owner_id,filename,content_type,size,object_key,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=? AND owner_id=? AND status='recovering' AND result=?) AND (julianday('now')-2440587.5)*86400000 < ?").bind(asset.id,ownerId,asset.filename,asset.contentType,asset.size,asset.key,at,id,ownerId,claim,deadlineMs));
   statements.push(rt.DB.prepare("UPDATE jobs SET status=?,result=?,updated_at=? WHERE id=? AND owner_id=? AND status='recovering' AND result=? AND EXISTS(SELECT 1 FROM assets WHERE id=? AND owner_id=? AND object_key=?)").bind(status,JSON.stringify(next),at,id,ownerId,claim,asset.id,ownerId,asset.key));
  }else statements.push(rt.DB.prepare("UPDATE jobs SET status=?,result=?,updated_at=? WHERE id=? AND owner_id=? AND status='recovering' AND result=? AND (julianday('now')-2440587.5)*86400000 < ?").bind(status,JSON.stringify(next),at,id,ownerId,claim,deadlineMs));
  const result=await rt.DB.batch(statements);if(result.some(r=>r.meta.changes!==1))throw new ApiError(409,'此回收尝试已超时或被更新的操作接替，请刷新任务。');return recoveryDto(await ownedTripoJob(rt.DB,id,ownerId));
 };
 try{
  const signal=AbortSignal.timeout(90000),config={key:rt.TRIPO_API_KEY,region,signal,fetcher};let provider=prefetched?.taskId===job.provider_task_id?prefetched:await queryTask(job.provider_task_id,config);
  const remember=(p:ProviderTask)=>{state.provider={taskId:p.taskId,region,status:p.status,progress:p.progress,renderedImageUrl:p.renderedImageUrl,generatedImageUrl:p.generatedImageUrl,creditsConsumed:p.creditsConsumed,queriedAt:new Date().toISOString()};};remember(provider);
  if(provider.status!=='success'){const status=['queued','running','failed','cancelled','banned'].includes(provider.status)?provider.status:'provider_state_unknown';if(state.recovery)state.recovery.message=provider.error??(status==='provider_state_unknown'?'供应商返回了未支持的任务状态，请核对原任务。':'');return await finish(status,state);}
  const options={hosts:allowedDownloadHosts(rt.TRIPO_DOWNLOAD_HOSTS),signal,fetcher};
  if(job.kind==='concept_image'){
   if(!provider.generatedImageUrl)throw new TripoIssue('provider_output_missing','设定图任务成功，但供应商没有返回图像地址。');
   const downloaded=await downloadModel(provider.generatedImageUrl,options),contentType=rasterContentType(downloaded.data),extension=contentType==='image/png'?'png':contentType==='image/jpeg'?'jpg':'webp',digest=await sha256(downloaded.data),assetId=crypto.randomUUID(),filename=`tripo-${id}.${extension}`,key=`${ownerId}/tripo/${id}/${digest}.${extension}`;await rt.BUCKET.put(key,downloaded.data,{httpMetadata:{contentType}});state.asset={id:assetId,sha256:digest,bytes:downloaded.data.byteLength,filename,contentType,summary:null,support:'ready',downloadHost:downloaded.host,recoveredAt:new Date().toISOString()};return await finish('recovered',state,{id:assetId,filename,contentType,size:downloaded.data.byteLength,key});
  }
  if(!provider.modelUrl)throw new TripoIssue('provider_output_missing','任务成功，但供应商没有返回模型地址。');let downloaded;
  try{downloaded=await downloadModel(provider.modelUrl,options);}catch(e){if(!(e instanceof TripoIssue)||e.code!=='download_url_unavailable')throw e;provider=await queryTask(job.provider_task_id,config);remember(provider);if(provider.status!=='success'||!provider.modelUrl)throw new TripoIssue('provider_output_missing','重新查询原任务后仍没有可回收模型。');downloaded=await downloadModel(provider.modelUrl,options);}
  const requestSpec=(()=>{try{return JSON.parse(job.request) as {operation?:string;format?:string};}catch{return {};}})();const convertedFormat=requestSpec.operation==='convert'&&typeof requestSpec.format==='string'?requestSpec.format.toLowerCase():null;
  let summary:GlbSummary|null=null,support:RecoveredAsset['support']='ready',issue:string|undefined,contentType='model/gltf-binary';
  if(convertedFormat){support='conversion_required';issue=`已保存 Tripo ${convertedFormat.toUpperCase()} 文件；该格式需在对应 CAD/切片软件中复核。`;contentType=convertedFormat==='stl'?'model/stl':convertedFormat==='obj'?'text/plain':convertedFormat==='3mf'?'model/3mf':'application/octet-stream';}else{try{summary=inspectGlb(downloaded.data);}catch(e){if(e instanceof GlbIssue&&e.code==='conversion_required'){support='conversion_required';issue=e.message;}else throw e;}}
  const digest=await sha256(downloaded.data),assetId=crypto.randomUUID(),extension=convertedFormat??'glb',filename=`tripo-${id}.${extension}`,key=`${ownerId}/tripo/${id}/${digest}.${extension}`;
  await rt.BUCKET.put(key,downloaded.data,{httpMetadata:{contentType}});
  state.asset={id:assetId,sha256:digest,bytes:downloaded.data.byteLength,filename,contentType,summary,support,issue,downloadHost:downloaded.host,recoveredAt:new Date().toISOString()};
  return await finish(support==='ready'?'recovered':'conversion_required',state,{id:assetId,filename,contentType,size:downloaded.data.byteLength,key});
 }catch(e){if(finishing||e instanceof ApiError)throw e;const code=e instanceof TripoIssue||e instanceof GlbIssue?e.code:'recovery_failed';const message=e instanceof TripoIssue||e instanceof GlbIssue?e.message:'回收暂时未完成，可查询同一任务继续；不会重新提交生成。';if(state.recovery){state.recovery.errorCode=code;state.recovery.message=message;}return await finish(code,state);}
}

export async function reconcileTripoJobs(rt:RecoveryRuntime,ownerId:string,projectId?:string,limit=20,fetcher:typeof fetch=tripoFetcher(rt.TRIPO_PROXY_URL,rt.TRIPO_PROXY_BRIDGE_URL)){
 if(!rt.TRIPO_API_KEY)throw new ApiError(503,'Tripo 尚未连接。');
 const safeLimit=Math.max(1,Math.min(20,Math.trunc(limit||20))),active=['preparing','submitting','submission_unknown','queued','running','recovering'];
 const query=projectId
  ? `SELECT * FROM jobs WHERE owner_id=? AND project_id=? AND kind IN ('text','image','multiview','model','concept_image','postprocess') AND status IN (${active.map(()=>'?').join(',')}) ORDER BY updated_at ASC LIMIT ?`
  : `SELECT * FROM jobs WHERE owner_id=? AND kind IN ('text','image','multiview','model','concept_image','postprocess') AND status IN (${active.map(()=>'?').join(',')}) ORDER BY updated_at ASC LIMIT ?`;
 const args=projectId?[ownerId,projectId,...active,safeLimit]:[ownerId,...active,safeLimit];
 const rows=await rt.DB.prepare(query).bind(...args).all<TripoJob>();
 const prefetched=new Map<string,ProviderTask>(),groups=new Map<TripoRegion,string[]>();
 for(const job of rows.results){if(!job.provider_task_id)continue;try{const request=JSON.parse(job.request) as {apiRegion?:string};const region=tripoRegion(request.apiRegion??'global');const ids=groups.get(region)??[];ids.push(job.provider_task_id);groups.set(region,ids);}catch{/* recoverTripoJob will report malformed task metadata */}}
 for(const [region,ids] of groups){try{const tasks=await queryTasks([...new Set(ids)],{key:rt.TRIPO_API_KEY,region,signal:AbortSignal.timeout(90_000),fetcher});for(const [id,task] of tasks)prefetched.set(id,task);}catch{/* fall back to individual recovery so one regional batch failure cannot hide jobs */}}
 const results:unknown[]=[];
 for(const job of rows.results){
  try{results.push(await recoverTripoJob(rt,ownerId,job.id,fetcher,job.provider_task_id?prefetched.get(job.provider_task_id):undefined));}
  catch(e){results.push({id:job.id,projectId:job.project_id,status:'reconcile_error',message:e instanceof ApiError?e.message:'回收暂时未完成，请稍后重试。'});}
 }
 return{processed:results.length,results};
}
