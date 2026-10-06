import {Mesh,Vector3,type Object3D} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {partUnitScale,type Part} from './engineering';
import {parametric} from './parametric-geometry';
import {inspectGlb} from './glb-inspect';
import {binaryStlTriangles,compareMeshes,MESH_IDENTITY_MAX_FACES} from './mesh-identity';
import {sha256} from './slice-contract';
export type PartAsset={bytes:ArrayBuffer;filename:string};
export type SavedPartBinding={status:'saved_part_recomputed';encoding:'saved_world_geometry_rounded_to_stl_float32';sourceAssetId:string|null;sourceAssetSha256:string|null;comparison:Awaited<ReturnType<typeof compareMeshes>>};
function objectTriangles(object:Object3D){
 let faces=0;object.updateMatrixWorld(true);object.traverse(node=>{if(node instanceof Mesh)faces+=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;});
 if(!Number.isInteger(faces)||faces<1||faces>MESH_IDENTITY_MAX_FACES)throw Error('保存的零件超过当前 10 万面在线几何关联预算。');
 const data=new Float64Array(faces*9);let cursor=0;const point=new Vector3();
 object.traverse(node=>{if(node instanceof Mesh){const p=node.geometry.attributes.position,index=node.geometry.index,count=index?.count??p.count;for(let i=0;i<count;i++){point.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(node.matrixWorld);data[cursor++]=Math.fround(point.x);data[cursor++]=Math.fround(point.y);data[cursor++]=Math.fround(point.z);}}});return data;
}
/** Rebuild geometry from stored parameters or the stored immutable asset, without browser claims. */
export function savedPartTriangles(part:Part,asset?:PartAsset){
 if(part.kind!=='asset'){const object=parametric(part);object.position.set(...part.position);try{return objectTriangles(object);}finally{object.traverse(n=>{if(n instanceof Mesh)n.geometry.dispose();});}}
 if(!asset||!part.assetId)throw Error('保存的零件缺少原始资产。');
 const scale=partUnitScale(part);if(scale>1e6)throw Error('保存的单位换算无效。');
 const ext=asset.filename.split('.').pop()?.toLowerCase();
 if(ext==='glb'){
  // Geometry-only decoding uses the same static GLB parser as import; no image/network/DOM work.
  const buffer=new Float64Array(MESH_IDENTITY_MAX_FACES*9);let cursor=0;
  inspectGlb(asset.bytes,triangle=>{if(cursor+9>buffer.length)throw Error('原始 GLB 超过当前 10 万面在线关联预算。');for(let k=0;k<9;k++)buffer[cursor++]=Math.fround(triangle[k]*scale/1000+part.position[k%3]);});
  return buffer.slice(0,cursor);
 }
 // Text loaders allocate intermediate arrays; constrain them before loading on the web service.
 let object:Object3D;
 if(ext==='stl'){
  const view=new DataView(asset.bytes);const binary=asset.bytes.byteLength>=84&&84+50*view.getUint32(80,true)===asset.bytes.byteLength;
  if(binary){const result=binaryStlTriangles(asset.bytes);for(let i=0;i<result.length;i++)result[i]=Math.fround(result[i]*scale+part.position[i%3]);return result;}
  if(asset.bytes.byteLength>8*1024*1024)throw Error('大型 ASCII STL 需先转换为二进制 STL 后关联。');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(asset.bytes);if((text.match(/\bfacet\s+normal\b/g)??[]).length>MESH_IDENTITY_MAX_FACES)throw Error('ASCII STL 超过在线面数预算。');
  object=new Mesh(new STLLoader().parse(asset.bytes));
 }else if(ext==='obj'){
  if(asset.bytes.byteLength>4*1024*1024)throw Error('大型 OBJ 需在工程执行器中转换为二进制 STL 或 GLB。');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(asset.bytes);let faces=0,vertices=0;for(const line of text.split(/\r?\n/)){if(/^v\s/.test(line))vertices++;if(/^f\s/.test(line))faces+=Math.max(0,line.trim().split(/\s+/).length-3);}
  if(faces>MESH_IDENTITY_MAX_FACES||vertices>300000)throw Error('OBJ 超过在线几何关联预算。');object=new OBJLoader().parse(text);
 }else throw Error('原始资产格式无法用于当前几何关联。');
 object.scale.setScalar(scale);object.position.set(...part.position);try{return objectTriangles(object);}finally{object.traverse(n=>{if(n instanceof Mesh)n.geometry.dispose();});}
}
export async function bindSavedPart(part:Part,input:ArrayBuffer,asset?:PartAsset):Promise<SavedPartBinding>{
 const comparison=await compareMeshes(savedPartTriangles(part,asset),binaryStlTriangles(input),false);
 return {status:'saved_part_recomputed',encoding:'saved_world_geometry_rounded_to_stl_float32',sourceAssetId:part.assetId??null,sourceAssetSha256:asset?await sha256(asset.bytes):null,comparison};
}
