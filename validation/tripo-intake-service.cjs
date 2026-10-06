/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('fs'),path=require('path'),esbuild=require('esbuild');
const{DatabaseSync}=require('node:sqlite');
const site=process.cwd(),bundle=path.join(site,'work','validation','tripo-intake-service-test.cjs');
esbuild.buildSync({stdin:{contents:"export {intakeTripoCandidate} from './lib/tripo-intake';",resolveDir:site,sourcefile:'readonly-tripo-intake-service.ts',loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'cjs',tsconfig:path.join(site,'tsconfig.json'),logLevel:'silent'});
const{intakeTripoCandidate}=require(bundle);
const fixture=fs.readFileSync(path.join(site,'work','validation','glb-fixtures','G01_box.glb'));
const bytes=fixture.buffer.slice(fixture.byteOffset,fixture.byteOffset+fixture.byteLength),now=new Date().toISOString(),uid='intake-owner',projectId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222',assetId='33333333-3333-4333-8333-333333333333';
const project={id:projectId,revision:1,title:'intake fixture',brief:'fixture',domain:'creative',targetSize:40,quantity:1,connection:'screw',preferredProcess:'FDM',parts:[],checks:[],notes:[],createdAt:now,updatedAt:now};
const state={schemaVersion:1,asset:{id:assetId,sha256:'',bytes:fixture.byteLength,filename:'source.glb',contentType:'model/gltf-binary',summary:null,support:'conversion_required',issue:'texture budget',downloadHost:'fixture',recoveredAt:now}};
async function sha256(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');}
async function main(){
 state.asset.sha256=await sha256(bytes);
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(path.join(site,'drizzle','0000_acoustic_captain_marvel.sql'),'utf8'));
 db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(projectId,uid,project.title,1,JSON.stringify(project),now,now);
 db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(assetId,uid,'source.glb','model/gltf-binary',fixture.byteLength,'fixture/source.glb',now);
 db.prepare('INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,provider_task_id,request,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(jobId,uid,projectId,1,'text','conversion_required','provider-task','{"manufacturing":{}}',JSON.stringify(state),now,now);
 const objects=new Map([['fixture/source.glb',bytes]]),DB={prepare(query){const statement={query,args:[],bind(...values){this.args=values;return this;},async first(){return db.prepare(this.query).get(...this.args)||null;},async run(){const result=db.prepare(this.query).run(...this.args);return{meta:{changes:Number(result.changes)}};}};return statement;},async batch(statements){return statements.map(statement=>{const result=db.prepare(statement.query).run(...statement.args);return{meta:{changes:Number(result.changes)}};});}};
 const BUCKET={async get(key){const value=objects.get(key);return value?{size:value.byteLength,arrayBuffer:async()=>value}:null;},async put(key,value){objects.set(key,value instanceof ArrayBuffer?value:value.buffer);}};
 const first=await intakeTripoCandidate({DB,BUCKET},uid,{jobId,projectRevision:1,targetLongestMm:40});
 const savedJob=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId),second=await intakeTripoCandidate({DB,BUCKET},uid,{jobId,projectRevision:2,targetLongestMm:40}),savedProject=db.prepare('SELECT revision,body FROM projects WHERE id=?').get(projectId),savedAssets=db.prepare('SELECT COUNT(*) AS count FROM assets WHERE owner_id=?').get(uid);
 const part=first.project.parts[0],report={schema:'tripo-engineering-intake-service-test-v1',firstRevision:first.project.revision,secondAlreadyIntaked:second.alreadyIntaked,jobStatus:savedJob.status,assetCount:savedAssets.count,sourceKind:part.source?.kind,derivedMethod:part.source?.derivedFrom?.method,geometryStatus:first.project.checks.find(c=>c.name.endsWith('几何可读'))?.status,topologyStatus:first.project.checks.find(c=>c.name.endsWith('网格拓扑'))?.status,stageGate:first.intake.qualityReport.stageGate.allowedIntoNextEngineeringStage,preservedOriginal:first.intake.originalAsset.id===assetId&&objects.has('fixture/source.glb'),projectRevision:savedProject.revision,passed:first.project.revision===2&&second.alreadyIntaked===true&&savedJob.status==='attached'&&savedAssets.count===2&&part.source?.derivedFrom?.method==='embedded-texture-strip-v1'&&first.project.checks.length===8&&first.intake.originalAsset.id===assetId&&objects.size===2};
 console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
