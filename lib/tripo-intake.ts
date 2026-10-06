import {ApiError} from './errors';
import {engineeringFingerprint,invalidate,type Evidence,type Part,type PartSource,type Project} from './engineering';
import {inspectGlb,type GlbSummary} from './glb-inspect';
import {deriveEngineeringGlb,ENGINEERING_INTAKE_METHOD} from './glb-derived';
import {analyzeTriangles,type TopologyReport} from './topology';
import {sha256} from './slice-contract';
import {ownedTripoJob,recoveryState,type RecoveryRuntime,type TripoIntakeQualityReport,type TripoIntakeRecord} from './tripo-recovery';
import profiles from '@/data/processes.json';

const DERIVED_CONTENT_TYPE='model/gltf-binary';
const DERIVED_STATUS='attached';

function dimensions(summary:GlbSummary,factor:number){return summary.dimensionsMm.map(value=>value*factor) as [number,number,number];}

function boundingBox(coordinates:number[],factor:number){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<coordinates.length;i+=3)for(let axis=0;axis<3;axis++){const value=coordinates[i+axis]*factor;min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);}return{min:min as [number,number,number],max:max as [number,number,number]};}

function makeEvidence(name:string,status:Evidence['status'],detail:string,revision:number,inputHash:string,partId?:string,topology?:TopologyReport):Evidence{
 return{id:crypto.randomUUID(),name,status,detail,scope:'digital',revision,inputHash,partId,measuredAtRevision:revision,topology};
}

function buildChecks(project:Project,part:Part,summary:GlbSummary,topology:TopologyReport,revision:number,inputHash:string){
 const dimensionsMm=dimensions(summary,part.params.unitScale/1000),checks=[
  makeEvidence(part.name+' · 几何可读','passed',`${summary.triangles.toLocaleString()} 个三角面；物理尺寸 ${dimensionsMm.map(value=>value.toFixed(2)).join(' × ')} mm；unitScale ${part.params.unitScale.toFixed(6)}。` ,revision,inputHash,part.id),
  makeEvidence(part.name+' · 网格拓扑',topology.verdict==='no_topology_issue_detected'?'passed':'failed',`边界边 ${topology.exact.boundaryEdges}；非流形边 ${topology.exact.nonManifoldEdges}；非流形顶点 ${topology.exact.nonManifoldVertices}；绕向冲突 ${topology.exact.windingConflictEdges}；重复面 ${topology.exact.duplicateFaces}；退化面 ${topology.exact.degenerateFaces}。仅分析三角网格拓扑，未修补原模型；不代表无自交或可制造。`,revision,inputHash,part.id,topology),
 ];
 const profile=profiles.find(value=>value.id===part.profileId),volume=profile?.parameters.find(value=>/构建空间|成型尺寸|成型空间|打印尺寸|成形尺寸/.test(value.name)&&Array.isArray(value.value)&&value.value.length===3);
 if(volume){const limit=volume.value as number[];checks.push(makeEvidence(part.name+' · 包围盒初筛',dimensionsMm.every((value,index)=>value<=limit[index])?'passed':'failed','按当前 XYZ 方向与私有设备能力边界比较；未包含支撑、边缘余量和排版。',revision,inputHash,part.id));}
 else checks.push(makeEvidence(part.name+' · 构建空间','not_run','未选择可用的完整构建空间条目。',revision,inputHash,part.id));
 checks.push(makeEvidence('自交、壳嵌套与材料体积','not_run','边界及流形检查不能排除相交、重叠壳或错误内外关系。',revision,inputHash));
 checks.push(makeEvidence('局部壁厚与薄弱结构','not_run','需要几何内核与经校准的材料工艺条件。',revision,inputHash));
 checks.push(makeEvidence('装配干涉与接口公差','not_run','尚未执行装配检查。',revision,inputHash));
 checks.push({...makeEvidence('切片与支撑','not_run','离线试切记录单独归档，尚未完成本工程的制造验证。',revision,inputHash),scope:'manufacturing' as const});
 checks.push({...makeEvidence('实机首件与功能测试','not_run','没有该零件的生产试验记录。',revision,inputHash),scope:'physical' as const});
 return checks;
}

