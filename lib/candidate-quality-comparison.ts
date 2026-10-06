import type {QualityBaseline} from './quality-baseline';

export type CandidateComparisonMetric={golden:number|null;highQuality:number|null;delta:number|null;status:'available'|'not_run'};
export type CandidateQualityComparison={
 schema:'candidate-quality-comparison-v1';
 candidates:{golden:{status:'available'|'not_run';candidateId:string|null;name:string|null;stageGate:boolean|null};highQuality:{status:'available'|'not_run';candidateId:string|null;name:string|null;stageGate:boolean|null}};
 metrics:{triangles:CandidateComparisonMetric;dimensionsMm:{golden:[number,number,number]|null;highQuality:[number,number,number]|null;delta:[number,number,number]|null;status:'available'|'not_run'};boundaryEdges:CandidateComparisonMetric;nonManifoldEdges:CandidateComparisonMetric;nonManifoldVertices:CandidateComparisonMetric};
 topologyVerdict:{golden:QualityBaseline['topology']['verdict']|null;highQuality:QualityBaseline['topology']['verdict']|null;status:'available'|'not_run'};
 stageGate:{golden:boolean|null;highQuality:boolean|null;status:'available'|'not_run'};
};

function numberValue(report:QualityBaseline|null,read:(value:QualityBaseline)=>number|null):number|null{return report?read(report):null;}
function metric(golden:QualityBaseline|null,highQuality:QualityBaseline|null,read:(value:QualityBaseline)=>number|null):CandidateComparisonMetric{
 const g=numberValue(golden,read),h=numberValue(highQuality,read);return{golden:g,highQuality:h,delta:g!==null&&h!==null?h-g:null,status:g!==null||h!==null?'available':'not_run'};
}
function dimensions(golden:QualityBaseline|null,highQuality:QualityBaseline|null){
 const g=golden?.geometry.dimensionsMm??null,h=highQuality?.geometry.dimensionsMm??null;
 return{golden:g,highQuality:h,delta:g&&h?[h[0]-g[0],h[1]-g[1],h[2]-g[2]] as [number,number,number]:null,status:g||h?'available' as const:'not_run' as const};
}

/** Compares only available quality reports; missing candidates remain not_run. */
export function compareCandidateQuality(golden:QualityBaseline|null,highQuality:QualityBaseline|null):CandidateQualityComparison{
 return{schema:'candidate-quality-comparison-v1',candidates:{golden:{status:golden?'available':'not_run',candidateId:golden?.candidate.partId??null,name:golden?.candidate.name??null,stageGate:golden?.stageGate.allowedIntoNextEngineeringStage??null},highQuality:{status:highQuality?'available':'not_run',candidateId:highQuality?.candidate.partId??null,name:highQuality?.candidate.name??null,stageGate:highQuality?.stageGate.allowedIntoNextEngineeringStage??null}},metrics:{triangles:metric(golden,highQuality,value=>value.geometry.triangles),dimensionsMm:dimensions(golden,highQuality),boundaryEdges:metric(golden,highQuality,value=>value.topology.boundaryEdges),nonManifoldEdges:metric(golden,highQuality,value=>value.topology.nonManifoldEdges),nonManifoldVertices:metric(golden,highQuality,value=>value.topology.nonManifoldVertices)},topologyVerdict:{golden:golden?.topology.verdict??null,highQuality:highQuality?.topology.verdict??null,status:golden||highQuality?'available':'not_run'},stageGate:{golden:golden?.stageGate.allowedIntoNextEngineeringStage??null,highQuality:highQuality?.stageGate.allowedIntoNextEngineeringStage??null,status:golden||highQuality?'available':'not_run'}};
}
