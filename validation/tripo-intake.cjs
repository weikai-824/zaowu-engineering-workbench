/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('fs'),path=require('path'),esbuild=require('esbuild');
const site=process.cwd(),bundle=path.join(site,'work','validation','tripo-intake-test.cjs');
esbuild.buildSync({stdin:{contents:"export {deriveEngineeringGlb} from './lib/glb-derived';export {inspectGlb} from './lib/glb-inspect';export {analyzeTriangles} from './lib/topology';export {importModel,measure} from './lib/geometry';",resolveDir:site,sourcefile:'readonly-tripo-intake.ts',loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'cjs',tsconfig:path.join(site,'tsconfig.json'),logLevel:'silent'});
const{deriveEngineeringGlb,inspectGlb,analyzeTriangles,importModel,measure}=require(bundle);
function bytes(file){const value=fs.readFileSync(file);return value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);}
function inspect(data){const coordinates=[];const summary=inspectGlb(data,values=>coordinates.push(...values));return{summary,coordinates};}
async function main(){
 const fixture=path.join(site,'work','validation','glb-fixtures','G01_box.glb'),original=bytes(fixture),derived=deriveEngineeringGlb(original),before=inspect(original),after=inspect(derived);
 if(after.summary.triangles!==before.summary.triangles||JSON.stringify(after.summary.dimensionsMm)!==JSON.stringify(before.summary.dimensionsMm))throw Error('派生资产改变了基础几何摘要。');
 if(Buffer.from(original).equals(Buffer.from(derived)))throw Error('派生资产没有产生新的文件。');
 if(JSON.stringify(after.coordinates)!==JSON.stringify(before.coordinates))throw Error('派生资产改变了三角坐标。');
 const topology=await analyzeTriangles({coordinates:new Float64Array(after.coordinates),sourceMeshes:after.summary.meshNodeCount,sourceVertexRecords:after.coordinates.length/3});
 const p1c=path.join(site,'work','validation','tripo-p1c-rerun','high-quality-candidate.glb');let p1cResult=null;
 if(fs.existsSync(p1c)){const p1cOriginal=bytes(p1c),p1cDerived=deriveEngineeringGlb(p1cOriginal),p1cInspected=inspect(p1cDerived),viewerObject=await importModel(p1cDerived,'high-quality-engineering-intake.glb',142.86455194233326),viewerMeasured=measure(viewerObject);p1cResult={originalBytes:p1cOriginal.byteLength,derivedBytes:p1cDerived.byteLength,triangles:p1cInspected.summary.triangles,dimensionsMm:p1cInspected.summary.dimensionsMm,viewer:{status:'passed',triangles:viewerMeasured.triangles,dimensionsMm:viewerMeasured.size}};if(p1cInspected.summary.triangles!==69889||viewerMeasured.triangles!==69889)throw Error('P1-C 派生资产三角面数与已记录证据不一致。');}
 const result={schema:'tripo-engineering-intake-test-v1',method:'embedded-texture-strip-v1',fixture:{originalBytes:original.byteLength,derivedBytes:derived.byteLength,triangles:after.summary.triangles,dimensionsMm:after.summary.dimensionsMm,topology:topology.verdict},p1c:p1cResult,passed:true};console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
