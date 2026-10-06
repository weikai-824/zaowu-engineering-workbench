import {ApiError,type runtime} from './server';
import {readCadResult,type CadTask} from './cad-result';
import {sha256} from './slice-contract';
import type {ExecutionRow,ExecutionProof} from './execution-contract';
type Runtime=ReturnType<typeof runtime>;
export async function archiveCadResult(rt:Runtime,uid:string,id:string,bytes:ArrayBuffer,execution?:{run:ExecutionRow;proof:ExecutionProof}){
 const row=await rt.DB.prepare("SELECT request,result FROM jobs WHERE id=? AND owner_id=? AND kind='cad_build'").bind(id,uid).first<{request:string;result:string|null}>();if(!row)throw new ApiError(404,'CAD 任务不存在。');const hash=await sha256(bytes);let stored;
 if(row.result){const previous=JSON.parse(row.result);if(previous.artifactSha256!==hash)throw new ApiError(409,'该任务已有另一份结果，请创建新任务。');if(!execution)return previous.summary;if(previous.executionProof){if(previous.executionProof.receiptJson===execution.proof.receiptJson&&previous.executionProof.signature===execution.proof.signature)return previous.summary;throw new ApiError(409,'该结果已关联另一份执行来源，不能覆盖。');}stored=previous;}
 else{const task=JSON.parse(row.request)as CadTask;let result;try{result=await readCadResult(bytes,task);}catch(e){throw new ApiError(400,e instanceof Error?e.message:'CAD 文件不一致。');}const now=new Date().toISOString(),assets=[];
  for(const p of result.parts){const assetId=crypto.randomUUID(),key=`${uid}/cad/${id}/${assetId}.stl`;await rt.BUCKET.put(key,p.stl,{httpMetadata:{contentType:'application/octet-stream'}});await rt.DB.prepare('INSERT INTO assets(id,owner_id,filename,content_type,size,object_key,created_at) VALUES(?,?,?,?,?,?,?)').bind(assetId,uid,p.part.id+'.stl','application/octet-stream',p.stl.length,key,now).run();assets.push({partId:p.part.id,assetId,sha256:p.sha256,position:p.position,dimensions:p.info.dimensionsMm,triangles:p.info.triangles});}
  const objectKey=`${uid}/cad/${id}/${hash}.zip`;await rt.BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:'application/zip'}});stored={objectKey,artifactSha256:hash,designId:result.design.id,designSha256:task.designSha256,assets,summary:result.summary};
 }
 if(execution){stored.executionProof=execution.proof;stored.summary.executionProof=execution.proof;}
 const json=JSON.stringify(stored),now=new Date().toISOString();const gate=execution?" AND EXISTS(SELECT 1 FROM execution_runs r JOIN execution_devices d ON d.id=r.device_id WHERE r.id=? AND r.owner_id=? AND r.lease_id=? AND r.status='leased' AND r.lease_until>=? AND d.status='active' AND d.owner_id=?)":'';
 const args=execution?[execution.run.id,uid,execution.run.lease_id,Date.now(),uid]:[];const update=rt.DB.prepare("UPDATE jobs SET status=CASE WHEN status='attached' THEN status ELSE 'result_archived' END,result=?,updated_at=? WHERE id=? AND owner_id=? AND result IS ?"+gate).bind(json,now,id,uid,row.result,...args);
 if(execution){const r=execution.run,p=execution.proof;const changes=await rt.DB.batch([update,
  rt.DB.prepare("UPDATE execution_runs SET status='succeeded',receipt_json=?,signature=?,error=NULL,updated_at=? WHERE id=? AND owner_id=? AND lease_id=? AND status='leased' AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND owner_id=? AND result=?)").bind(p.receiptJson,p.signature,now,r.id,uid,r.lease_id,id,uid,json),
  rt.DB.prepare("UPDATE execution_attempts SET status='succeeded',receipt_json=?,signature=?,updated_at=? WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM execution_runs WHERE id=? AND status='succeeded' AND receipt_json=? AND signature=?)").bind(p.receiptJson,p.signature,now,r.lease_id,uid,r.id,p.receiptJson,p.signature)
 ]);if(changes.some(c=>c.meta.changes!==1))throw new ApiError(409,'领取已改变或另一份结果已归档，请刷新状态。');}
 else{const changed=await update.run();if(changed.meta.changes!==1){const current=await rt.DB.prepare('SELECT result FROM jobs WHERE id=? AND owner_id=?').bind(id,uid).first<{result:string}>();if(current?.result&&JSON.parse(current.result).artifactSha256===hash)return JSON.parse(current.result).summary;throw new ApiError(409,'另一份结果已归档，请刷新。');}}
 return stored.summary;
}