function qualityReport(part:Part,asset:{id:string;sha256:string;filename:string;bytes:number},summary:GlbSummary,topology:TopologyReport,checks:Evidence[],inputHash:string,box:{min:[number,number,number];max:[number,number,number]}):TripoIntakeQualityReport{
 const physicalDimensions=dimensions(summary,part.params.unitScale/1000),topologyStatus=topology.verdict==='no_topology_issue_detected'?'passed':'failed';
 return{schema:'candidate-quality-baseline-v1',generatedAt:new Date().toISOString(),candidate:{partId:part.id,name:part.name,assetId:part.assetId??null,sourceKind:'asset',unitScale:part.params.unitScale},geometry:{status:'passed',readable:true,triangles:summary.triangles,faces:summary.triangles,dimensionsMm:physicalDimensions,boundingBoxMm:box,unitScale:part.params.unitScale,coordinateSystem:'mm_z_up_world'},glbInspection:{status:'passed',summary,detail:'几何派生 GLB 的静态容器、场景、网格和资源检查通过；原始贴图未作为工程检查输入。'},topology:{status:topologyStatus,verdict:topology.verdict,boundaryEdges:topology.exact.boundaryEdges,nonManifoldEdges:topology.exact.nonManifoldEdges,nonManifoldVertices:topology.exact.nonManifoldVertices,exact:topology.exact,tolerant:topology.tolerant,geometryHash:topology.geometryHash,detail:`边界边 ${topology.exact.boundaryEdges}；非流形边 ${topology.exact.nonManifoldEdges}；非流形顶点 ${topology.exact.nonManifoldVertices}。`,notChecked:topology.notChecked},evidence:checks,stageGate:{allowedIntoNextEngineeringStage:topologyStatus==='passed',productionReady:false,reasons:topologyStatus==='passed'?[]:['拓扑检查失败：'+topology.verdict+'。']},inputHash,viewer:{status:'passed',detail:'派生 GLB 已通过静态检查，可由现有 Viewer 加载。'},engineeringStatus:'engineering_review_required'};
}

function parseProject(row:{body:string}){return JSON.parse(row.body) as Project;}

