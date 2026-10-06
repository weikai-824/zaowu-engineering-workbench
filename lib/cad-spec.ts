import {z} from 'zod';
import {sha256} from './slice-contract';
import {randomUuid} from './crypto-portable';
const id=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/);
const scalar=z.union([z.number().finite().min(-10000).max(10000),z.object({param:id,scale:z.number().finite().min(-100).max(100).optional(),offset:z.number().finite().min(-10000).max(10000).optional()}).strict()]);
const vec=z.tuple([scalar,scalar,scalar]);
const point2=z.tuple([scalar,scalar]);
const feature=z.discriminatedUnion('op',[
 z.object({id,op:z.literal('box'),size:vec,origin:vec}).strict(),
 z.object({id,op:z.literal('cylinder'),radius:scalar,height:scalar,origin:vec,axis:z.enum(['X','Y','Z'])}).strict(),
 z.object({id,op:z.literal('sphere'),radius:scalar,origin:vec}).strict(),
 z.object({id,op:z.literal('profile_extrude'),plane:z.enum(['XY','XZ','YZ']),points:z.array(point2).min(3).max(24),depth:scalar,origin:vec}).strict(),
 z.object({id,op:z.enum(['union','subtract','intersect']),left:id,right:id}).strict(),
 z.object({id,op:z.literal('fillet_all'),input:id,radius:scalar}).strict(),
 z.object({id,op:z.literal('fillet_edges'),input:id,radius:scalar,axis:z.enum(['X','Y','Z'])}).strict()
]);
export const cadSchema=z.object({schema:z.literal('cad-plan-v1'),id:z.string().uuid(),name:z.string().min(1).max(120),units:z.literal('mm'),visualReference:z.object({partId:z.string().uuid(),assetId:z.string().uuid(),assetSha256:z.string().regex(/^[0-9a-f]{64}$/),role:z.literal('visual_reference')}).strict().optional(),parameters:z.record(id,z.object({label:z.string().max(80),value:z.number().finite().min(-10000).max(10000),min:z.number().finite().min(-10000).max(10000),max:z.number().finite().min(-10000).max(10000),locked:z.boolean()}).strict()),parts:z.array(z.object({id:z.string().uuid(),name:z.string().min(1).max(120),color:z.string().regex(/^#[0-9a-f]{6}$/i),placement:vec,features:z.array(feature).min(1).max(32),result:id}).strict()).min(1).max(12),interfaces:z.array(z.object({id,partId:z.string().uuid(),featureId:id,kind:z.literal('straight_bore_z'),center:z.tuple([scalar,scalar]),zStart:scalar,length:scalar,radius:scalar,locked:z.boolean()}).strict()).max(24)}).strict();
export type CadDesign=z.infer<typeof cadSchema>;
export type CadScalar=z.infer<typeof scalar>;
export function scalarValue(s:CadScalar,d:CadDesign):number{const v=typeof s==='number'?s:(d.parameters[s.param]?.value??NaN)*(s.scale??1)+(s.offset??0);if(!Number.isFinite(v)||Math.abs(v)>10000)throw Error('CAD 表达式引用不存在的参数或数值超限。');return Object.is(v,-0)?0:v;}
export const cadCanonical=(v:unknown):string=>JSON.stringify(sort(v));
function sort(v:unknown):unknown{return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sort(x)])):v;}
export const cadHash=(d:CadDesign)=>sha256(cadCanonical(d));
export function parseCad(value:unknown):CadDesign{
 const d=cadSchema.parse(value);if(Object.keys(d.parameters).length>64)throw Error('CAD 参数最多 64 个。');
 for(const p of Object.values(d.parameters))if(p.min>p.max||p.value<p.min||p.value>p.max)throw Error('CAD 参数超出允许范围。');
 if(new Set(d.parts.map(p=>p.id)).size!==d.parts.length||new Set(d.interfaces.map(i=>i.id)).size!==d.interfaces.length)throw Error('CAD 零件和接口编号必须唯一。');
 const positive=(s:CadScalar)=>{const v=scalarValue(s,d);if(v<.05)throw Error('CAD 正尺寸必须至少为 0.05 mm。');};
 for(const p of d.parts){p.placement.forEach(v=>scalarValue(v,d));const seen=new Set<string>();for(const f of p.features){if(seen.has(f.id))throw Error('CAD 特征编号重复。');if('origin'in f)f.origin.forEach(v=>scalarValue(v,d));if(f.op==='box')f.size.forEach(positive);if(f.op==='profile_extrude'){positive(f.depth);const points=f.points.map(([a,b])=>[scalarValue(a,d),scalarValue(b,d)]);let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(a[0]===b[0]&&a[1]===b[1])throw Error('轮廓不能包含相邻重复点。');area+=a[0]*b[1]-b[0]*a[1];}if(Math.abs(area)<.01)throw Error('轮廓面积过小或退化。');}if('radius'in f)positive(f.radius);if('height'in f)positive(f.height);if('left'in f&&(!seen.has(f.left)||!seen.has(f.right)||f.left===f.right))throw Error('布尔运算必须引用之前的两个不同特征。');if('input'in f&&!seen.has(f.input))throw Error('圆角必须引用之前的特征。');seen.add(f.id);}if(!seen.has(p.result))throw Error('CAD 最终实体不存在。');}
 for(const i of d.interfaces){const p=d.parts.find(p=>p.id===i.partId),f=p?.features.find(f=>f.id===i.featureId);if(!p||!f||f.op!=='cylinder'||f.axis!=='Z')throw Error('直孔接口必须关联同一零件的 Z 向圆柱工具。');i.center.forEach(s=>scalarValue(s,d));scalarValue(i.zStart,d);positive(i.length);positive(i.radius);if(scalarValue(i.radius,d)<=.1)throw Error('当前直孔量规半径须大于 0.1 mm。');}
 return d;
}
export function assertCadTransition(old:CadDesign,next:CadDesign){
 if(old.id!==next.id)throw Error('CAD 设计编号不能改写。');
 const unlocks=Object.entries(old.parameters).some(([k,p])=>p.locked&&!next.parameters[k]?.locked)||old.interfaces.some(i=>i.locked&&!next.interfaces.find(n=>n.id===i.id)?.locked);
 const withoutFlags=(d:CadDesign)=>({...d,parameters:Object.fromEntries(Object.entries(d.parameters).map(([k,p])=>[k,{...p,locked:false}])),interfaces:d.interfaces.map(i=>({...i,locked:false}))});
 if(unlocks&&cadCanonical(withoutFlags(old))!==cadCanonical(withoutFlags(next)))throw Error('请先单独解锁并保存一个版本，再改动 CAD 设计。');
 for(const [k,p]of Object.entries(old.parameters))if(p.locked&&(!next.parameters[k]||next.parameters[k].value!==p.value))throw Error('CAD 参数已锁定：'+p.label);
 for(const i of old.interfaces.filter(i=>i.locked)){const n=next.interfaces.find(n=>n.id===i.id);if(!n||cadCanonical({...i,locked:false})!==cadCanonical({...n,locked:false}))throw Error('CAD 接口定义已锁定：'+i.id);const a=old.parts.find(p=>p.id===i.partId)!,b=next.parts.find(p=>p.id===i.partId);if(!b||cadCanonical(a.features.find(f=>f.id===i.featureId))!==cadCanonical(b.features.find(f=>f.id===i.featureId)))throw Error('CAD 接口特征已锁定。');const resolved=(d:CadDesign)=>[...i.center,i.zStart,i.length,i.radius,...d.parts.find(p=>p.id===i.partId)!.placement].map(s=>scalarValue(s,d));if(cadCanonical(resolved(old))!==cadCanonical(resolved(next)))throw Error('CAD 接口尺寸或装配位置已锁定。');}
}
export function changeCadParameters(d:CadDesign,values:Record<string,unknown>){const next=structuredClone(d);for(const[k,v]of Object.entries(values)){if(!next.parameters[k]||typeof v!=='number'||!Number.isFinite(v))throw Error('CAD 参数名称或值无效。');next.parameters[k].value=v;}parseCad(next);assertCadTransition(d,next);return next;}
export function sampleCad():CadDesign{const partId=randomUuid();return parseCad({schema:'cad-plan-v1',id:randomUuid(),name:'带锁定安装孔的 L 支架',units:'mm',parameters:{width:{label:'支架宽度',value:40,min:20,max:120,locked:false},depth:{label:'底板深度',value:30,min:20,max:120,locked:false},height:{label:'立板高度',value:30,min:10,max:120,locked:false},thickness:{label:'板厚',value:4,min:2,max:8,locked:true},hole_radius:{label:'安装孔半径',value:2.5,min:1,max:5,locked:true}},parts:[{id:partId,name:'L 支架',color:'#43b8a6',placement:[0,0,0],features:[{id:'foot',op:'box',origin:[0,0,0],size:[{param:'width'},{param:'depth'},{param:'thickness'}]},{id:'upright',op:'box',origin:[0,0,0],size:[{param:'width'},{param:'thickness'},{param:'height'}]},{id:'joined',op:'union',left:'foot',right:'upright'},{id:'mount_tool',op:'cylinder',origin:[10,15,-1],axis:'Z',radius:{param:'hole_radius'},height:10},{id:'finished',op:'subtract',left:'joined',right:'mount_tool'}],result:'finished'}],interfaces:[{id:'mount_hole',partId,featureId:'mount_tool',kind:'straight_bore_z',center:[10,15],zStart:0,length:{param:'thickness'},radius:{param:'hole_radius'},locked:true}]});}
