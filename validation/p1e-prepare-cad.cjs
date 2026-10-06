/* eslint-disable @typescript-eslint/no-require-imports */
// One-time local preparation for P1-E. It only writes the existing local D1
// project/revision/job ledger; it never contacts Tripo or a CAD provider.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {DatabaseSync}=require('node:sqlite');
const site=path.resolve(__dirname,'..'),req=createRequire(path.join(site,'package.json')),esbuild=req('esbuild');
const dbPath=path.join(site,'.wrangler','state','v3','d1','miniflare-D1DatabaseObject','faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite');
const out=path.join(site,'work','validation','p1e-cad');fs.mkdirSync(out,{recursive:true});
const bundle=path.join(out,'p1e-prepare-cad.bundle.cjs');
esbuild.buildSync({stdin:{contents:"export {goldenEnclosureCadDesign,GOLDEN_ENCLOSURE_ASSUMPTIONS} from './lib/golden-enclosure-cad';export {parseCad,cadHash,cadCanonical} from './lib/cad-spec';export {engineeringFingerprint} from './lib/engineering';",resolveDir:site,sourcefile:'readonly-p1e-prepare-cad.ts',loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'cjs',tsconfig:path.join(site,'tsconfig.json'),logLevel:'silent'});
const {goldenEnclosureCadDesign,GOLDEN_ENCLOSURE_ASSUMPTIONS,parseCad,cadHash,cadCanonical,engineeringFingerprint}=require(bundle);
const ownerId='local_seedy',projectId='91ad21c0-4143-4252-8969-00dc31047b82';
const CAD_RUNTIME_BLOCK='blocked: 当前 Windows 工作区只有 Microsoft Store 的 python.exe 别名，没有可验证的 Python 3.12 + CadQuery 2.8.0 + OCP 7.9.3.1.1 运行时；没有创建 CAD result-v1。';
const CAD_SLICING_BLOCK='blocked: 没有 CAD engineering STL/result，且当前工作区没有固定 Bambu Studio 执行器；未生成本工程切片结果。';
const now=()=>new Date().toISOString();
async function main(){
 const db=new DatabaseSync(dbPath),row=db.prepare('SELECT revision,created_at,body FROM projects WHERE id=? AND owner_id=?').get(projectId,ownerId);
 if(!row)throw Error('找不到 P1-C High Quality 项目。');
 if(row.revision!==2)throw Error(`P1-E 只允许从 revision 2 准备；当前为 revision ${row.revision}，为避免重复 CAD 任务已停止。`);
 const project=JSON.parse(row.body);
 if((project.cadDesigns??[]).length)throw Error('项目已有 CAD 设计；为避免重复设计已停止。');
 const sourcePart=project.parts.find(p=>p.source?.kind==='tripo'&&p.assetId);
 if(!sourcePart)throw Error('项目没有可作为 visual reference 的 P1-D Tripo Part。');
 const priorCad=db.prepare("SELECT id FROM jobs WHERE project_id=? AND owner_id=? AND kind='cad_build'").all(projectId,ownerId);
 if(priorCad.length)throw Error('项目已有 CAD job；为避免重复执行已停止。');
 const design=parseCad(goldenEnclosureCadDesign(project));
 if(!design.visualReference||design.visualReference.partId!==sourcePart.id||design.visualReference.assetId!==sourcePart.assetId||design.visualReference.assetSha256!==sourcePart.source.assetSha256)throw Error('Golden CAD visual reference 没有指向当前 P1-D 派生候选。');
 const designSha256=await cadHash(design),jobId=crypto.randomUUID(),revision=3,t=now();
 const task={schema:'cad-task-v1',jobId,projectId,projectRevision:revision,designJson:cadCanonical(design),designSha256};
 const base={...project,cadDesigns:[design],notes:[...project.notes,...GOLDEN_ENCLOSURE_ASSUMPTIONS,'P1-E：Tripo Part 仅为 visual_reference；CAD 参数源是待执行的工程设计。',CAD_RUNTIME_BLOCK,CAD_SLICING_BLOCK],revision,updatedAt:t};
 const inputHash=await engineeringFingerprint(base);
 const blocked=(name,detail,scope)=>({id:crypto.randomUUID(),name,status:'not_run',detail,scope,revision,inputHash});
 const next={...base,checks:[...project.checks.map(c=>({...c,status:c.status==='not_run'?'not_run':'stale'})),blocked('CAD 内核执行',CAD_RUNTIME_BLOCK,'digital'),blocked('CAD 实体结果与接口校验',CAD_RUNTIME_BLOCK,'digital'),blocked('CAD 路径 · 离线切片与支撑',CAD_SLICING_BLOCK,'manufacturing')]};
 const json=JSON.stringify(next),revisionId=crypto.randomUUID();
 db.exec('BEGIN');
 try{
  db.prepare('INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) VALUES(?,?,?,?,?,?)').run(revisionId,projectId,ownerId,revision,json,t);
  const update=db.prepare('UPDATE projects SET title=?,revision=?,body=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(next.title,revision,json,t,projectId,ownerId,2);
  if(Number(update.changes)!==1)throw Error('P1-E 项目并发更新，未写入 CAD 设计。');
  db.prepare('INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(jobId,ownerId,projectId,revision,'cad_build','runtime_unavailable',JSON.stringify(task),t,t);
  db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
 fs.writeFileSync(path.join(out,jobId+'-cad-task.json'),JSON.stringify(task,null,2));
 const preparation={schema:'p1e-cad-preparation-v1',offlineOnly:true,projectId,fromRevision:2,revision,revisionId,jobId,designId:design.id,designSha256,visualReference:design.visualReference,projectConstraints:{title:project.title,brief:project.brief,domain:project.domain,targetSizeMm:project.targetSize,quantity:project.quantity,connection:project.connection,preferredProcess:project.preferredProcess},task,assumptions:GOLDEN_ENCLOSURE_ASSUMPTIONS,runtime:{status:'blocked',detail:CAD_RUNTIME_BLOCK},slicing:{status:'not_run',detail:CAD_SLICING_BLOCK},tripoApiRequests:0};
 fs.writeFileSync(path.join(out,'preparation.json'),JSON.stringify(preparation,null,2));
 console.log(JSON.stringify({projectId,revision,jobId,designId:design.id,designSha256,featureCount:design.parts.reduce((n,p)=>n+p.features.length,0),interfaceCount:design.interfaces.length,status:'runtime_unavailable',tripoApiRequests:0},null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
