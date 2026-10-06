import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';
import {createServer} from 'vite';

const root=resolve(import.meta.dirname,'..');
const miniflare=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],r2Buckets:['BUCKET']});
const vite=await createServer({root,configFile:false,resolve:{alias:{'@':root}},optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom',logLevel:'error'});

try{
 const db=await miniflare.getD1Database('DB'),bucket=await miniflare.getR2Bucket('BUCKET');
 for(const file of ['drizzle/0000_acoustic_captain_marvel.sql','drizzle/0001_cuddly_master_chief.sql','drizzle/0002_spotty_surge.sql']){
  const statements=readFileSync(resolve(root,file),'utf8').split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean);
  for(const statement of statements)await db.prepare(statement).run();
 }
 const [{executeAgentTool},{sampleCad,cadHash}]=await Promise.all([
  vite.ssrLoadModule('/lib/agent-tool-gateway.ts'),
  vite.ssrLoadModule('/lib/cad-spec.ts'),
 ]);
 const design=sampleCad(),partId=design.parts[0].id,designId=design.id,initialDesignSha=await cadHash(design);
 const projectId='10000000-0000-4000-8000-000000000001',ownerId='gateway-validation-owner',now=new Date().toISOString();
 const project={id:projectId,revision:1,title:'Agent Tool Gateway Golden',brief:'Validate an idempotent parameterized CAD repair.',domain:'product',targetSize:100,quantity:1,connection:'screw',preferredProcess:'FDM',cadDesigns:[design],parts:[{engineeringRole:'manufacturing',id:partId,name:design.parts[0].name,kind:'asset',params:{unitScale:1},position:[0,0,0],assetId:'10000000-0000-4000-8000-000000000099',assetName:`${partId}.stl`,interfaceLocked:false,color:design.parts[0].color,source:{kind:'cad',jobId:'10000000-0000-4000-8000-000000000098',designId,designSha256:initialDesignSha,assetSha256:'c'.repeat(64),logicalPartId:partId,importerVersion:'controlled-cad-v1'}}],checks:[],notes:[],createdAt:now,updatedAt:now};
 const body=JSON.stringify(project);
 await db.batch([
  db.prepare('INSERT INTO projects(id,owner_id,title,revision,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(projectId,ownerId,project.title,1,body,now,now),
  db.prepare('INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) VALUES(?,?,?,?,?,?)').bind('10000000-0000-4000-8000-000000000002',projectId,ownerId,1,body,now),
  db.prepare('INSERT INTO execution_devices(id,owner_id,public_key,label,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('10000000-0000-4000-8000-000000000003',ownerId,'test-public-key','Golden executor','active',now,now),
 ]);
 const runId='10000000-0000-4000-8000-000000000010',stepId='change-bracket',baseArguments={action:'change_cad_parameters',part_id:partId,design_id:designId,parameters:{width:49},success_criteria:['New signed CAD assets are attached.']};
 const results=[];
 const invoke=async(tool,toolIndex,expectedRevision)=>{
  const invocation={run_id:runId,plan_version:1,step_id:stepId,tool_index:toolIndex,tool,idempotency_key:`repair:${runId}:plan:1:step:${stepId}:tool:${toolIndex}`,owner_id:ownerId,project_id:projectId,expected_revision:expectedRevision,arguments:{...baseArguments,prior_results:results.map(result=>({tool:result.invocation.tool,outcome:result.outcome,output:result.output}))}};
  const result=await executeAgentTool({DB:db,BUCKET:bucket},ownerId,invocation);
  results.push(result);
  return result;
 };
 const applied=await invoke('apply_design_change',0,1);
 if(applied.outcome!=='succeeded'||applied.output.project_revision!==2)throw Error('Design change did not create revision 2.');
 const created=await invoke('create_cad_job',1,2),started=await invoke('start_cad_execution',2,2),waiting=await invoke('poll_cad_execution',3,2);
 if(created.outcome!=='succeeded'||started.outcome!=='succeeded'||waiting.outcome!=='pending')throw Error('CAD job did not reach the durable wait state.');
 const jobId=created.output.cad_job_id,executionRunId=started.output.execution_run_id,assetId='10000000-0000-4000-8000-000000000020';
 const task=JSON.parse((await db.prepare('SELECT request FROM jobs WHERE id=?').bind(jobId).first()).request);
 const changedDesign=JSON.parse(task.designJson),spec=changedDesign.parts[0],designSha=await cadHash(changedDesign);
 const archived={objectKey:`${ownerId}/cad/${jobId}/result.zip`,artifactSha256:'a'.repeat(64),designId,designSha256:designSha,assets:[{partId:spec.id,assetId,sha256:'b'.repeat(64),position:[0,0,0],dimensions:[49,30,30],triangles:120}],summary:{verification:'unsigned_local_report',productionReady:false,partCount:1,interfaceCount:changedDesign.interfaces.length,overlapCount:0,notChecked:['physical validation']},executionProof:{verification:'registered_device_signature_verified',receiptJson:'{}',signature:'test'}};
 await db.batch([
  db.prepare('INSERT INTO assets(id,owner_id,filename,content_type,size,object_key,created_at) VALUES(?,?,?,?,?,?,?)').bind(assetId,ownerId,`${spec.id}.stl`,'application/octet-stream',100,`${ownerId}/${assetId}`,now),
  db.prepare("UPDATE jobs SET status='result_archived',result=?,updated_at=? WHERE id=?").bind(JSON.stringify(archived),now,jobId),
  db.prepare("UPDATE execution_runs SET status='succeeded',updated_at=? WHERE id=?").bind(now,executionRunId),
 ]);
 const completedPoll=await invoke('poll_cad_execution',3,2),attached=await invoke('attach_cad_result',4,2),verified=await invoke('verify_revision',5,3);
 if(completedPoll.outcome!=='succeeded'||attached.output.project_revision!==3||verified.outcome!=='succeeded'||verified.output.verified!==true)throw Error(`The repair result did not pass revision verification: ${JSON.stringify({completedPoll,attached,verified})}`);
 const replayIndexes=[0,1,2,5];
 const replays=[];
 for(const index of replayIndexes)replays.push(await executeAgentTool({DB:db,BUCKET:bucket},ownerId,{...results[index].invocation}));
 const foreignProjectId='10000000-0000-4000-8000-000000000030',foreignJobId='10000000-0000-4000-8000-000000000031';
 await db.prepare("INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,created_at,updated_at) VALUES(?,?,?,?,?,'prepared',?,?,?)").bind(foreignJobId,ownerId,foreignProjectId,2,'cad_build',JSON.stringify({...task,jobId:foreignJobId,projectId:foreignProjectId}),now,now).run();
 const crossPlanVersion=2,crossProjectInvocation={...started.invocation,plan_version:crossPlanVersion,idempotency_key:`repair:${runId}:plan:${crossPlanVersion}:step:${stepId}:tool:2`,arguments:{...baseArguments,prior_results:[{tool:'create_cad_job',outcome:'succeeded',output:{cad_job_id:foreignJobId}}]}};
 const crossProject=await executeAgentTool({DB:db,BUCKET:bucket},ownerId,crossProjectInvocation);
 if(crossProject.outcome!=='failed'||crossProject.error_code!=='cad_job_project_mismatch')throw Error('Tool Gateway accepted a same-owner CAD job from another project.');
 const tampered=await executeAgentTool({DB:db,BUCKET:bucket},ownerId,{...verified.invocation,idempotency_key:`${verified.invocation.idempotency_key}:tampered`});
 if(tampered.outcome!=='failed'||tampered.error_code!=='tool_invocation_identity_invalid')throw Error('Tool Gateway accepted a non-canonical idempotency identity.');
 const counts=await Promise.all([
  db.prepare("SELECT count(*) AS count FROM jobs WHERE kind='cad_build' AND project_id=?").bind(projectId).first(),
  db.prepare('SELECT count(*) AS count FROM execution_runs WHERE project_id=?').bind(projectId).first(),
  db.prepare('SELECT count(*) AS count FROM revisions WHERE project_id=?').bind(projectId).first(),
 ]);
 if(replays.some(result=>result.outcome!=='succeeded')||counts[0].count!==1||counts[1].count!==1||counts[2].count!==3)throw Error('Idempotent replay created duplicate side effects.');
 const visualProjectId='10000000-0000-4000-8000-000000000040',visualPartId='10000000-0000-4000-8000-000000000041',visualAssetId='10000000-0000-4000-8000-000000000042',visualJobId='10000000-0000-4000-8000-000000000043';
 const sourceFile=readFileSync(resolve(root,'work/validation/glb-fixtures/G01_box.glb'));
 const sourceBytes=sourceFile.buffer.slice(sourceFile.byteOffset,sourceFile.byteOffset+sourceFile.byteLength);
 const {sha256Hex}=await vite.ssrLoadModule('/lib/crypto-portable.ts');
 const sourceSha=await sha256Hex(sourceBytes),sourceKey=`${ownerId}/${visualAssetId}`;
 const visualProject={...project,id:visualProjectId,title:'Visual region edit golden',revision:1,cadDesigns:[],parts:[{id:visualPartId,name:'Tripo visual reference',kind:'asset',params:{unitScale:1000},position:[0,0,0],assetId:visualAssetId,assetName:'box.glb',interfaceLocked:false,color:'#8ab9cd',engineeringRole:'visual_reference',source:{kind:'tripo',jobId:visualJobId,assetSha256:sourceSha,sceneIndex:0,nodeIndices:[0],importerVersion:'glb-static-v1'}}]};
 await bucket.put(sourceKey,sourceBytes);
 await db.batch([
  db.prepare('INSERT INTO assets(id,owner_id,filename,content_type,size,object_key,created_at) VALUES(?,?,?,?,?,?,?)').bind(visualAssetId,ownerId,'box.glb','model/gltf-binary',sourceBytes.byteLength,sourceKey,now),
  db.prepare('INSERT INTO projects(id,owner_id,title,revision,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(visualProjectId,ownerId,visualProject.title,1,JSON.stringify(visualProject),now,now),
  db.prepare('INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) VALUES(?,?,?,?,?,?)').bind('10000000-0000-4000-8000-000000000044',visualProjectId,ownerId,1,JSON.stringify(visualProject),now),
 ]);
 const feedback={schema:'design-feedback-region-v1',id:'10000000-0000-4000-8000-000000000045',projectId:visualProjectId,projectRevision:1,partId:visualPartId,objectId:'visual-part',location:{world:[10,-20,30],local:[10,-20,30],faceIndex:null,normal:[0,0,1]},view:{mode:'visual',preset:'hero',cameraPosition:[0,-100,100],target:[0,0,0]},region:{path:[[0,0],[0.25,0],[0.5,0],[0.5,0.5],[0.25,0.5],[0,0.5]],worldPath:[[-10,-50,30],[10,-50,30],[30,-50,30],[30,10,30],[10,10,30],[-10,10,30]],coordinateSystem:'normalized_viewport'},annotationImageAssetId:'10000000-0000-4000-8000-000000000046',userFeedback:'顶面抬高 2 毫米',createdAt:now};
 const visualRunId='10000000-0000-4000-8000-000000000047',visualStepId='raise-top';
 const visualBase={action:'change_visual_mesh',part_id:visualPartId,design_id:null,parameters:{operation:'offset',amount_mm:2,falloff_mm:5,depth_mm:5},success_criteria:['Selected top region moves 2 mm.'],feedback};
 const visualInvoke=(tool,toolIndex,expectedRevision,prior_results=[])=>executeAgentTool({DB:db,BUCKET:bucket},ownerId,{run_id:visualRunId,plan_version:1,step_id:visualStepId,tool_index:toolIndex,tool,idempotency_key:`repair:${visualRunId}:plan:1:step:${visualStepId}:tool:${toolIndex}`,owner_id:ownerId,project_id:visualProjectId,expected_revision:expectedRevision,arguments:{...visualBase,prior_results}});
 const visualApplied=await visualInvoke('apply_visual_edit',0,1);
 if(visualApplied.outcome!=='succeeded'||visualApplied.output.project_revision!==2)throw Error(`Visual edit failed: ${JSON.stringify(visualApplied)}`);
 const visualVerified=await visualInvoke('verify_visual_revision',1,2,[{tool:'apply_visual_edit',outcome:'succeeded',output:visualApplied.output}]);
 if(visualVerified.outcome!=='succeeded'||visualVerified.output.verified!==true)throw Error(`Visual verification failed: ${JSON.stringify(visualVerified)}`);
 const visualReplay=await visualInvoke('apply_visual_edit',0,1);
 if(visualReplay.outcome!=='succeeded'||visualReplay.output.asset_ids?.[0]!==visualApplied.output.asset_ids?.[0])throw Error('Visual edit replay was not idempotent.');
 const visualCounts=await Promise.all([db.prepare("SELECT count(*) AS count FROM jobs WHERE kind='visual_edit' AND project_id=?").bind(visualProjectId).first(),db.prepare('SELECT count(*) AS count FROM revisions WHERE project_id=?').bind(visualProjectId).first()]);
 if(visualCounts[0].count!==1||visualCounts[1].count!==2)throw Error('Visual edit created duplicate records.');
 console.log(JSON.stringify({schema:'agent-tool-gateway-golden-v1',phases:['apply','job','execute','wait','attach','verify','replay','visual_apply','visual_verify','visual_replay'],finalRevision:verified.output.project_revision,jobs:counts[0].count,executionRuns:counts[1].count,revisions:counts[2].count,visualRevision:visualVerified.output.project_revision,visualJobs:visualCounts[0].count,projectIsolation:true,invocationIdentity:true,passed:true}));
}finally{
 await vite.close();
 await miniflare.dispose();
}
