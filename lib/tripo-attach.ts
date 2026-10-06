import {ApiError} from './errors';
import {invalidate,type Part,type Project} from './engineering';
import {ownedTripoJob,recoveryState} from './tripo-recovery';
export async function attachRecoveredModel(db:D1Database,ownerId:string,input:{jobId:string;projectRevision:number;acceptNewerBase?:boolean;targetLongestMm?:number}){
 const job=await ownedTripoJob(db,input.jobId,ownerId),state=recoveryState(job);const row=await db.prepare('SELECT body,revision FROM projects WHERE id=? AND owner_id=?').bind(job.project_id,ownerId).first<{body:string;revision:number}>();if(!row)throw new ApiError(404,'项目不存在。');const project=JSON.parse(row.body) as Project;
 if(state.attachment)return{project,attachment:state.attachment,alreadyAttached:true};
 if(!state.asset||state.asset.support!=='ready'||!state.asset.summary||job.status!=='recovered')throw new ApiError(409,'模型尚未回收完成，或仍需格式转换。');
 if(row.revision!==input.projectRevision)throw new ApiError(409,'项目已在其他操作中更新，请重新载入后再加入模型。');
 if(job.base_revision!==row.revision&&!input.acceptNewerBase)throw new ApiError(409,'生成期间项目已改版。模型已保留，请明确选择加入当前版本。');
 if(project.parts.length>=200)throw new ApiError(400,'当前项目已达到 200 个零件上限。');const asset=await db.prepare('SELECT id FROM assets WHERE id=? AND owner_id=?').bind(state.asset.id,ownerId).first();if(!asset)throw new ApiError(404,'回收模型附件不存在。');
 const summary=state.asset.summary,longest=Math.max(...summary.dimensionsMm);if(!(longest>0&&Number.isFinite(longest)))throw new ApiError(400,'模型没有可用尺寸。');const factor=input.targetLongestMm===undefined?1:input.targetLongestMm/longest;if(!Number.isFinite(factor)||factor<=0||factor>1e6||summary.dimensionsMm.some(v=>v*factor>100000))throw new ApiError(400,'导入尺寸超出支持范围，请先明确模型比例。');
 const part:Part={engineeringRole:'visual_reference',id:crypto.randomUUID(),name:'Tripo 方案 '+job.id.slice(0,8),kind:'asset',params:{unitScale:1000*factor},position:[0,0,0],assetId:state.asset.id,assetName:state.asset.filename,interfaceLocked:false,color:'#8ab9cd',dimensions:summary.dimensionsMm.map(v=>v*factor) as [number,number,number],triangles:summary.triangles,source:{kind:'tripo',jobId:job.id,assetSha256:state.asset.sha256,sceneIndex:summary.sceneIndex,nodeIndices:summary.nodes.map(n=>n.nodeIndex),importerVersion:'glb-static-v1'}};
 const next={...invalidate({...project,parts:[...project.parts,part],notes:project.notes.slice(-999)},'加入已回收的 Tripo 候选模型；保留现有零件与接口，须继续工程检查。'),revision:project.revision+1};const body=JSON.stringify(next),revisionId=crypto.randomUUID();state.attachment={revision:next.revision,partId:part.id};const serialized=JSON.stringify(state);
 try{const result=await db.batch([
  db.prepare("INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND revision=?) AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND owner_id=? AND status='recovered' AND result=?)").bind(revisionId,project.id,ownerId,next.revision,body,next.updatedAt,project.id,ownerId,project.revision,job.id,ownerId,job.result),
  db.prepare('UPDATE projects SET body=?,revision=?,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)').bind(body,next.revision,next.updatedAt,project.id,ownerId,project.revision,revisionId),
  db.prepare("UPDATE jobs SET status='attached',result=?,updated_at=? WHERE id=? AND owner_id=? AND status='recovered' AND result=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)").bind(serialized,next.updatedAt,job.id,ownerId,job.result,revisionId)
 ]);if(result.some(r=>r.meta.changes!==1))throw new ApiError(409,'版本或候选已变化，请刷新项目。');}
 catch(e){const current=await ownedTripoJob(db,job.id,ownerId);const attached=recoveryState(current).attachment;if(attached){const latest=await db.prepare('SELECT body FROM projects WHERE id=? AND owner_id=?').bind(project.id,ownerId).first<{body:string}>();return{project:JSON.parse(latest!.body) as Project,attachment:attached,alreadyAttached:true};}if(e instanceof ApiError)throw e;if(String(e).includes('UNIQUE'))throw new ApiError(409,'版本冲突，模型仍保留为候选。');throw e;}
 return{project:next,attachment:state.attachment,alreadyAttached:false};
}
