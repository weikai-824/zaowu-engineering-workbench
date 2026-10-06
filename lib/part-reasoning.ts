import {partEngineeringRole,type Part,type Project} from './engineering';

export type PartReasoning={role:string;selectionReason:string;tradeoffs:string[];evidence:string[];pendingChecks:string[];confidence:number;source:'ai'|'project_data';model?:string};

export function projectPartReasoning(project:Project,part:Part):PartReasoning{
 const visual=partEngineeringRole(part)==='visual_reference';
 const role=visual?'外观方案参考':part.kind==='base'?'装配基准与支撑件':part.source?.kind==='cad'?'受控 CAD 制造零件':'独立制造零件';
 const evidence=[`项目：${project.title}`,`来源：${part.source?.kind==='tripo'?'Tripo 候选':part.source?.kind==='visual_edit'?'圈选改形外观模型':part.source?.kind==='cad'?'CAD 工程结果':part.kind==='base'?'参数化底座':'人工导入模型'}`];
 if(part.dimensions)evidence.push(`包围盒：${part.dimensions.map(value=>value.toFixed(1)).join(' × ')} mm`);
 if(part.triangles!==undefined)evidence.push(`${part.triangles.toLocaleString()} 个三角面`);
 evidence.push(part.profileId?'已绑定私有工艺参数集':'尚未绑定私有工艺参数集');
 return{
  role,
  selectionReason:visual?`“${part.name}”作为外观对照进入项目，用于比较造型和分件方向；目前没有证据将它作为制造零件。`:part.kind==='base'?`“${part.name}”保留独立零件身份，便于管理底座尺寸、接口锁定与后续装配检查。`:`“${part.name}”被列为独立制造零件，可单独绑定工艺、记录检查结果并进入工程交付。其具体功能仍需结合设计要求确认。`,
  tradeoffs:visual?['可参与外观比较；不能直接进入 BOM、切片或制造装配。']:['独立分件便于工艺和检查追溯，但装配接口及加工方式仍需核对。'],
  evidence,
  pendingChecks:visual?['若要制造，需要受控 CAD 或人工工程化，并重新检查几何与接口。']:['确认零件功能与装配位置。','核对尺寸、壁厚、接口和实际制造工艺。'],
  confidence:0,
  source:'project_data',
 };
}
