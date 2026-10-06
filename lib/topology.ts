import {sha256Hex} from './crypto-portable';
export const TOPOLOGY_VERSION='triangle-topology-v1' as const;
export const TOPOLOGY_LIMIT=300_000;
export const TOPOLOGY_VERTEX_LIMIT=300_000;
export const TOPOLOGY_EDGE_LIMIT=600_000;
export const TOPOLOGY_TOLERANCE_MM=0.00001;
export const TOPOLOGY_AREA_MM2=1e-12;
export type Point3=[number,number,number];
export type TopologyStats={vertices:number;validTriangles:number;boundaryEdges:number;nonManifoldEdges:number;windingConflictEdges:number;duplicateFaces:number;degenerateFaces:number;nonManifoldVertices:number;edgeConnectedComponents:number};
export type EdgeExample={kind:'boundary'|'non_manifold'|'winding';a:Point3;b:Point3};
export type TopologyReport={
 algorithm:typeof TOPOLOGY_VERSION;producer:'browser_mesh_analysis';verification:'client_report_unverified';geometryHash:string;measuredAt:string;
 input:{triangles:number;sourceMeshes:number;sourceVertexRecords:number;coordinateSystem:'mm_z_up_world';hashEncoding:'ordered_triangles_float64_le'};
 options:{weldToleranceMm:typeof TOPOLOGY_TOLERANCE_MM;minimumAreaMm2:typeof TOPOLOGY_AREA_MM2};
 exact:TopologyStats;tolerant:TopologyStats;mergedDistinctVertices:number;
 verdict:'no_topology_issue_detected'|'tolerance_sensitive'|'topology_issues';
 components:{triangles:number;minMm:Point3;maxMm:Point3}[];componentListTruncated:boolean;
 examples:EdgeExample[];exampleView:'exact'|'tolerant';duplicateFaceExamples:number[];degenerateFaceExamples:number[];
 notChecked:('self_intersection'|'wall_thickness'|'outward_orientation'|'shell_containment'|'assembly_fit'|'physical_manufacturing')[];
};
export type TriangleInput={coordinates:Float64Array;sourceMeshes:number;sourceVertexRecords:number};
const emptyStats=():TopologyStats=>({vertices:0,validTriangles:0,boundaryEdges:0,nonManifoldEdges:0,windingConflictEdges:0,duplicateFaces:0,degenerateFaces:0,nonManifoldVertices:0,edgeConnectedComponents:0});
export function cleanTopology(s:TopologyStats){return s.validTriangles>0&&s.boundaryEdges===0&&s.nonManifoldEdges===0&&s.windingConflictEdges===0&&s.duplicateFaces===0&&s.degenerateFaces===0&&s.nonManifoldVertices===0;}
export function topologyVerdict(exact:TopologyStats,tolerant:TopologyStats,merged:number):TopologyReport['verdict']{
 if(cleanTopology(exact)&&cleanTopology(tolerant)&&merged===0)return 'no_topology_issue_detected';
 if(merged>0&&(cleanTopology(exact)||cleanTopology(tolerant)))return 'tolerance_sensitive';
 return 'topology_issues';
}
class DisjointSet{
 parent:Int32Array;rank:Uint8Array;
 constructor(size:number){this.parent=Int32Array.from({length:size},(_,i)=>i);this.rank=new Uint8Array(size);}
 find(i:number){while(this.parent[i]!==i){this.parent[i]=this.parent[this.parent[i]];i=this.parent[i];}return i;}
 union(a:number,b:number){a=this.find(a);b=this.find(b);if(a===b)return;if(this.rank[a]<this.rank[b])[a,b]=[b,a];this.parent[b]=a;if(this.rank[a]===this.rank[b])this.rank[a]++;}
}
type Prepared={points:Point3[];ids:Uint32Array};
function exactPositions(coordinates:Float64Array):Prepared{
 const points:Point3[]=[],map=new Map<string,number>(),ids=new Uint32Array(coordinates.length/3);
 for(let i=0;i<ids.length;i++){const p:Point3=[coordinates[i*3],coordinates[i*3+1],coordinates[i*3+2]];const key=p.join(',');let id=map.get(key);if(id===undefined){id=points.length;if(id>=TOPOLOGY_VERTEX_LIMIT)throw Error('网格超过浏览器检查的 30 万个不同坐标顶点预算，未作抽样判定。请交由工程执行器完整检查。');points.push(p);map.set(key,id);}ids[i]=id;}
 return{points,ids};
}
function tolerantPositions(exact:Prepared):Prepared{
 const t=TOPOLOGY_TOLERANCE_MM,points:Point3[]=[],buckets=new Map<string,number[]>(),mapping=new Uint32Array(exact.points.length);
 // Each original point must be within the stated radius of a fixed representative.
 // No transitive chain welding, mutation of source vertices, or rounded-grid equality.
 for(let i=0;i<exact.points.length;i++){
  const p=exact.points[i],cell=p.map(x=>Math.floor(x/t));let chosen=-1,best=t*t;
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const id of buckets.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))??[]){const q=points[id],d=(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2;if(d<=best&&(d<best||chosen<0||id<chosen)){chosen=id;best=d;}}
  if(chosen<0){chosen=points.length;points.push(p);const key=cell.join(','),bucket=buckets.get(key);if(bucket)bucket.push(chosen);else buckets.set(key,[chosen]);}mapping[i]=chosen;
 }
 return{points,ids:Uint32Array.from(exact.ids,id=>mapping[id])};
}
type Edge={a:number;b:number;count:number;direction:number;firstFace:number;secondFace:number;firstA:number;firstB:number;secondA:number;secondB:number};
function inspectTopology({points,ids}:Prepared,triangleCount:number){
 const stats=emptyStats();stats.vertices=points.length;
 const faces=new DisjointSet(triangleCount),corners=new DisjointSet(ids.length),valid=new Uint8Array(triangleCount),vertexBad=new Uint8Array(points.length),faceKeys=new Set<string>(),edges=new Map<number,Edge>();
 const duplicateFaceExamples:number[]=[],degenerateFaceExamples:number[]=[];
 for(let f=0;f<triangleCount;f++){
  const offset=f*3,a=ids[offset],b=ids[offset+1],c=ids[offset+2],p=points[a],q=points[b],r=points[c];
  const ux=q[0]-p[0],uy=q[1]-p[1],uz=q[2]-p[2],vx=r[0]-p[0],vy=r[1]-p[1],vz=r[2]-p[2];
  const area=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;
  if(a===b||b===c||a===c||area<=TOPOLOGY_AREA_MM2){stats.degenerateFaces++;if(degenerateFaceExamples.length<8)degenerateFaceExamples.push(f);continue;}
  valid[f]=1;stats.validTriangles++;const key=[a,b,c].sort((x,y)=>x-y).join(',');if(faceKeys.has(key)){stats.duplicateFaces++;vertexBad[a]=vertexBad[b]=vertexBad[c]=1;if(duplicateFaceExamples.length<8)duplicateFaceExamples.push(f);}else faceKeys.add(key);
  for(let j=0;j<3;j++){
   const u=ids[offset+j],v=ids[offset+(j+1)%3],lo=Math.min(u,v),hi=Math.max(u,v),edgeKey=lo*points.length+hi;
   const loCorner=u===lo?offset+j:offset+(j+1)%3,hiCorner=u===hi?offset+j:offset+(j+1)%3;
   const edge=edges.get(edgeKey);
   if(!edge){if(edges.size>=TOPOLOGY_EDGE_LIMIT)throw Error('网格超过浏览器检查的 60 万条不同边预算，未作抽样判定。请交由工程执行器完整检查。');edges.set(edgeKey,{a:lo,b:hi,count:1,direction:u===lo?1:-1,firstFace:f,secondFace:-1,firstA:loCorner,firstB:hiCorner,secondA:-1,secondB:-1});}
   else{edge.count++;edge.direction+=u===lo?1:-1;faces.union(edge.firstFace,f);if(edge.count===2){edge.secondFace=f;edge.secondA=loCorner;edge.secondB=hiCorner;}}
  }
 }
 const examples:EdgeExample[]=[];
 for(const edge of edges.values()){
  let kind:EdgeExample['kind']|undefined;
  if(edge.count===1){stats.boundaryEdges++;kind='boundary';}
  else if(edge.count>2){stats.nonManifoldEdges++;vertexBad[edge.a]=vertexBad[edge.b]=1;kind='non_manifold';}
  else{corners.union(edge.firstA,edge.secondA);corners.union(edge.firstB,edge.secondB);if(edge.direction!==0){stats.windingConflictEdges++;kind='winding';}}
  if(kind&&examples.length<24)examples.push({kind,a:points[edge.a],b:points[edge.b]});
 }
 const firstFan=new Int32Array(points.length).fill(-1);
 // Edge incidence alone misses two closed shells touching at one vertex.
 // Connected corner fans around each vertex detect that non-manifold link.
 for(let i=0;i<ids.length;i++)if(valid[Math.floor(i/3)]){const vertex=ids[i],fan=corners.find(i);if(firstFan[vertex]===-1)firstFan[vertex]=fan;else if(firstFan[vertex]!==fan)vertexBad[vertex]=1;}
 stats.nonManifoldVertices=vertexBad.reduce((sum,v)=>sum+v,0);
 const groups=new Map<number,{triangles:number;minMm:Point3;maxMm:Point3}>();
 for(let f=0;f<triangleCount;f++)if(valid[f]){const root=faces.find(f);let group=groups.get(root);if(!group){group={triangles:0,minMm:[Infinity,Infinity,Infinity],maxMm:[-Infinity,-Infinity,-Infinity]};groups.set(root,group);}group.triangles++;for(let j=0;j<3;j++){const p=points[ids[f*3+j]];for(let k=0;k<3;k++){group.minMm[k]=Math.min(group.minMm[k],p[k]);group.maxMm[k]=Math.max(group.maxMm[k],p[k]);}}}
 stats.edgeConnectedComponents=groups.size;
 return{stats,examples,duplicateFaceExamples,degenerateFaceExamples,components:[...groups.values()].sort((a,b)=>b.triangles-a.triangles).slice(0,8),componentListTruncated:groups.size>8};
}
export async function analyzeTriangles(input:TriangleInput):Promise<TopologyReport>{
 const original=input.coordinates;
 if(!(original instanceof Float64Array)||!(original.buffer instanceof ArrayBuffer)||!original.length||original.length%9)throw Error('检查输入不是独立缓冲区中的完整三角网格。');
 const triangles=original.length/9;if(triangles>TOPOLOGY_LIMIT)throw Error('当前浏览器检查上限为 30 万三角面，请交由工程执行器检查完整模型。');
 const sourceMeshes=input.sourceMeshes,sourceVertexRecords=input.sourceVertexRecords;
 if(!Number.isInteger(sourceMeshes)||sourceMeshes<1||sourceMeshes>4000||!Number.isInteger(sourceVertexRecords)||sourceVertexRecords<3||sourceVertexRecords>4_000_000)throw Error('检查输入来源信息无效。');
 // Capture one private snapshot before hashing yields. Both the digest and statistics
 // must describe the same geometry even if a caller later edits its own buffer.
 const coordinates=original.slice();
 for(const value of coordinates)if(!Number.isFinite(value)||Math.abs(value)>1e9)throw Error('模型包含无效坐标。');
 const bytes=new ArrayBuffer(coordinates.byteLength),view=new DataView(bytes);for(let i=0;i<coordinates.length;i++)view.setFloat64(i*8,coordinates[i]===0?0:coordinates[i],true);
 const geometryHash=await sha256Hex(bytes);
 const exact=exactPositions(coordinates),exactResult=inspectTopology(exact,triangles),tolerant=tolerantPositions(exact),tolerantResult=inspectTopology(tolerant,triangles),merged=exact.points.length-tolerant.points.length;
 const exampleView=cleanTopology(exactResult.stats)&&!cleanTopology(tolerantResult.stats)?'tolerant':'exact',sample=exampleView==='exact'?exactResult:tolerantResult;
 return{algorithm:TOPOLOGY_VERSION,producer:'browser_mesh_analysis',verification:'client_report_unverified',geometryHash,measuredAt:new Date().toISOString(),input:{triangles,sourceMeshes,sourceVertexRecords,coordinateSystem:'mm_z_up_world',hashEncoding:'ordered_triangles_float64_le'},options:{weldToleranceMm:TOPOLOGY_TOLERANCE_MM,minimumAreaMm2:TOPOLOGY_AREA_MM2},exact:exactResult.stats,tolerant:tolerantResult.stats,mergedDistinctVertices:merged,verdict:topologyVerdict(exactResult.stats,tolerantResult.stats,merged),components:exactResult.components,componentListTruncated:exactResult.componentListTruncated,examples:sample.examples,exampleView,duplicateFaceExamples:sample.duplicateFaceExamples,degenerateFaceExamples:sample.degenerateFaceExamples,notChecked:['self_intersection','wall_thickness','outward_orientation','shell_containment','assembly_fit','physical_manufacturing']};
}
