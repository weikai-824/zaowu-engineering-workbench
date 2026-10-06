import {inspectGlb,type GlbSummary} from './glb-inspect';
import {digitalChecks,measure,partObject,type ModelMap} from './geometry';
import {engineeringFingerprint,partUnitScale,type Evidence,type Part,type Project} from './engineering';
import type {TopologyReport,TopologyStats} from './topology';

export type QualityBaseline = {
 schema:'candidate-quality-baseline-v1';
 generatedAt:string;
 candidate:{partId:string;name:string;assetId:string|null;sourceKind:Part['kind'];unitScale:number};
 geometry:{status:Evidence['status'];readable:boolean;triangles:number;faces:number;dimensionsMm:[number,number,number];boundingBoxMm:{min:[number,number,number];max:[number,number,number]};unitScale:number;coordinateSystem:'mm_z_up_world'};
 glbInspection:{status:Evidence['status'];summary?:GlbSummary;detail:string};
 topology:{status:Evidence['status'];verdict:TopologyReport['verdict']|'not_available';boundaryEdges:number|null;nonManifoldEdges:number|null;nonManifoldVertices:number|null;exact:TopologyStats|null;tolerant:TopologyStats|null;geometryHash:string|null;detail:string;notChecked:string[]};
 evidence:Evidence[];
 stageGate:{allowedIntoNextEngineeringStage:boolean;productionReady:false;reasons:string[]};
 inputHash:string;
};

function asPoint(value:[number,number,number]){return [...value] as [number,number,number];}

/**
 * Builds one candidate's engineering quality snapshot from the existing mesh
 * measurement and digital-check paths. It never submits a provider task and it
 * does not turn missing manufacturing/physical checks into a pass.
 */
export async function buildCandidateQualityBaseline(project:Project,models:ModelMap,partId?:string,sourceGlb?:ArrayBuffer):Promise<QualityBaseline>{
 const part=project.parts.find(value=>value.id===partId)??project.parts.find(value=>value.kind==='asset')??project.parts[0];
 if(!part)throw Error('项目没有可汇总质量基线的零件。');
 const inputHash=await engineeringFingerprint(project),unitScale=partUnitScale(part),object=partObject(part,models),measured=measure(object),checks=await digitalChecks(project,models);
 const geometry=checks.find(value=>value.partId===part.id&&value.name===part.name+' · 几何可读');
 const topology=checks.find(value=>value.partId===part.id&&value.name===part.name+' · 网格拓扑');
 let glbInspection:QualityBaseline['glbInspection'];
 if(sourceGlb){try{glbInspection={status:'passed',summary:inspectGlb(sourceGlb),detail:'GLB 静态容器、场景、网格和内嵌资源检查通过。'};}catch(error){glbInspection={status:'failed',detail:error instanceof Error?error.message:'GLB 检查失败。'};}}
 else glbInspection={status:'not_run',detail:'未提供原始 GLB 字节；已使用当前载入网格完成几何与拓扑检查。'};
 const report=topology?.topology;
 const exact=report?.exact??null,tolerant=report?.tolerant??null;
 const reasons:string[]=[];
 if(geometry?.status!=='passed')reasons.push(geometry?.status==='not_run'?'几何可读性尚未完成。':'几何可读性未通过。');
 if(topology?.status!=='passed')reasons.push(topology?.status==='not_run'?'拓扑检查未完成，不能进入下一阶段。':topology?.status==='stale'?'拓扑证据已过期，不能进入下一阶段。':'拓扑检查失败：'+(report?.verdict??'topology_issues')+'。');
 if(glbInspection.status==='failed')reasons.push('GLB 静态检查失败。');
 return{schema:'candidate-quality-baseline-v1',generatedAt:new Date().toISOString(),candidate:{partId:part.id,name:part.name,assetId:part.assetId??null,sourceKind:part.kind,unitScale},geometry:{status:geometry?.status??'not_run',readable:geometry?.status==='passed',triangles:measured.triangles,faces:measured.triangles,dimensionsMm:measured.size,boundingBoxMm:{min:asPoint(measured.box.min.toArray() as [number,number,number]),max:asPoint(measured.box.max.toArray() as [number,number,number])},unitScale,coordinateSystem:'mm_z_up_world'},glbInspection,topology:{status:topology?.status??'not_run',verdict:report?.verdict??'not_available',boundaryEdges:exact?.boundaryEdges??null,nonManifoldEdges:exact?.nonManifoldEdges??null,nonManifoldVertices:exact?.nonManifoldVertices??null,exact,tolerant,geometryHash:report?.geometryHash??null,detail:topology?.detail??'拓扑检查没有生成证据。',notChecked:report?.notChecked??['self_intersection','wall_thickness','outward_orientation','shell_containment','assembly_fit','physical_manufacturing']},evidence:checks.filter(value=>value.partId===part.id||!value.partId),inputHash,stageGate:{allowedIntoNextEngineeringStage:reasons.length===0,productionReady:false,reasons}};
}
