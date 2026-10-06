import {engineeringFingerprint,isManufacturingPart,type Evidence,type Project} from './engineering';
import type {SliceManifest} from './slice-contract';

export type SliceVerificationSummary={
 artifactSha256:string;
 layerCount:number;
 estimatedSeconds:number;
 estimatedGrams:number|null;
 geometryProof:'embedded_mesh_matches_input_within_tolerance';
 savedPartBinding:string;
 physicalValidation:'not_run';
 productionReady:boolean;
 executionAttestation:'unsigned_local_report';
 geometryComparison?:{matchedTriangles:number;toleranceMm:number;maxCoordinateErrorMm:number;translationMm:number[]};
};

export function assertManufacturingSlicePart(project:Project,partId:string){
 const part=project.parts.find(value=>value.id===partId);
 if(!part)throw Error('该版本没有此零件。');
 if(!isManufacturingPart(part))throw Error('Visual Candidate 只能作为 visual_reference，不能创建实际切片任务。');
 return part;
}

export async function appendSliceEvidence(project:Project,manifest:SliceManifest,manifestSha256:string,summary:SliceVerificationSummary,now=new Date().toISOString()){
 if(manifest.projectId!==project.id||summary.artifactSha256.length!==64||summary.productionReady!==false||summary.physicalValidation!=='not_run')throw Error('切片证据与项目身份或验证边界不一致。');
 const currentPart=project.parts.find(part=>part.id===manifest.part.id),currentHash=await engineeringFingerprint(project);
 const current=!!currentPart&&isManufacturingPart(currentPart)&&currentHash===manifest.projectInputHash;
 const revision=project.revision+1,status:Evidence['status']=current?'passed':'stale';
 const comparison=summary.geometryComparison;
 const detail=current
  ?`固定任务输入、保存零件、STL 与 3MF 内嵌网格一致；${comparison?`${comparison.matchedTriangles.toLocaleString()} 个三角面，最大坐标差 ${comparison.maxCoordinateErrorMm.toExponential(2)} mm；`:''}${summary.layerCount} 层。结果来源未签名，physicalValidation=not_run，productionReady=false。`
  :`该离线结果通过原任务一致性核对，但当前项目输入或制造对象已改变；仅保留为历史证据。physicalValidation=not_run，productionReady=false。`;
 const evidence:Evidence={id:crypto.randomUUID(),name:manifest.part.name+' · 离线切片一致性',status,detail,scope:'manufacturing',revision,inputHash:manifest.projectInputHash,partId:manifest.part.id,measuredAtRevision:manifest.projectRevision,provenance:{kind:'offline_slice',jobId:manifest.jobId,manifestSha256,artifactSha256:summary.artifactSha256,partId:manifest.part.id,verification:'offline_consistent',executionAttestation:'unsigned_local_report',physicalValidation:'not_run',productionReady:false}};
 const note=current?'归档离线切片一致性证据；这不是物理首件或生产放行。':'归档已过期的离线切片一致性证据；当前工程输入未被其覆盖。';
 return{project:{...project,revision,checks:[...project.checks,evidence],notes:[...project.notes.slice(-999),note],updatedAt:now},evidence,current};
}
