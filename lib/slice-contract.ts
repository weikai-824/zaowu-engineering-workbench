import recipe from '@/public/offline-bambu/recipe.json';
import type {SavedPartBinding} from './saved-part-geometry';
import type {Part} from './engineering';
import {sha256Hex} from './crypto-portable';
export {recipe};
export type SliceManifest={sourceGeometry?:SavedPartBinding;schemaVersion:1;jobId:string;projectId:string;projectRevision:number;projectInputHash:string;part:Part;createdAt:string;purpose:'reference_offline';productionReady:false;recipeId:string;engine:typeof recipe.engine;files:Record<string,{sha256:string;bytes:number}>;geometry:{units:'mm';upAxis:'Z';triangles:number;dimensionsMm:number[]};sourceClaim:'browser_generated_mesh';machineInstanceId:null;materialLot:null};
export const sha256=sha256Hex;
export function binaryStlInfo(bytes:ArrayBuffer,maxDimensions:readonly number[]=recipe.maxDimensionsMm){
 if(bytes.byteLength<134||bytes.byteLength>20*1024*1024)throw Error('单零件 STL 需为二进制格式，且不超过 20 MB。');
 const view=new DataView(bytes);const n=view.getUint32(80,true);if(!n||84+n*50!==bytes.byteLength)throw Error('STL 三角面长度无效。');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<n;i++)for(let v=0;v<3;v++)for(let k=0;k<3;k++){const x=view.getFloat32(84+i*50+12+v*12+k*4,true);if(!Number.isFinite(x)||Math.abs(x)>100000)throw Error('STL 坐标无效。');min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x);}
 const size=max.map((v,i)=>v-min[i]);if(size.some((x,i)=>x<=0||x>maxDimensions[i]))throw Error('STL 尺寸必须大于 0 且位于当前任务的尺寸范围。');
 return {units:'mm' as const,upAxis:'Z' as const,triangles:n,dimensionsMm:size};
}
