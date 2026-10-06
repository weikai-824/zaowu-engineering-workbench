import * as THREE from 'three';
import {analyzeTriangles,TOPOLOGY_LIMIT,type TriangleInput,type TopologyReport} from './topology';
import {sha256Hex} from './crypto-portable';

export function triangleInput(object:THREE.Object3D):TriangleInput{
 object.updateMatrixWorld(true);let triangles=0,sourceMeshes=0,sourceVertexRecords=0;
 const meshes:THREE.Mesh[]=[];
 object.traverse(node=>{
  if(!(node instanceof THREE.Mesh))return;
  if(node instanceof THREE.SkinnedMesh||node instanceof THREE.InstancedMesh||Object.keys(node.geometry.morphAttributes).length)throw Error('请先将蒙皮、实例或形变转换为确认姿态的静态网格。');
  const position=node.geometry.getAttribute('position'),count=node.geometry.index?.count??position?.count??0;
  if(!position||position.itemSize!==3||count%3)throw Error('模型位置属性或三角形数量无效。');
  triangles+=count/3;sourceVertexRecords+=position.count;sourceMeshes++;meshes.push(node);
 });
 if(!triangles||triangles>TOPOLOGY_LIMIT)throw Error(triangles?'当前浏览器检查上限为 30 万三角面；未抽样判定，请交由工程执行器检查完整模型。':'模型不包含三角形。');
 const coordinates=new Float64Array(triangles*9),point=new THREE.Vector3();let offset=0;
 for(const mesh of meshes){const position=mesh.geometry.getAttribute('position'),indices=mesh.geometry.index,count=indices?.count??position.count;
  for(let i=0;i<count;i++){const index=indices?indices.getX(i):i;if(!Number.isInteger(index)||index<0||index>=position.count)throw Error('模型包含越界索引。');point.fromBufferAttribute(position,index).applyMatrix4(mesh.matrixWorld);coordinates[offset++]=point.x;coordinates[offset++]=point.y;coordinates[offset++]=point.z;}
 }
 return{coordinates,sourceMeshes,sourceVertexRecords};
}

export async function analyzeInWorker(input:TriangleInput):Promise<TopologyReport>{
 if(typeof window==='undefined')return analyzeTriangles(input);
 if(typeof Worker==='undefined')throw Error('当前浏览器不支持独立检查任务，请使用支持 Web Worker 的浏览器。');
 return new Promise((resolve,reject)=>{
  const worker=new Worker('/topology-worker.js',{type:'module'});
  const timer=setTimeout(()=>{worker.terminate();reject(Error('网格检查超过 45 秒，未给出通过结论。请交由工程执行器检查。'));},45000);
  const close=()=>{clearTimeout(timer);worker.terminate();};
  worker.onerror=()=>{close();reject(Error('网格检查任务未完成，模型没有被修改。'));};
  worker.onmessage=(event:MessageEvent<{report?:TopologyReport;error?:string}>)=>{close();if(event.data.report)resolve(event.data.report);else reject(Error(event.data.error??'网格检查未返回有效结果。'));};
  worker.postMessage(input,[input.coordinates.buffer as ArrayBuffer]);
 });
}

export async function currentGeometryHash(object:THREE.Object3D){
 const {coordinates}=triangleInput(object),bytes=new ArrayBuffer(coordinates.byteLength),view=new DataView(bytes);
 for(let i=0;i<coordinates.length;i++){const value=coordinates[i];if(!Number.isFinite(value)||Math.abs(value)>1e9)throw Error('模型包含无效坐标。');view.setFloat64(i*8,value===0?0:value,true);}
 return sha256Hex(bytes);
}
