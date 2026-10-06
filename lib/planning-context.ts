import {engineeringFingerprint,type Project} from './engineering';
import {TOPOLOGY_VERSION} from './topology';

export async function planningContext(project:Project,selectedPart?:string){
 const inputHash=await engineeringFingerprint(project);
 const reports=project.checks.filter(c=>c.topology&&(!selectedPart||c.partId===selectedPart));
 const evidence=reports.map(c=>({id:c.id,name:c.name,partId:c.partId,status:c.status,inputHash:c.inputHash,measuredAtRevision:c.measuredAtRevision,
  current:(c.status==='passed'||c.status==='failed')&&c.inputHash===inputHash&&c.topology!.algorithm===TOPOLOGY_VERSION,
  algorithm:c.topology!.algorithm,geometryHash:c.topology!.geometryHash,measuredAt:c.topology!.measuredAt,
  verification:c.topology!.verification,verdict:c.topology!.verdict,exact:c.topology!.exact,tolerant:c.topology!.tolerant,
  mergedDistinctVertices:c.topology!.mergedDistinctVertices,options:c.topology!.options,notChecked:c.topology!.notChecked}));
 return{project:{id:project.id,revision:project.revision,title:project.title,brief:project.brief,domain:project.domain,targetSize:project.targetSize,quantity:project.quantity,connection:project.connection,preferredProcess:project.preferredProcess,processConfiguration:project.processConfiguration??null,processConfigurationStatus:'当前工作区私有参数集的项目副本；尚未完成本项目实机试制或物理验收',parts:project.parts,cadDesigns:project.cadDesigns??[],references:project.references??[],notes:project.notes.slice(-20)},inputHash,evidence,
  remainingChecks:project.checks.filter(c=>!c.partId||!selectedPart||c.partId===selectedPart).map(c=>({id:c.id,name:c.name,partId:c.partId,status:c.status,scope:c.scope,current:(c.status==='passed'||c.status==='failed')&&c.inputHash===inputHash})),
  evidenceLimitations:'诊断来自浏览器，服务器尚未重算。过期证据不能作为当前几何事实；拓扑通过不表示无自交、壁厚合格、可制造或实机合格。'};
}

export function validateEvidenceReferences(ids:string[],context:Awaited<ReturnType<typeof planningContext>>){
 const current=new Map(context.evidence.filter(e=>e.current).map(e=>[e.id,e]));
 if(new Set(ids).size!==ids.length||ids.some(id=>!current.has(id)))throw Error('AI 引用了不存在或已过期的几何检查。');
 return ids.map(id=>current.get(id)!);
}
