import {receiptSchema,verifyDeviceSignature,type ExecutionProof} from './execution-contract';

export type CadExecutionProofDocument={
 schema:'cad-execution-proof-v1';
 jobId:string;
 device:{id:string;label:string|null;publicKey:string;identity:'registered_software_key'};
 run:{id:string;attempt:number;leaseId:string;status:'succeeded';startedAt:string;finishedAt:string};
 chain:{inputSha256:string;runnerSha256:string;resultSha256:string};
 receipt:{schema:'execution-receipt-v1';canonicalJson:string};
 signature:{algorithm:'Ed25519';encoding:'base64url';value:string};
 verification:'registered_device_signature_verified';
 internalCadReportVerification:'unsigned_local_report';
 limitations:string[];
};

export async function cadExecutionProofDocument(jobId:string,artifactSha256:string,proof:ExecutionProof|undefined,label:string|null=null):Promise<CadExecutionProofDocument>{
 if(!proof)throw Error('当前 CAD 结果没有已登记执行器的外层签名证明。');
 let receipt;
 try{receipt=receiptSchema.parse(JSON.parse(proof.receiptJson));}catch{throw Error('CAD 执行回执格式无效。');}
 if(proof.verification!=='registered_device_signature_verified'||receipt.jobId!==jobId||receipt.deviceId!==proof.deviceId||receipt.status!=='succeeded'||receipt.resultSha256!==artifactSha256)throw Error('CAD 执行证明与当前结果不一致。');
 if(!await verifyDeviceSignature(proof.publicKey,proof.receiptJson,proof.signature))throw Error('CAD 执行证明签名复核失败。');
 return{schema:'cad-execution-proof-v1',jobId,device:{id:proof.deviceId,label,publicKey:proof.publicKey,identity:'registered_software_key'},run:{id:receipt.runId,attempt:receipt.attempt,leaseId:receipt.leaseId,status:'succeeded',startedAt:receipt.startedAt,finishedAt:receipt.finishedAt},chain:{inputSha256:receipt.inputSha256,runnerSha256:receipt.runnerSha256,resultSha256:receipt.resultSha256},receipt:{schema:'execution-receipt-v1',canonicalJson:proof.receiptJson},signature:{algorithm:'Ed25519',encoding:'base64url',value:proof.signature},verification:proof.verification,internalCadReportVerification:'unsigned_local_report',limitations:[proof.limitations,'内部 CAD report.json 仍为 unsigned_local_report。','签名不证明独立 CAD 重算、打印适用性、物理首件或生产放行。']};
}
