import {threeMfTriangles} from './three-mf-geometry';
import {compareMeshes,binaryStlTriangles} from './mesh-identity';
import {z} from 'zod';
import {boundedZip} from './bounded-zip';
import {recipe,sha256,type SliceManifest} from './slice-contract';
const hash=z.string().regex(/^[0-9a-f]{64}$/);
const reportSchema=z.object({schemaVersion:z.literal(1),jobId:z.string().uuid(),manifestSha256:hash,inputSha256:hash,engine:z.object({name:z.string(),version:z.string(),executableSha256:hash,dllSha256:hash}),exitCode:z.literal(0),startedAt:z.string().datetime({offset:true}),finishedAt:z.string().datetime({offset:true}),files:z.record(z.object({sha256:hash,bytes:z.number().int().positive()}))});
const names=['sliced.3mf','effective-settings.json','slicer-result.json','process-log.txt'];
export async function verifySliceResult(bytes:ArrayBuffer,manifest:SliceManifest,manifestHash:string,input:ArrayBuffer){
 if(input.byteLength!==manifest.files['input.stl'].bytes||await sha256(input)!==manifest.files['input.stl'].sha256)throw Error('保存的切片输入指纹不一致。');
 const zip=await boundedZip(bytes);const paths=Object.values(zip.files).filter(f=>!f.dir).map(f=>f.name);
 if(paths.length!==5||paths.some(n=>!['report.json',...names].includes(n)))throw Error('结果包只允许报告、3MF、生效设置、切片摘要和日志这五个文件。');
 const report=reportSchema.parse(JSON.parse(await zip.file('report.json')!.async('string')));
 if(report.jobId!==manifest.jobId||report.manifestSha256!==manifestHash||report.inputSha256!==manifest.files['input.stl'].sha256)throw Error('结果不属于这份已保存的零件任务。');
 if(JSON.stringify(report.engine)!==JSON.stringify(recipe.engine))throw Error('切片引擎版本或文件指纹不符合固定参考配置。');
 const duration=Date.parse(report.finishedAt)-Date.parse(report.startedAt);if(duration<0||duration>900000)throw Error('执行时间记录无效。');
 const contents:Record<string,Uint8Array>={};
 for(const n of names){const b=await zip.file(n)!.async('uint8array');if(b.byteLength!==report.files[n]?.bytes||await sha256(b)!==report.files[n]?.sha256)throw Error('结果文件长度或指纹不一致：'+n);contents[n]=b;}
 const decode=(n:string)=>new TextDecoder().decode(contents[n]);
 const settings=JSON.parse(decode('effective-settings.json'));
 const inner=await boundedZip(contents['sliced.3mf'],12*1024*1024,48);
 const embedded=inner.file('Metadata/project_settings.config');const codeFile=inner.file('Metadata/plate_1.gcode');
 for(const path of ['[Content_Types].xml','_rels/.rels','3D/3dmodel.model','Metadata/model_settings.config']){const f=inner.file(path);if(!f||(await f.async('uint8array')).length<32)throw Error('3MF 工程结构缺少 '+path);}
 if(!Object.keys(inner.files).some(n=>/^3D\/Objects\/.+\.model$/.test(n)))throw Error('3MF 缺少零件几何文件。');
 if(!embedded||!codeFile||Object.keys(inner.files).filter(n=>/\.gcode$/.test(n)).length!==1)throw Error('3MF 缺少单盘 G-code 或内嵌生效设置。');
 const embeddedSettings=JSON.parse(await embedded.async('string'));
 for(const [key,value] of Object.entries(recipe.expectedSettings)){if(JSON.stringify(settings[key])!==JSON.stringify(value)||JSON.stringify(embeddedSettings[key])!==JSON.stringify(value))throw Error('实际生效设置与固定参考不符：'+key);}
 const summary=JSON.parse(decode('slicer-result.json'));const plate=summary?.sliced_plates?.[0];
 if(summary.return_code!==0||summary.sliced_plates?.length!==1||plate?.objects?.length!==1)throw Error('切片器没有返回成功的单零件单盘结果。');
 const object=plate.objects[0];if(object.triangle_count!==manifest.geometry.triangles||['width','depth','height'].some((key,i)=>!Number.isFinite(object.bbox?.[key])||Math.abs(object.bbox[key]-manifest.geometry.dimensionsMm[i])>.15))throw Error('切片报告的面数或尺寸与输入不一致。');
 const embeddedGeometry=await threeMfTriangles(inner);const geometryComparison=await compareMeshes(binaryStlTriangles(input),embeddedGeometry.coordinates,true);
 const code=await codeFile.async('string');const layers=Number(code.match(/; total layer number:\s*(\d+)/)?.[1]);
 if(!code.includes('; BambuStudio '+recipe.engine.version)||!Number.isInteger(layers)||layers<=0||!/(?:^|\n)G1\s[^\n]*E[0-9.]+/m.test(code))throw Error('未找到有效切片层或挤出路径。');
 if(!Number.isFinite(plate.total_predication)||plate.total_predication<=0)throw Error('切片时间估算无效。');
 return {jobId:manifest.jobId,partId:manifest.part.id,projectRevision:manifest.projectRevision,artifactIntegrity:'consistent' as const,executionAttestation:'unsigned_local_report' as const,geometryProof:'embedded_mesh_matches_input_within_tolerance' as const,geometryComparison,plateBinding:embeddedGeometry.binding,savedPartBinding:manifest.sourceGeometry?.status??'legacy_unverified',physicalValidation:'not_run' as const,productionReady:false,layerCount:layers,estimatedSeconds:plate.total_predication,estimatedGrams:Number(plate.filaments?.[0]?.total_used_g)||null,warnings:typeof plate.warning_message==='string'?plate.warning_message.slice(0,2000):'',engine:report.engine,settings:recipe.expectedSettings,finishedAt:report.finishedAt,artifactSha256:await sha256(bytes)};
}
