import JSZip from 'jszip';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {partObject,type ModelMap} from './geometry';
import {sha256,recipe,type SliceManifest} from './slice-contract';
import type {Part} from './engineering';
export function sliceInput(part:Part,models:ModelMap){const data=new STLExporter().parse(partObject(part,models),{binary:true});return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer;}
export async function taskPacket(task:{id:string;manifest:SliceManifest;manifestJson:string;manifestSha256:string},input?:ArrayBuffer){
 if(await sha256(task.manifestJson)!==task.manifestSha256)throw Error('任务清单校验失败。');const zip=new JSZip();zip.file('manifest.json',task.manifestJson);zip.file('manifest.sha256',task.manifestSha256+'\n');
 for(const [name,record] of Object.entries(task.manifest.files)){
  let data:ArrayBuffer;
  if(name==='input.stl'&&input)data=input;else{const r=await fetch(name==='input.stl'?'/api/slicing/jobs?id='+task.id+'&file=input':'/offline-bambu/'+name);if(!r.ok)throw Error('无法读取任务附件：'+name);data=await r.arrayBuffer();}
  if(data.byteLength!==record.bytes||await sha256(data)!==record.sha256)throw Error('任务附件校验失败：'+name);
  if(name!=='input.stl'&&record.sha256!==recipe.files[name as keyof typeof recipe.files]?.sha256)throw Error('参考配置未在允许清单中。');zip.file(name,data);
 }
 return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}
