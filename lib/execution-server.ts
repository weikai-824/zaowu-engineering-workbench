import {ApiError} from './errors';
import {receiptSchema,verifyDeviceSignature,type ExecutionRow,type ExecutionProof} from './execution-contract';
export async function ownedRun(db:D1Database,uid:string,id:string){const row=await db.prepare('SELECT * FROM execution_runs WHERE id=? AND owner_id=?').bind(id,uid).first<ExecutionRow>();if(!row)throw new ApiError(404,'执行任务不存在。');return row;}
export async function activeDevice(db:D1Database,uid:string,id:string){const row=await db.prepare("SELECT id,public_key,label FROM execution_devices WHERE id=? AND owner_id=? AND status='active'").bind(id,uid).first<{id:string;public_key:string;label:string}>();if(!row)throw new ApiError(403,'执行器未登记或已撤销。');return row;}
export async function verifyReceipt(db:D1Database,uid:string,run:ExecutionRow,receiptJson:string,signature:string){
 if(receiptJson.length>7000)throw new ApiError(400,'执行记录过大。');let receipt;try{receipt=receiptSchema.parse(JSON.parse(receiptJson));}catch{throw new ApiError(400,'执行记录格式无效。');}
 const d=await activeDevice(db,uid,run.device_id);
 if(!await verifyDeviceSignature(d.public_key,receiptJson,signature))throw new ApiError(400,'执行结果签名不匹配。');
 if(receipt.runId!==run.id||receipt.jobId!==run.job_id||receipt.deviceId!==run.device_id||receipt.attempt!==run.attempt||receipt.leaseId!==run.lease_id||receipt.inputSha256!==run.input_sha256||receipt.runnerSha256!==run.runner_sha256||Date.parse(receipt.finishedAt)<Date.parse(receipt.startedAt)||Date.parse(receipt.finishedAt)>Date.now()+300000||(receipt.status==='succeeded')!==(receipt.resultSha256!==null))throw new ApiError(409,'执行记录与当前领取版本不一致。');
 const proof:ExecutionProof={deviceId:d.id,publicKey:d.public_key,receiptJson,signature,verification:'registered_device_signature_verified',limitations:'Software-key provenance only; not hardware attestation, independent CAD recomputation or manufacturing validation'};
 return{receipt,proof};
}
export function assertLease(run:ExecutionRow){if(run.status!=='leased'||!run.lease_until||run.lease_until<Date.now())throw new ApiError(409,'领取已过期、取消或结束。请重新连接并核对任务状态。');}
