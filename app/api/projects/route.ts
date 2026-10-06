import {owner,runtime,errorResponse,ApiError,bodyJson,checkOrigin} from '@/lib/server';
import {z} from 'zod';
import {topologySchema} from '@/lib/topology-contract';
import {engineeringFingerprint,engineeringRoleIsConsistent,type Project} from '@/lib/engineering';
import {cadSchema,parseCad,assertCadTransition} from '@/lib/cad-spec';
import {validateProcessConfiguration} from '@/lib/process-configuration';

const hash=z.string().regex(/^[0-9a-f]{64}$/);
const cadSource=z.object({kind:z.literal('cad'),jobId:z.string().uuid(),designId:z.string().uuid(),designSha256:hash,assetSha256:hash,logicalPartId:z.string().uuid(),importerVersion:z.literal('controlled-cad-v1')}).strict();
const tripoSource=z.object({kind:z.literal('tripo'),jobId:z.string().uuid(),assetSha256:hash,sceneIndex:z.number().int().nonnegative(),nodeIndices:z.array(z.number().int().nonnegative()).max(4000),importerVersion:z.literal('glb-static-v1'),derivedFrom:z.object({assetId:z.string().uuid(),assetSha256:hash,derivedAssetSha256:hash,method:z.literal('embedded-texture-strip-v1')}).strict().optional()}).strict();
const visualEditSource=z.object({kind:z.literal('visual_edit'),jobId:z.string().uuid(),assetSha256:hash,parentAssetId:z.string().uuid(),parentAssetSha256:hash,importerVersion:z.literal('glb-region-edit-v1')}).strict();
const evidenceAttempt=z.object({status:z.enum(['passed','failed','not_run','stale']),detail:z.string(),attemptedAt:z.string(),revision:z.number().int().nonnegative(),inputHash:hash.optional()}).strict();
const offlineSliceEvidence=z.object({kind:z.literal('offline_slice'),jobId:z.string().uuid(),manifestSha256:hash,artifactSha256:hash,partId:z.string().uuid(),verification:z.literal('offline_consistent'),executionAttestation:z.literal('unsigned_local_report'),physicalValidation:z.literal('not_run'),productionReady:z.literal(false)}).strict();
const partSchema=z.object({engineeringRole:z.enum(['visual_reference','manufacturing']).optional(),source:z.union([cadSource,tripoSource,visualEditSource]).optional(),id:z.string().uuid(),name:z.string().max(160),kind:z.enum(['base','box','asset']),params:z.record(z.number().finite()),position:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),assetId:z.string().uuid().optional(),assetName:z.string().max(300).optional(),profileId:z.string().max(200).optional(),interfaceLocked:z.boolean(),color:z.string().regex(/^#[0-9a-f]{6}$/i),dimensions:z.tuple([z.number(),z.number(),z.number()]).optional(),triangles:z.number().int().nonnegative().optional()});
const evidenceSchema=z.object({partId:z.string().uuid().optional(),measuredAtRevision:z.number().int().nonnegative().optional(),topology:topologySchema.optional(),provenance:offlineSliceEvidence.optional(),currentAttempt:evidenceAttempt.optional(),id:z.string(),name:z.string(),status:z.enum(['passed','failed','not_run','stale']),detail:z.string(),scope:z.enum(['digital','manufacturing','physical']),revision:z.number().int(),inputHash:hash.optional()});
const processConfigurationSchema=z.object({profileId:z.string().min(1).max(200),values:z.record(z.union([z.number().finite(),z.boolean()]))}).strict();
const shape=z.object({cadDesigns:z.array(cadSchema).max(12).optional(),processConfiguration:processConfigurationSchema.optional(),references:z.array(z.object({id:z.string().uuid(),name:z.string().max(250),view:z.enum(['front','back','left','right','top','bottom']).optional()})).max(20).optional(),id:z.string().uuid(),revision:z.number().int().min(0),title:z.string().min(1).max(160),brief:z.string().max(16000),domain:z.string().max(50),targetSize:z.number().positive().max(100000),quantity:z.number().int().positive().max(1000000),connection:z.string().max(50),preferredProcess:z.string().max(50),parts:z.array(partSchema).max(200),checks:z.array(evidenceSchema).max(800),notes:z.array(z.string().max(2000)).max(1000),createdAt:z.string(),updatedAt:z.string()});
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
 return value;
}

export async function GET(request:Request){
 try{
  const uid=await owner(),db=runtime().DB,url=new URL(request.url),id=url.searchParams.get('id');
  if(id){const row=await db.prepare('SELECT body FROM projects WHERE id=? AND owner_id=?').bind(id,uid).first<{body:string}>();if(!row)throw new ApiError(404,'项目不存在。');return Response.json(JSON.parse(row.body));}
  const rows=await db.prepare('SELECT id,title,revision,created_at,updated_at FROM projects WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100').bind(uid).all();return Response.json(rows.results);
 }catch(e){return errorResponse(e);}
}

export async function POST(request:Request){
 try{
  checkOrigin(request);const uid=await owner(),parsed=shape.safeParse(await bodyJson(request,4_000_000));
  if(!parsed.success)throw new ApiError(400,'项目数据不完整或包含无效尺寸。');
  const p=parsed.data as Project&{agentRepairs?:unknown[]};
  if(p.processConfiguration){const issue=validateProcessConfiguration(p.processConfiguration);if(issue)throw new ApiError(400,issue);}
  try{
   for(const design of p.cadDesigns??[])parseCad(design);
   if(new Set(p.cadDesigns?.map(design=>design.id)).size!==(p.cadDesigns?.length??0))throw Error('CAD 设计编号重复。');
   const ids=(p.cadDesigns??[]).flatMap(design=>design.parts.map(part=>part.id));if(new Set(ids).size!==ids.length)throw Error('不同 CAD 设计不能复用零件编号。');
  }catch(e){throw new ApiError(400,e instanceof Error?e.message:'CAD 设计无效。');}
  if(new Set(p.parts.map(value=>value.id)).size!==p.parts.length||new Set(p.checks.map(value=>value.id)).size!==p.checks.length)throw new ApiError(400,'零件编号和检查编号必须分别唯一。');
  for(const check of p.checks){
   if(check.partId&&!p.parts.some(part=>part.id===check.partId))throw new ApiError(400,'检查记录引用了不存在的零件。');
   if(check.topology&&(check.status==='not_run'||check.status==='failed'&&check.topology.verdict==='no_topology_issue_detected'||!check.partId||check.scope!=='digital'||check.measuredAtRevision===undefined||check.measuredAtRevision>p.revision||!check.inputHash||check.status==='passed'&&check.topology.verdict!=='no_topology_issue_detected'))throw new ApiError(400,'拓扑记录缺少来源或结论不一致。');
   if(check.provenance&&(check.scope!=='manufacturing'||check.partId!==check.provenance.partId||!check.inputHash||check.status==='not_run'||check.status==='failed'))throw new ApiError(400,'切片证据来源与检查状态不一致。');
   if(check.scope!=='digital'&&check.status==='passed'&&!(check.scope==='manufacturing'&&check.provenance?.kind==='offline_slice'))throw new ApiError(400,'制造与物理检查需要受控来源记录，不能由草稿直接标记通过。');
  }
  for(const part of p.parts){
   if(!engineeringRoleIsConsistent(part))throw new ApiError(400,'零件工程角色与受控来源不一致。');
   if(part.kind==='base'&&!(part.params.diameter>0&&part.params.height>0&&part.params.holeDiameter>=0&&part.params.holeDiameter<part.params.diameter))throw new ApiError(400,'底座外径、高度和孔径关系无效。');
   if(part.kind==='asset'&&!part.assetId)throw new ApiError(400,'网格零件缺少已保存的附件。');
  }
  const db=runtime().DB,existing=await db.prepare('SELECT revision,created_at,body FROM projects WHERE id=? AND owner_id=?').bind(p.id,uid).first<{revision:number;created_at:string;body:string}>();
  if(existing&&existing.revision!==p.revision)throw new ApiError(409,'项目已在其他窗口更新，请重新载入后再编辑。');
  if(!existing&&p.revision!==0)throw new ApiError(409,'找不到对应的项目基础版本。');
  const oldSnapshot=existing?JSON.parse(existing.body) as Project&{agentRepairs?:unknown[]}:null;
  if(oldSnapshot?.agentRepairs)p.agentRepairs=oldSnapshot.agentRepairs;
  if(oldSnapshot&&JSON.stringify(canonical(p))===JSON.stringify(canonical(oldSnapshot)))return Response.json(oldSnapshot);
  for(const ref of p.references??[]){const asset=await db.prepare('SELECT id FROM assets WHERE id=? AND owner_id=?').bind(ref.id,uid).first();if(!asset)throw new ApiError(400,'参考图未上传或无权访问。');}
  for(const part of p.parts)if(part.assetId){const asset=await db.prepare('SELECT id FROM assets WHERE id=? AND owner_id=?').bind(part.assetId,uid).first();if(!asset)throw new ApiError(400,'项目引用了不可用的模型文件。');}
  for(const part of p.parts){
   if(part.source?.kind==='cad'){
    const source=part.source,row=await db.prepare("SELECT result FROM jobs WHERE id=? AND owner_id=? AND kind='cad_build'").bind(source.jobId,uid).first<{result:string}>(),result=row?.result?JSON.parse(row.result):null,asset=result?.assets?.find((value:{partId:string})=>value.partId===part.id);
    if(!asset||part.kind!=='asset'||asset.assetId!==part.assetId||asset.sha256!==source.assetSha256||result.designId!==source.designId||result.designSha256!==source.designSha256||source.logicalPartId!==part.id||JSON.stringify(part.position)!==JSON.stringify(asset.position)||Object.keys(part.params).length!==1||part.params.unitScale!==1||!p.cadDesigns?.some(design=>design.id===source.designId))throw new ApiError(400,'CAD 派生文件来源不一致。');
   }else if(part.source?.kind==='visual_edit'){
    const source=part.source,row=await db.prepare("SELECT project_id,status,result FROM jobs WHERE id=? AND owner_id=? AND kind='visual_edit'").bind(source.jobId,uid).first<{project_id:string;status:string;result:string|null}>(),result=row?.result?JSON.parse(row.result):null;
    if(part.kind!=='asset'||row?.project_id!==p.id||row.status!=='attached'||result?.partId!==part.id||result.assetId!==part.assetId||result.assetSha256!==source.assetSha256||result.sourceAssetId!==source.parentAssetId||result.sourceSha256!==source.parentAssetSha256)throw new ApiError(400,'外观改形资产来源不一致。');
   }else if(part.source){
    if(part.kind!=='asset')throw new ApiError(400,'三维来源只能关联模型附件。');
    const row=await db.prepare("SELECT project_id,result FROM jobs WHERE id=? AND owner_id=? AND kind IN ('text','image','multiview')").bind(part.source.jobId,uid).first<{project_id:string;result:string}>(),source=row?.result?JSON.parse(row.result).asset:null;
    if(row?.project_id!==p.id||!source||source.id!==part.assetId||source.sha256!==part.source.assetSha256||source.summary?.sceneIndex!==part.source.sceneIndex||JSON.stringify(source.summary?.nodes.map((node:{nodeIndex:number})=>node.nodeIndex))!==JSON.stringify(part.source.nodeIndices))throw new ApiError(400,'三维来源记录与模型附件不一致。');
   }
  }
  for(const check of p.checks.filter(value=>value.provenance)){
   const source=check.provenance!,row=await db.prepare("SELECT project_id,status,request,result FROM jobs WHERE id=? AND owner_id=? AND kind='offline_slice'").bind(source.jobId,uid).first<{project_id:string;status:string;request:string;result:string|null}>(),stored=row?JSON.parse(row.request):null,result=row?.result?JSON.parse(row.result):null;
   if(!row||row.project_id!==p.id||row.status!=='offline_consistent'||stored?.manifestSha256!==source.manifestSha256||stored?.manifest?.part?.id!==source.partId||stored?.manifest?.projectInputHash!==check.inputHash||result?.summary?.artifactSha256!==source.artifactSha256||result?.summary?.physicalValidation!=='not_run'||result?.summary?.productionReady!==false)throw new ApiError(400,'切片证据无法回溯到已归档的一致性结果。');
  }
  if(existing){
   const old=oldSnapshot!;
   try{for(const prior of old.cadDesigns??[]){const next=p.cadDesigns?.find(design=>design.id===prior.id);if(next)assertCadTransition(prior,next);}}catch(e){throw new ApiError(409,e instanceof Error?e.message:'CAD 锁定条件冲突。');}
   for(const previous of old.parts){const next=p.parts.find(value=>value.id===previous.id);if(previous.source?.kind==='cad'&&next&&(next.source?.kind!=='cad'||next.source.designId!==previous.source.designId))throw new ApiError(409,'CAD 零件必须保留参数化来源；请通过重建更新。');if(previous.source&&next&&previous.assetId===next.assetId&&JSON.stringify(previous.source)!==JSON.stringify(next.source))throw new ApiError(409,'保留同一模型附件时不能移除或改写其来源记录。');if(previous.interfaceLocked&&previous.kind==='base'&&next&&(next.kind!=='base'||next.params.holeDiameter!==previous.params.holeDiameter))throw new ApiError(409,'中孔接口已锁定。请先解锁并保存一个版本，再修改接口尺寸。');}
  }
  const fingerprint=await engineeringFingerprint(p),checks=p.checks.map(check=>check.status==='not_run'?check:check.inputHash===fingerprint?{...check,revision:p.revision+1}:{...check,status:'stale' as const}),now=new Date().toISOString(),next={...p,checks,revision:p.revision+1,createdAt:existing?.created_at??now,updatedAt:now},json=JSON.stringify(next),insertRevision=db.prepare('INSERT INTO revisions(id,project_id,owner_id,number,body,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),p.id,uid,next.revision,json,now);
  try{await db.batch([insertRevision,existing?db.prepare('UPDATE projects SET title=?,revision=?,body=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?').bind(p.title,next.revision,json,now,p.id,uid,p.revision):db.prepare('INSERT INTO projects(id,owner_id,title,revision,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(p.id,uid,p.title,next.revision,json,now,now)]);}catch(e){if(String(e).includes('UNIQUE'))throw new ApiError(409,'版本冲突，请重新载入项目。');throw e;}
  return Response.json(next);
 }catch(e){return errorResponse(e);}
}
