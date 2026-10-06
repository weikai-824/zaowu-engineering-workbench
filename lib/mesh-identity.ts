/** Full triangle correspondence within a stated numeric tolerance; not a solid validator. */
import {sha256Hex} from './crypto-portable';
export const MESH_IDENTITY_VERSION='oriented-triangle-correspondence-v1';
export const MESH_IDENTITY_TOLERANCE_MM=0.00001;
export const MESH_IDENTITY_MAX_FACES=100000;
export type MeshSignature={encoding:'ordered-float64le-mm-v1';triangles:number;sha256:string;originMm:number[];dimensionsMm:number[]};
function snapshot(input:Float64Array){
 const n=input.length/9;if(!Number.isInteger(n)||n<1||n>MESH_IDENTITY_MAX_FACES)throw Error('当前线上几何关联支持最多 10 万三角面；更大零件需由工程执行器处理，不能降级为尺寸核对。');
 if(typeof SharedArrayBuffer!=='undefined'&&input.buffer instanceof SharedArrayBuffer)throw Error('几何关联不接受共享内存。');
 const data=input.slice(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<data.length;i++){const x=data[i],k=i%3;if(!Number.isFinite(x)||Math.abs(x)>100000)throw Error('几何关联坐标无效。');min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x);}
 const size=max.map((x,k)=>x-min[k]);if(size.some(x=>x>241))throw Error('几何关联超出当前单零件尺寸预算。');return {data,min,size,n};
}
async function signature(s:ReturnType<typeof snapshot>):Promise<MeshSignature>{
 const bytes=new ArrayBuffer(s.data.byteLength),v=new DataView(bytes);for(let i=0;i<s.data.length;i++)v.setFloat64(i*8,s.data[i]===0?0:s.data[i],true);
 const sha256=await sha256Hex(bytes);
 return {encoding:'ordered-float64le-mm-v1',triangles:s.n,sha256,originMm:s.min,dimensionsMm:s.size};
}
export async function meshSignature(input:Float64Array){return signature(snapshot(input));}
export async function compareMeshes(expected:Float64Array,actual:Float64Array,allowTranslation:boolean){
 // Capture both buffers and metadata before the first await.
 const a=snapshot(expected),b=snapshot(actual),epsilon=MESH_IDENTITY_TOLERANCE_MM;
 if(a.n!==b.n)throw Error('完整几何的三角面数不同。');
 const translation=b.min.map((v,k)=>v-a.min[k]);if(!allowTranslation&&translation.some(v=>Math.abs(v)>epsilon))throw Error('切片输入位置与保存的零件不一致。');
 const originB=allowTranslation?b.min:a.min;
 // Hash original ordered coordinates. The numeric bijection below, not equal hashes,
 // handles exporters that reorder faces or round their decimal representation.
 const sourceSignature=await signature(a),targetSignature=await signature(b);
 for(let i=0;i<a.data.length;i++){a.data[i]-=a.min[i%3];b.data[i]-=originB[i%3];}
 const cells=new Map<string,number[]>(),cellSize=epsilon*2;
 const cell=(x:number)=>Math.floor(x/cellSize),key=(x:number,y:number,z:number)=>x+','+y+','+z;
 const rejectSmall=(data:Float64Array,offset:number)=>{for(let j=0;j<3;j++){const u=offset+j*3,v=offset+((j+1)%3)*3;if(Math.max(Math.abs(data[u]-data[v]),Math.abs(data[u+1]-data[v+1]),Math.abs(data[u+2]-data[v+2]))<=2*epsilon)throw Error('三角顶点间距接近关联容差，无法可靠确认绕向；需工程复核。');}};
 for(let f=0;f<b.n;f++){rejectSmall(b.data,f*9);for(let c=0;c<3;c++){const offset=f*9+c*3,k=key(cell(b.data[offset]),cell(b.data[offset+1]),cell(b.data[offset+2])),list=cells.get(k);if(list){if(list.length>=2048)throw Error('几何对应点过于密集，需由工程执行器核对。');list.push(f*3+c);}else cells.set(k,[f*3+c]);}}
 const used=new Uint8Array(b.n);let comparisons=0,maxError=0;
 for(let f=0;f<a.n;f++){
  const offset=f*9;rejectSmall(a.data,offset);const x=cell(a.data[offset]),y=cell(a.data[offset+1]),z=cell(a.data[offset+2]);let found=false,local=0;
  search:for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(const candidate of cells.get(key(x+dx,y+dy,z+dz))??[]){
   const face=Math.floor(candidate/3),first=candidate%3;if(used[face])continue;if(++local>4096||++comparisons>Math.max(20000,a.n*100))throw Error('完整几何对应检查超过计算预算，未降级放行。');
   let error=0;for(let k=0;k<9;k++)error=Math.max(error,Math.abs(a.data[offset+k]-b.data[face*9+(k+first*3)%9]));
   if(error<=epsilon){used[face]=1;maxError=Math.max(maxError,error);found=true;break search;}
  }
  if(!found)throw Error('完整三角几何不一致或在容差内无法完成逐面对配：请核对孔洞、内部结构、绕向和切片修补。');
 }
 return {algorithm:MESH_IDENTITY_VERSION,toleranceMm:epsilon,comparison:'complete_oriented_triangle_bijection' as const,triangles:a.n,matchedTriangles:a.n,maxCoordinateErrorMm:maxError,translationMm:translation,translationAllowed:allowTranslation,sourceSignature,targetSignature};
}
export function binaryStlTriangles(data:ArrayBuffer){
 if(data.byteLength<134)throw Error('二进制 STL 不完整。');const v=new DataView(data),n=v.getUint32(80,true);
 if(n<1||n>MESH_IDENTITY_MAX_FACES||84+50*n!==data.byteLength)throw Error('STL 面数、文件长度无效或超过 10 万面在线关联预算。');
 const result=new Float64Array(n*9);for(let f=0;f<n;f++)for(let k=0;k<9;k++)result[f*9+k]=v.getFloat32(84+f*50+12+k*4,true);return result;
}
