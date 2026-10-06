import {cadPartCurrent} from './cad-result';
import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {engineeringFingerprint,isVisualReference,partUnitScale,type Part,type Project,type Evidence} from './engineering';
import {randomUuid} from './crypto-portable';
import profiles from '@/data/processes.json';
import {inspectGlb} from './glb-inspect';
import {triangleInput,analyzeInWorker} from './topology-client';
import {parametric} from './parametric-geometry';
export {parametric};
export type ModelMap=Map<string,THREE.Object3D>;
export async function importModel(buffer:ArrayBuffer,name:string,unitScale:number):Promise<THREE.Object3D>{
 if(!Number.isFinite(unitScale)||unitScale<=0)throw Error('模型 unitScale 必须是正数。');
 const ext=name.split('.').pop()?.toLowerCase();const manager=new THREE.LoadingManager();let failedResources=0;manager.onError=()=>{failedResources++;};
 // Uploaded assets are self-contained. Never resolve URLs embedded in OBJ/GLB.
 manager.setURLModifier(url=>{if(url.startsWith('blob:')||url.startsWith('data:'))return url;throw Error('模型含外部资源，请先导出为嵌入贴图的 GLB。');});
 let obj:THREE.Object3D;
 if(ext==='stl'){const g=new STLLoader().parse(buffer);g.computeVertexNormals();obj=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:'#8ab9cd',roughness:.6}));}
 else if(ext==='obj'){obj=new OBJLoader(manager).parse(new TextDecoder().decode(buffer));}
 else if(ext==='glb'){inspectGlb(buffer);const scene=(await new GLTFLoader(manager).parseAsync(buffer,'')).scene;if(failedResources)throw Error('模型贴图或资源解码失败，不能作为完整候选加入项目。');const wrapper=new THREE.Group();wrapper.rotation.x=Math.PI/2;wrapper.add(scene);obj=wrapper;}
 else throw Error('支持 STL、OBJ 或嵌入贴图的 GLB。');
 obj.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();}});obj.scale.multiplyScalar(unitScale);obj.userData.__engineeringUnitScale=unitScale;obj.updateMatrixWorld(true);
 const stat=measure(obj);if(!stat.triangles||stat.triangles>2_000_000||stat.size.some(x=>!Number.isFinite(x)||x>100000))throw Error('模型为空、尺寸异常或超过 200 万三角面，请先简化。');
 return obj;
}
export function measure(obj:THREE.Object3D){obj.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(obj,true);const size=box.getSize(new THREE.Vector3());let triangles=0;obj.traverse(o=>{if(o instanceof THREE.Mesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position?.count??0)/3;}});return {size:[size.x,size.y,size.z] as [number,number,number],triangles,box};}
function stlMaterial(part:Part){
 const name=part.name.toLowerCase();
 if(isVisualReference(part))return new THREE.MeshStandardMaterial({color:part.color,roughness:.72,metalness:.02});
 if(/glass|visor|display/.test(name))return new THREE.MeshPhysicalMaterial({color:part.color,roughness:.12,metalness:.03,clearcoat:1,clearcoatRoughness:.07,reflectivity:.92});
 if(/vent|cover|graphite/.test(name))return new THREE.MeshPhysicalMaterial({color:part.color,roughness:.36,metalness:.18,clearcoat:.28,clearcoatRoughness:.3});
 if(/plinth|support|under/.test(name))return new THREE.MeshStandardMaterial({color:part.color,roughness:.68,metalness:.08});
 return new THREE.MeshPhysicalMaterial({color:part.color,roughness:.34,metalness:.02,clearcoat:.22,clearcoatRoughness:.28});
}
export function partObject(p:Part,models:ModelMap){
 const source=p.kind==='asset'?models.get(p.id):parametric(p);if(!source)throw Error('零件模型尚未载入：'+p.name);
 const obj=source.clone(true);
 if(p.kind==='asset'){
  const expected=partUnitScale(p),applied=source.userData.__engineeringUnitScale;
  if(typeof applied==='number'&&Number.isFinite(applied)&&applied>0){if(applied!==expected)obj.scale.multiplyScalar(expected/applied);}else obj.scale.multiplyScalar(expected);
  if(p.assetName?.toLowerCase().endsWith('.stl'))obj.traverse(node=>{if(node instanceof THREE.Mesh)node.material=stlMaterial(p);});
 }
 obj.name=p.name;obj.position.add(new THREE.Vector3(...p.position));obj.userData.partId=p.id;obj.updateMatrixWorld(true);return obj;
}
export function assembly(project:Pick<Project,'title'|'parts'>,models:ModelMap){const group=new THREE.Group();group.name=project.title;for(const p of project.parts){try{group.add(partObject(p,models));}catch(e){if(!isVisualReference(p))throw e;}}group.updateMatrixWorld(true);return group;}
export async function digitalChecks(project:Project,models:ModelMap,onProgress?:(label:string)=>void):Promise<Evidence[]>{
 for(const d of project.cadDesigns??[])if(d.parts.some(s=>!project.parts.some(p=>p.id===s.id&&p.source?.kind==='cad'&&p.source.designId===d.id)))throw Error('CAD 设计尚未完整生成并附加，不能作为完整工程导出或检查。');
 for(const p of project.parts)if(!await cadPartCurrent(p,project.cadDesigns))throw Error('CAD 参数已改变，请先重新生成并附加实体模型。');
 const inputHash=await engineeringFingerprint(project);
 const checks:Evidence[]=[];const add=(name:string,status:Evidence['status'],detail:string,scope:Evidence['scope']='digital',partId?:string,topology?:Evidence['topology'])=>checks.push({id:randomUuid(),name,status,detail,scope,revision:project.revision,inputHash,partId,measuredAtRevision:project.revision,topology});
 if(!project.parts.length){add('几何输入','failed','项目没有零件。');return checks;}
 for(const [i,part] of project.parts.entries()){
  onProgress?.(`检查 ${i+1}/${project.parts.length}：${part.name}`);
  try{
   const obj=partObject(part,models),m=measure(obj);if(!m.triangles||!m.size.every(Number.isFinite))throw Error('模型三角形或坐标无效。');add(part.name+' · 几何可读',m.triangles>0?'passed':'failed',`${m.triangles.toLocaleString()} 个三角面；当前方向尺寸 ${m.size.map(x=>x.toFixed(2)).join(' × ')} mm。`,'digital',part.id);
   try{const topology=await analyzeInWorker(triangleInput(obj)),s=topology.exact;
    const detail=`边界边 ${s.boundaryEdges}；非流形边 ${s.nonManifoldEdges}；非流形顶点 ${s.nonManifoldVertices}；绕向冲突 ${s.windingConflictEdges}；重复面 ${s.duplicateFaces}；退化面 ${s.degenerateFaces}；共享边连通壳 ${s.edgeConnectedComponents}。`+(topology.verdict==='tolerance_sensitive'?'结论对 0.00001 mm 数值容差敏感，须复核。':'')+'仅分析三角网格拓扑，未修补原模型；不代表无自交或可制造。';
    add(part.name+' · 网格拓扑',topology.verdict==='no_topology_issue_detected'?'passed':'failed',detail,'digital',part.id,topology);
   }catch(e){const name=part.name+' · 网格拓扑',detail=e instanceof Error?e.message:'拓扑检查未完成。',prior=project.checks.find(c=>c.name===name&&c.partId===part.id&&c.scope==='digital'&&c.status==='failed'&&c.topology?.verdict==='topology_issues'&&c.inputHash===inputHash);if(prior){checks.push({...prior,revision:project.revision,currentAttempt:{status:'not_run',detail,attemptedAt:new Date().toISOString(),revision:project.revision,inputHash}});}else add(name,'not_run',detail,'digital',part.id);}
   const profile=profiles.find(p=>p.id===part.profileId),volume=profile?.parameters.find(p=>/构建空间|成型尺寸|成型空间|打印尺寸|成形尺寸/.test(p.name)&&Array.isArray(p.value)&&p.value.length===3);
   if(volume){const v=volume.value as number[];add(part.name+' · 包围盒初筛',m.size.every((x,i)=>x<=v[i])?'passed':'failed','按当前 XYZ 方向与私有设备能力边界比较；未包含支撑、边缘余量和排版。','digital',part.id);}else add(part.name+' · 构建空间','not_run','未选择可用的完整构建空间条目。','digital',part.id);
  }catch(e){add(part.name+' · 几何可读','failed',String(e),'digital',part.id);}
 }
 add('自交、壳嵌套与材料体积','not_run','边界及流形检查不能排除相交、重叠壳或错误内外关系。');add('局部壁厚与薄弱结构','not_run','需要几何内核与经校准的材料工艺条件。');add('装配干涉与接口公差','not_run','尚未执行装配检查。');add('切片与支撑','not_run','离线试切记录单独归档，尚未完成本工程的制造验证。','manufacturing');add('实机首件与功能测试','not_run','没有该零件的生产试验记录。','physical');return checks;
}
export async function exportEngineering(project:Project,models:ModelMap,review?:import('./output-review').OutputReviewSnapshot){const {exportEngineeringPackage}=await import('./engineering-export');return exportEngineeringPackage(project,models,review);}
