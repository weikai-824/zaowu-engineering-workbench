import type JSZip from 'jszip';
import {xmlEvents,type XmlTag} from './xml-events';
import {MESH_IDENTITY_MAX_FACES} from './mesh-identity';
const CORE='http://schemas.microsoft.com/3dmanufacturing/core/2015/02',PROD='http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const REL='http://schemas.openxmlformats.org/package/2006/relationships',MODEL_REL='http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
type Ref={id:number;path?:string;transform:number[]};
type ObjectRecord={id:number;vertices?:Float64Array;indices?:Uint32Array;components:Ref[]};
type Document={objects:Map<number,ObjectRecord>;build:Ref[]};
const identity=[1,0,0,0,1,0,0,0,1,0,0,0];
const attribute=(t:XmlTag,key:string,ns='')=>t.expanded[ns+'|'+key];
function integer(x:string|undefined,label:string,min=0){if(x===undefined||!/^\d+$/.test(x)||!Number.isSafeInteger(Number(x))||Number(x)<min||Number(x)>1e9)throw Error('3MF '+label+' 无效。');return Number(x);}
function number(x:string|undefined){if(x===undefined||!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(x)||!/^[-.0-9]/.test(x)||!Number.isFinite(Number(x))||Math.abs(Number(x))>100000)throw Error('3MF 坐标无效。');return Number(x);}
function transform(value:string|undefined){if(value===undefined)return [...identity];const v=value.trim().split(/\s+/).map(x=>number(x));if(v.length!==12)throw Error('3MF 变换矩阵无效。');
 // This pinned recipe disables rotations. Do not hide rotation/scale/mirror by registration.
 if(v.slice(0,9).some((x,i)=>Math.abs(x-identity[i])>1e-12))throw Error('当前固定切片配置只允许平移；发现旋转、镜像、缩放或剪切。');return v;
}
function pathName(value:string){const name=value.startsWith('/')?value.slice(1):value;if(!/^3D\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.model$/.test(name)||name.split('/').some(x=>x==='.'||x==='..'))throw Error('3MF 模型引用路径不受支持。');return name;}
function reference(t:XmlTag):Ref{return {id:integer(attribute(t,'objectid'),'objectid',1),path:attribute(t,'path',PROD)?pathName(attribute(t,'path',PROD)!):undefined,transform:transform(attribute(t,'transform'))};}
class Numbers{
 private data:Float64Array|Uint32Array;length=0;
 constructor(private max:number,private integer=false){this.data=integer?new Uint32Array(Math.min(1024,max)):new Float64Array(Math.min(1024,max));}
 push(...values:number[]){if(this.length+values.length>this.max)throw Error('3MF 几何超过在线关联预算。');if(this.length+values.length>this.data.length){const next=this.integer?new Uint32Array(Math.min(this.max,this.data.length*2)):new Float64Array(Math.min(this.max,this.data.length*2));next.set(this.data);this.data=next;}this.data.set(values,this.length);this.length+=values.length;}
 finish(){return this.data.slice(0,this.length);}
}
function readModel(text:string):Document{
 const objects=new Map<number,ObjectRecord>(),build:Ref[]=[],singletons=new Set<string>();let current:ObjectRecord|undefined,vertices:Numbers|undefined,indices:Numbers|undefined,meshes=0;
 const containers=new Set(['model','model/resources','model/build','model/resources/object','model/resources/object/mesh','model/resources/object/mesh/vertices','model/resources/object/mesh/triangles','model/resources/object/components']);
 xmlEvents(text,(tag,parents)=>{
  const path=[...parents.map(p=>p.local),tag.local].join('/');
  if(tag.ns!==CORE||tag.name!==tag.local)throw Error('当前 3MF 几何含未支持的元素命名空间。');
  if(containers.has(path)&&path!=='model/resources/object'){const key=(current?.id??0)+'|'+path;if(singletons.has(key))throw Error('3MF 几何容器重复，不能可靠解释。');singletons.add(key);}
  for(const key of Object.keys(tag.attrs)){if(key.includes(':')&&!key.startsWith('xmlns:')&&key!=='xml:lang'&&!['p:path','p:UUID'].includes(key))throw Error('固定 Bambu 格式不支持该属性前缀：'+key);}
  if(tag.local==='vertex'||tag.local==='triangle'){const permitted=tag.local==='vertex'?['|x','|y','|z']:['|v1','|v2','|v3'];if(Object.keys(tag.expanded).some(key=>!permitted.includes(key)))throw Error('当前固定单色配置不支持逐面涂色、支撑或其他几何属性。');}
  if(path==='model'){
   if(tag.namespaces.p!==PROD)throw Error('固定 Bambu 格式需要标准 p 扩展前缀。');
   if(attribute(tag,'unit')!=='millimeter')throw Error('固定参考 3MF 必须明确使用毫米。');
   for(const prefix of (attribute(tag,'requiredextensions')??'').split(/\s+/).filter(Boolean))if(prefix!=='p'||tag.namespaces[prefix]!==PROD)throw Error('3MF 含尚未支持的必需扩展。');
  }else if(path==='model/metadata')return;
  else if(path==='model/resources/object'){
   const id=integer(attribute(tag,'id'),'对象编号',1);if(objects.has(id)||objects.size>=64||attribute(tag,'type')!=='model')throw Error('3MF 对象重复、过多或不是普通模型。');current={id,components:[]};objects.set(id,current);meshes=0;
  }else if(path==='model/resources/object/mesh'){
   if(!current||++meshes!==1||current.components.length)throw Error('3MF 对象混合或重复几何。');vertices=new Numbers(MESH_IDENTITY_MAX_FACES*9);indices=new Numbers(MESH_IDENTITY_MAX_FACES*3,true);
  }else if(path==='model/resources/object/mesh/vertices/vertex')vertices!.push(number(attribute(tag,'x')),number(attribute(tag,'y')),number(attribute(tag,'z')));
  else if(path==='model/resources/object/mesh/triangles/triangle')indices!.push(integer(attribute(tag,'v1'),'顶点索引'),integer(attribute(tag,'v2'),'顶点索引'),integer(attribute(tag,'v3'),'顶点索引'));
  else if(path==='model/resources/object/components/component'){
   if(!current||meshes||current.components.length>=64)throw Error('3MF 组件结构不受支持。');current.components.push(reference(tag));
  }else if(path==='model/build/item'){
   if(attribute(tag,'printable')==='0'||(attribute(tag,'printable')!==undefined&&attribute(tag,'printable')!=='1'))throw Error('3MF 含非打印对象。');build.push(reference(tag));if(build.length>1)throw Error('当前参考结果仅支持一个打印实例。');
  }else if(!containers.has(path))throw Error('3MF 含未支持的几何结构：'+path);
 },tag=>{if(tag.local==='mesh'){if(!current||!vertices||!indices||!vertices.length||!indices.length)throw Error('3MF 网格为空。');current.vertices=vertices.finish() as Float64Array;current.indices=indices.finish() as Uint32Array;for(const i of current.indices)if(i>=current.vertices.length/3)throw Error('3MF 三角索引越界。');vertices=undefined;indices=undefined;}if(tag.local==='object'){if(!current?.vertices&&!current?.components.length)throw Error('3MF 对象没有几何。');current=undefined;}});
 return {objects,build};
}
function relations(text:string){const targets=new Set<string>();xmlEvents(text,(tag,parents)=>{if(tag.ns!==REL||tag.name!==tag.local||(!parents.length&&tag.local!=='Relationships')||(parents.length&&!(parents.length===1&&tag.local==='Relationship')))throw Error('3MF 关系文件结构无效。');if(tag.local==='Relationship'){if(attribute(tag,'TargetMode')==='External')throw Error('3MF 含外部关系。');if(attribute(tag,'Type')===MODEL_REL)targets.add(pathName(attribute(tag,'Target')??''));}});return targets;}
function metadataMap(tag:XmlTag,map:Map<string,string>){const key=attribute(tag,'key');if(key!==undefined){if(map.has(key))throw Error('3MF 配置元数据重复。');map.set(key,attribute(tag,'value')??'');}}
function plateBinding(text:string,buildId:number,meshIds:number[]){
 let plates=0,instances=0,objects=0,parts=0;const plate=new Map<string,string>(),instance=new Map<string,string>();let objectMetadata=new Map<string,string>(),partMetadata=new Map<string,string>();const partIds:number[]=[];
 xmlEvents(text,(tag,parents)=>{const path=[...parents.map(x=>x.local),tag.local].join('/');if(tag.ns||tag.name!==tag.local)throw Error('Bambu 配置命名空间不受支持。');
  if(!['config','config/object','config/object/metadata','config/object/part','config/object/part/metadata','config/object/part/mesh_stat','config/plate','config/plate/metadata','config/plate/model_instance','config/plate/model_instance/metadata','config/assemble'].includes(path))throw Error('固定参考配置含未支持的结构：'+path);
  if(path==='config/object'){objectMetadata=new Map();objects++;if(integer(attribute(tag,'id'),'配置对象编号',1)!==buildId)throw Error('3MF 配置对象与 build 不一致。');}
  if(path==='config/object/part'){partMetadata=new Map();parts++;if(attribute(tag,'subtype')!=='normal_part')throw Error('当前结果含修改器、负体积或非普通零件。');partIds.push(integer(attribute(tag,'id'),'配置零件编号',1));}
  if(path==='config/object/metadata'||path==='config/object/part/metadata'){
   const key=attribute(tag,'key');if(key!==undefined){const allowed=path==='config/object/metadata'?['name','extruder']:['name','matrix','source_file','source_object_id','source_volume_id','source_offset_x','source_offset_y','source_offset_z'];if(!allowed.includes(key))throw Error('当前固定参考配置不接受零件级打印或体积类型覆盖：'+key);metadataMap(tag,path==='config/object/metadata'?objectMetadata:partMetadata);if(key==='extruder'&&attribute(tag,'value')!=='1')throw Error('当前固定参考仅支持挤出机 1。');}
  }
  if(path==='config/plate')plates++;if(path==='config/plate/model_instance')instances++;
  if(path==='config/plate/metadata'){
   const key=attribute(tag,'key')??'',allowed=['plater_id','plater_name','locked','filament_map_mode','filament_maps','filament_volume_maps','gcode_file','thumbnail_file','thumbnail_no_light_file','top_file','pick_file'];
   if(!allowed.includes(key))throw Error('固定参考配置不接受打印盘覆盖：'+key);metadataMap(tag,plate);
   const fixed:Record<string,string>={locked:'false',filament_map_mode:'Auto For Flush',filament_maps:'1',filament_volume_maps:'0'};if(Object.hasOwn(fixed,key)&&attribute(tag,'value')!==fixed[key])throw Error('打印盘耗材映射或固定状态改变。');
  }
  if(path==='config/plate/model_instance/metadata'){if(!['object_id','instance_id','identify_id'].includes(attribute(tag,'key')??''))throw Error('打印实例包含未支持的配置。');metadataMap(tag,instance);}
 });
 if(plates!==1||instances!==1||objects!==1||parts!==meshIds.length||new Set(partIds).size!==parts||meshIds.some(id=>!partIds.includes(id))||plate.get('plater_id')!=='1'||plate.get('gcode_file')!=='Metadata/plate_1.gcode'||integer(instance.get('object_id'),'实例对象编号',1)!==buildId||instance.get('instance_id')!=='0')throw Error('3MF 打印盘、模型实例或零件集合无法与实际几何对应。');
 return {plate:1,buildObjectId:buildId,instanceId:0,identifyId:integer(instance.get('identify_id'),'切片实例标识',1),meshObjectIds:meshIds};
}
function sliceBinding(text:string,identifyId:number){let plates=0,objects=0,seen=false;const metadata=new Map<string,string>();xmlEvents(text,(tag,parents)=>{const path=[...parents.map(x=>x.local),tag.local].join('/');if(tag.ns||tag.name!==tag.local)throw Error('切片实例命名空间不受支持。');if(!['config','config/header','config/header/header_item','config/plate','config/plate/metadata','config/plate/object','config/plate/filament','config/plate/nozzle','config/plate/layer_filament_lists','config/plate/layer_filament_lists/layer_filament_list'].includes(path))throw Error('切片实例结构超出固定格式。');if(path==='config/plate')plates++;if(path==='config/plate/metadata')metadataMap(tag,metadata);if(path==='config/plate/object'){objects++;if(integer(attribute(tag,'identify_id'),'切片对象标识',1)!==identifyId||attribute(tag,'skipped')!=='false')throw Error('实际切片对象缺失、跳过或编号不一致。');seen=true;}});if(plates!==1||objects!==1||!seen||metadata.get('index')!=='1')throw Error('切片实例记录不完整。');}
/** Resolve actual build -> components -> mesh, and bind the printable instance to plate 1. */
export async function threeMfTriangles(zip:JSZip){
 const documents=new Map<string,Document>(),allowed=new Map<string,Set<string>>();
 const text=async(name:string)=>{const f=zip.file(name);if(!f)throw Error('3MF 缺少 '+name);return f.async('string');};
 const rootTargets=relations(await text('_rels/.rels'));if(rootTargets.size!==1||!rootTargets.has('3D/3dmodel.model'))throw Error('3MF 主模型关系不一致。');
 const modelNames=Object.keys(zip.files).filter(n=>n.endsWith('.model'));if(modelNames.length>32)throw Error('3MF 模型文件过多。');
 for(const name of modelNames){pathName(name);documents.set(name,readModel(await text(name)));const cut=name.lastIndexOf('/'),rel=name.slice(0,cut+1)+'_rels/'+name.slice(cut+1)+'.rels';allowed.set(name,zip.file(rel)?relations(await text(rel)):new Set());}
 const root=documents.get('3D/3dmodel.model');if(!root||root.build.length!==1)throw Error('3MF 没有唯一打印实例。');for(const [name,doc]of documents)if(name!=='3D/3dmodel.model'&&doc.build.length)throw Error('子模型不能另含打印实例。');
 const output=new Numbers(MESH_IDENTITY_MAX_FACES*9),used=new Set<string>(),stack=new Set<string>(),meshIds:number[]=[];
 function walk(name:string,ref:Ref,parentTranslation:number[],depth:number){
  if(depth>16)throw Error('3MF 组件层级过深。');const target=ref.path??name;if(ref.path&&target!==name&&!allowed.get(name)?.has(target))throw Error('3MF 组件引用未出现在包关系中。');
  const key=target+'#'+ref.id,obj=documents.get(target)?.objects.get(ref.id);if(!obj||stack.has(key))throw Error('3MF 对象引用缺失或循环。');stack.add(key);used.add(key);
  const translation=parentTranslation.map((v,k)=>v+ref.transform[9+k]);
  if(obj.vertices&&obj.indices){meshIds.push(obj.id);for(const i of obj.indices)output.push(obj.vertices[i*3]+translation[0],obj.vertices[i*3+1]+translation[1],obj.vertices[i*3+2]+translation[2]);}
  for(const child of obj.components)walk(target,child,translation,depth+1);stack.delete(key);
 }
 const build=root.build[0];if(build.path)throw Error('当前固定格式的 build 必须引用主文件对象。');walk('3D/3dmodel.model',build,[0,0,0],0);
 for(const [name,doc]of documents)for(const id of doc.objects.keys())if(!used.has(name+'#'+id))throw Error('3MF 存在未纳入唯一打印实例的额外对象。');
 if(!meshIds.length||new Set(meshIds).size!==meshIds.length)throw Error('当前参考结果不支持重复网格实例或跨文件同号网格。');
 const binding=plateBinding(await text('Metadata/model_settings.config'),build.id,meshIds);sliceBinding(await text('Metadata/slice_info.config'),binding.identifyId);
 return {coordinates:output.finish() as Float64Array,binding,scope:'fixed_bambu_single_plate_translation_only' as const};
}