/** Intake a recovered Tripo GLB without contacting Tripo or changing its mesh topology. */
export async function intakeTripoCandidate(rt:RecoveryRuntime,ownerId:string,input:{jobId:string;projectRevision:number;targetLongestMm?:number}){
 const job=await ownedTripoJob(rt.DB,input.jobId,ownerId),state=recoveryState(job),projectRow=await rt.DB.prepare('SELECT body,revision,created_at FROM projects WHERE id=? AND owner_id=?').bind(job.project_id,ownerId).first<{body:string;revision:number;created_at:string}>();
 if(!projectRow)throw new ApiError(404,'项目不存在。');
 if(state.intake){return{project:parseProject(projectRow),intake:state.intake,alreadyIntaked:true};}
 if(job.status!=='conversion_required'||!state.asset||state.asset.support!=='conversion_required')throw new ApiError(409,'当前任务没有可进行工程化接入的 conversion_required 资产。');
 if(projectRow.revision!==input.projectRevision)throw new ApiError(409,'项目已在其他操作中更新，请重新载入后接入候选。');
 if(job.base_revision!==projectRow.revision)throw new ApiError(409,'生成期间项目已改版，请先将候选接入当前项目版本。');
 const original=state.asset,assetRow=await rt.DB.prepare('SELECT id,filename,content_type,size,object_key FROM assets WHERE id=? AND owner_id=?').bind(original.id,ownerId).first<{id:string;filename:string;content_type:string;size:number;object_key:string}>();
 if(!assetRow)throw new ApiError(404,'原始 Tripo 模型附件不存在。');
 const object=await rt.BUCKET.get(assetRow.object_key);if(!object)throw new ApiError(404,'原始 Tripo 模型对象不存在。');
 const originalBytes=await object.arrayBuffer();if(originalBytes.byteLength!==original.bytes||await sha256(originalBytes)!==original.sha256)throw new ApiError(409,'原始 Tripo 模型指纹校验失败，已停止接入。');
 const derivedBytes=deriveEngineeringGlb(originalBytes),coordinates:number[]=[];let summary:GlbSummary;
 try{summary=inspectGlb(derivedBytes,mmZup=>coordinates.push(...mmZup));}catch(e){throw new ApiError(422,e instanceof Error?e.message:'工程化派生 GLB 检查失败。');}
 if(!coordinates.length||coordinates.length%9)throw new ApiError(422,'工程化派生 GLB 没有可用于拓扑检查的三角坐标。');
 const topology=await analyzeTriangles({coordinates:new Float64Array(coordinates),sourceMeshes:summary.meshNodeCount,sourceVertexRecords:coordinates.length/3}),project=parseProject(projectRow),target=input.targetLongestMm??project.targetSize;
 if(!Number.isFinite(target)||target<=0||target>100000)throw new ApiError(400,'候选加入尺寸无效。');
 const factor=target/Math.max(...summary.dimensionsMm),unitScale=1000*factor,physicalDimensions=dimensions(summary,factor);if(!Number.isFinite(unitScale)||unitScale<=0||physicalDimensions.some(value=>!Number.isFinite(value)||value>100000))throw new ApiError(400,'候选物理尺寸超出支持范围。');
 if(project.parts.length>=200)throw new ApiError(400,'当前项目已达到 200 个零件上限。');
 const derivedSha=await sha256(derivedBytes),partId=crypto.randomUUID(),assetId=crypto.randomUUID(),originalSource={assetId:original.id,assetSha256:original.sha256,derivedAssetSha256:derivedSha,method:ENGINEERING_INTAKE_METHOD},tripoSource:Extract<PartSource,{kind:'tripo'}>={kind:'tripo',jobId:job.id,assetSha256:derivedSha,sceneIndex:summary.sceneIndex,nodeIndices:summary.nodes.map(node=>node.nodeIndex),importerVersion:'glb-static-v1',derivedFrom:originalSource};
 const part:Part={engineeringRole:'visual_reference',id:partId,name:'Tripo 工程化候选 '+job.id.slice(0,8),kind:'asset',params:{unitScale},position:[0,0,0],assetId,assetName:`tripo-${job.id}-engineering-intake.glb`,interfaceLocked:false,color:'#8ab9cd',dimensions:physicalDimensions,triangles:summary.triangles,profileId:(()=>{try{return JSON.parse(job.request).manufacturing?.targetProfileId||undefined;}catch{return undefined;}})(),source:tripoSource};
 const revision=project.revision+1,invalidated=invalidate({...project,parts:[...project.parts,part],notes:project.notes.slice(-999)},'通过工程化接入保存 Tripo 派生候选；原始提供商资产保留，当前候选移除嵌入贴图以进入工程检查。'),baseNext={...invalidated,revision};
 const inputHash=await engineeringFingerprint(baseNext),checks=buildChecks(baseNext,part,summary,topology,baseNext.revision,inputHash),next={...baseNext,checks},quality=qualityReport(part,{id:part.assetId!,sha256:derivedSha,filename:part.assetName!,bytes:derivedBytes.byteLength},summary,topology,checks,inputHash,boundingBox(coordinates,factor)),now=new Date().toISOString();
 const intake:TripoIntakeRecord={schema:'tripo-engineering-intake-v1',method:ENGINEERING_INTAKE_METHOD,originalAsset:{id:original.id,sha256:original.sha256,filename:original.filename,bytes:original.bytes,support:'conversion_required',issue:original.issue},derivedAsset:{id:assetId,sha256:derivedSha,filename:part.assetName!,bytes:derivedBytes.byteLength,contentType:DERIVED_CONTENT_TYPE},revision:next.revision,partId:part.id,sceneIndex:summary.sceneIndex,nodeIndices:summary.nodes.map(node=>node.nodeIndex),qualityReport:quality,createdAt:now};
 const derivedKey=`${ownerId}/tripo/${job.id}/engineering-intake-${derivedSha}.glb`,stateForSave={...state,asset:{id:part.assetId!,sha256:derivedSha,bytes:derivedBytes.byteLength,filename:part.assetName!,contentType:DERIVED_CONTENT_TYPE,summary,support:'ready' as const,downloadHost:'derived-local',recoveredAt:now},intake,attachment:{revision:next.revision,partId:part.id}},body=JSON.stringify({...next,updatedAt:now}),serialized=JSON.stringify(stateForSave),revisionId=crypto.randomUUID();
 await rt.BUCKET.put(derivedKey,derivedBytes,{httpMetadata:{contentType:DERIVED_CONTENT_TYPE}});
 try{const results=await rt.DB.batch([
  rt.DB.prepare('INSERT INTO assets(id,owner_id,filename,content_type,size,object_key,created_at) VALUES(?,?,?,?,?,?,?)').bind(part.assetId,ownerId,part.assetName,DERIVED_CONTENT_TYPE,derivedBytes.byteLength,derivedKey,now),
  rt.DB.prepare('INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND revision=?) AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND owner_id=? AND status=? AND result=?)').bind(revisionId,project.id,ownerId,next.revision,body,now,project.id,ownerId,project.revision,job.id,ownerId,'conversion_required',job.result),
  rt.DB.prepare('UPDATE projects SET body=?,revision=?,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)').bind(body,next.revision,now,project.id,ownerId,project.revision,revisionId),
  rt.DB.prepare('UPDATE jobs SET status=?,result=?,updated_at=? WHERE id=? AND owner_id=? AND status=? AND result=? AND EXISTS(SELECT 1 FROM revisions WHERE id=?)').bind(DERIVED_STATUS,serialized,now,job.id,ownerId,'conversion_required',job.result,revisionId),
 ]);if(results.some(result=>result.meta.changes!==1))throw new ApiError(409,'项目或任务已变化，候选尚未接入。');}
 catch(e){if(e instanceof ApiError)throw e;if(String(e).includes('UNIQUE'))throw new ApiError(409,'候选已接入或版本发生冲突，请刷新项目。');throw e;}
 return{project:next,intake,alreadyIntaked:false};
}
