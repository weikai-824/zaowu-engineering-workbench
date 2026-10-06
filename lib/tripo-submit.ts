import {z} from 'zod';
import {ApiError} from './errors';
import {tripoOrigin,tripoRegion,readLimited,tripoFetcher} from './tripo-provider';
import {recoveryDto,type RecoveryRuntime,type TripoJob} from './tripo-recovery';
import profiles from '@/data/processes.json';
import {validateProcessConfiguration,type ProcessConfiguration} from './process-configuration';

export const tripoModelVersions=['v3.1-20260211','v3.0-20250812','v2.5-20250123','P1-20260311','P2-20260801'] as const;
export const tripoTextureQualities=['standard','detailed','extreme'] as const;
export const tripoGeometryQualities=['standard','detailed'] as const;
export const tripoTextureAlignments=['original_image','geometry'] as const;
export const tripoExportOrientations=['+x','-x','-y','+y'] as const;
export const tripoImageModels=['seedream_v5','seedream_v4','banana','banana_pro','banana2','chat_image_1','chat_image_1.5','chat_image_2'] as const;
export const manufacturing=z.object({
  productionVolume:z.number().int().min(1).max(10_000_000).optional(),
  targetProcess:z.string().max(40).optional(),targetProfileId:z.string().max(120).optional(),targetMachine:z.string().max(100).optional(),targetMaterial:z.string().max(100).optional(),
  partStrategy:z.enum(['single','split','auto']).optional(),assembly:z.enum(['one_piece','screw','glue','snap_fit','magnet']).optional(),
  colorCount:z.number().int().min(1).max(64).optional(),toleranceMm:z.number().positive().max(20).optional(),needsBase:z.boolean().optional(),needsEnclosure:z.boolean().optional(),needsManufacturingDrawing:z.boolean().optional(),notes:z.string().max(1000).optional(),
}).strict();
const multiviewAsset=z.object({assetId:z.string().uuid(),view:z.enum(['front','back','left','right'])}).strict();
export const generationInput=z.object({
  clientRequestId:z.string().uuid(),projectId:z.string().uuid(),projectRevision:z.number().int().positive(),kind:z.enum(['text','image','multiview','model','concept_image']),operation:z.enum(['generate','import']).default('generate'),
  prompt:z.string().max(1024).optional(),variantIndex:z.number().int().min(1).max(6).optional(),negativePrompt:z.string().max(255).optional(),imageAssetId:z.string().uuid().optional(),multiviewAssets:z.array(multiviewAsset).min(2).max(4).optional(),modelAssetId:z.string().uuid().optional(),
  modelVersion:z.enum(tripoModelVersions).default('v3.1-20260211'),imageModel:z.enum(tripoImageModels).default('seedream_v4'),imageSize:z.string().regex(/^(?:[1-4]K|\d{3,5}x\d{3,5})$/).default('2K'),outputFormat:z.enum(['png','jpeg','webp']).default('png'),watermark:z.boolean().default(false),faceLimit:z.number().int().min(48).max(1_500_000).optional(),texture:z.boolean().default(true),pbr:z.boolean().default(true),textureQuality:z.enum(tripoTextureQualities).default('standard'),textureAlignment:z.enum(tripoTextureAlignments).default('original_image'),geometryQuality:z.enum(tripoGeometryQualities).optional(),exportUv:z.boolean().default(true),autoSize:z.boolean().default(false),modelSeed:z.number().int().min(0).max(2_147_483_647).optional(),imageSeed:z.number().int().min(0).max(2_147_483_647).optional(),textureSeed:z.number().int().min(0).max(2_147_483_647).optional(),enableImageAutofix:z.boolean().default(false),orientation:z.enum(['default','align_image']).default('default'),exportOrientation:z.enum(tripoExportOrientations).optional(),smartLowPoly:z.boolean().default(false),generateParts:z.boolean().default(false),quad:z.boolean().default(false),manufacturing:manufacturing.optional(),
}).strict().superRefine((x,ctx)=>{
  if(x.kind==='text'&&x.operation!=='generate')ctx.addIssue({code:z.ZodIssueCode.custom,path:['operation'],message:'文字输入只能使用生成操作。'});
  if(x.kind==='image'&&x.operation!=='generate')ctx.addIssue({code:z.ZodIssueCode.custom,path:['operation'],message:'图片输入只能使用生成操作。'});
  if(x.kind==='multiview'&&x.operation!=='generate')ctx.addIssue({code:z.ZodIssueCode.custom,path:['operation'],message:'多视图输入只能使用生成操作。'});
  if(x.kind==='concept_image'&&x.operation!=='generate')ctx.addIssue({code:z.ZodIssueCode.custom,path:['operation'],message:'设定图只能使用生成操作。'});
  if(x.kind==='model'&&x.operation!=='import')ctx.addIssue({code:z.ZodIssueCode.custom,path:['operation'],message:'三维文件当前使用导入操作。'});
  if(x.kind==='text'&&!x.prompt?.trim())ctx.addIssue({code:z.ZodIssueCode.custom,path:['prompt'],message:'请填写生成描述。'});
  if(x.kind==='concept_image'&&!x.prompt?.trim())ctx.addIssue({code:z.ZodIssueCode.custom,path:['prompt'],message:'请填写设定图描述。'});
  if(x.kind==='image'&&!x.imageAssetId)ctx.addIssue({code:z.ZodIssueCode.custom,path:['imageAssetId'],message:'图片生成缺少参考图。'});
  if(x.kind==='multiview'&&(!x.multiviewAssets||new Set(x.multiviewAssets.map(v=>v.view)).size!==x.multiviewAssets.length||!x.multiviewAssets.some(v=>v.view==='front')))ctx.addIssue({code:z.ZodIssueCode.custom,path:['multiviewAssets'],message:'多视图生成需要 2–4 张且必须包含唯一的正面 front 视角。'});
  if(x.kind==='model'&&!x.modelAssetId)ctx.addIssue({code:z.ZodIssueCode.custom,path:['modelAssetId'],message:'模型导入缺少三维文件。'});
  if(x.manufacturing?.targetProfileId&&!profiles.some(v=>v.id===x.manufacturing?.targetProfileId))ctx.addIssue({code:z.ZodIssueCode.custom,path:['manufacturing','targetProfileId'],message:'目标工艺配置不存在，请从工艺资料库选择。'});
  if(x.imageSeed!==undefined&&x.kind!=='text')ctx.addIssue({code:z.ZodIssueCode.custom,path:['imageSeed'],message:'文本图像种子仅适用于文字生成。'});
  if(x.pbr&&!x.texture)ctx.addIssue({code:z.ZodIssueCode.custom,path:['texture'],message:'Tripo 开启 PBR 时必须同时开启纹理。'});
  if(x.generateParts&&(x.texture||x.pbr||x.quad||x.smartLowPoly))ctx.addIssue({code:z.ZodIssueCode.custom,path:['generateParts'],message:'分件输出不能同时开启纹理、PBR、四边形网格或低面数拓扑。'});
  if(x.quad&&x.modelVersion==='P1-20260311')ctx.addIssue({code:z.ZodIssueCode.custom,path:['quad'],message:'P1 不支持四边形网格，请选择 v3.x 或 P2。'});
  if((x.modelVersion==='P1-20260311'||x.modelVersion==='P2-20260801'||x.modelVersion==='v2.5-20250123')&&(x.smartLowPoly||x.generateParts||x.quad&&x.modelVersion!=='P2-20260801'))ctx.addIssue({code:z.ZodIssueCode.custom,path:['modelVersion'],message:'当前模型版本不支持所选高级拓扑参数。'});
  if(x.geometryQuality&&(x.modelVersion==='P1-20260311'||x.modelVersion==='P2-20260801'||x.modelVersion==='v2.5-20250123'))ctx.addIssue({code:z.ZodIssueCode.custom,path:['geometryQuality'],message:'P 系列和 v2.5 不支持几何质量参数，请使用 v3.x。'});
  if(x.autoSize&&x.modelVersion==='v2.5-20250123')ctx.addIssue({code:z.ZodIssueCode.custom,path:['autoSize'],message:'自动真实尺寸需要 v3.x 或 P 系列。'});
  if(x.faceLimit!==undefined&&x.modelVersion==='P1-20260311'&&(x.faceLimit<50||x.faceLimit>20_000))ctx.addIssue({code:z.ZodIssueCode.custom,path:['faceLimit'],message:'P1 面数上限必须在 50–20,000。'});
  if(x.faceLimit!==undefined&&x.modelVersion==='P2-20260801'&&(x.faceLimit<48||x.faceLimit>(x.quad?25_000:50_000)))ctx.addIssue({code:z.ZodIssueCode.custom,path:['faceLimit'],message:x.quad?'P2 四边形网格面数必须在 48–25,000。':'P2 三角网格面数必须在 48–50,000。'});
});
export type Input=z.infer<typeof generationInput>;
type StoredAsset={object_key:string;content_type:string;filename:string;size:number};
function clean(value:string|undefined,max:number){return value?.trim().slice(0,max)??'';}
type ProviderResponse={code?:number;data?:{presigned_url?:unknown;file_token?:unknown;task_id?:unknown}};
function parseProviderResponse(text:string):ProviderResponse{try{const value:unknown=JSON.parse(text);if(!value||typeof value!=='object')return{};const record=value as Record<string,unknown>,data=record.data&&typeof record.data==='object'?record.data as Record<string,unknown>:undefined;return{code:typeof record.code==='number'?record.code:undefined,data:data?{presigned_url:data.presigned_url,file_token:data.file_token,task_id:data.task_id}:undefined};}catch{return{};}}
export type TripoEngineeringConstraints={
 schema:'tripo-engineering-constraints-v1';
 project:{title?:string;domain?:string;targetSizeMm?:number;quantity?:number;connection?:string;preferredProcess?:string;processConfiguration?:ProcessConfiguration};
 generation:{productionVolume?:number;targetProcess?:string;targetProfileId?:string;targetMachine?:string;targetMaterial?:string;partStrategy?:'single'|'split'|'auto';assembly?:'one_piece'|'screw'|'glue'|'snap_fit'|'magnet';colorCount?:number;toleranceMm?:number;needsBase?:boolean;needsEnclosure?:boolean;needsManufacturingDrawing?:boolean;notes?:string};
};

function projectEngineeringFields(projectBody?:string):TripoEngineeringConstraints['project']{
 let project:{title?:unknown;domain?:unknown;targetSize?:unknown;quantity?:unknown;connection?:unknown;preferredProcess?:unknown;processConfiguration?:unknown}={};
 try{const parsed=JSON.parse(projectBody??'{}');if(parsed&&typeof parsed==='object')project=parsed;}catch{/* malformed project text cannot become provider prompt or constraints */}
 const configuration=project.processConfiguration as ProcessConfiguration|undefined;
 return{title:typeof project.title==='string'?project.title:undefined,domain:typeof project.domain==='string'?project.domain:undefined,targetSizeMm:typeof project.targetSize==='number'?project.targetSize:undefined,quantity:typeof project.quantity==='number'?project.quantity:undefined,connection:typeof project.connection==='string'?project.connection:undefined,preferredProcess:typeof project.preferredProcess==='string'?project.preferredProcess:undefined,processConfiguration:configuration&&typeof configuration==='object'&&typeof configuration.profileId==='string'&&configuration.values&&typeof configuration.values==='object'&&!validateProcessConfiguration(configuration)?configuration:undefined};
}

/**
 * The only prompt sent for generation. Structured manufacturing values are
 * deliberately not interpolated here; they remain auditable metadata.
 */
export function visualGenerationPrompt(x:Input){return clean(x.prompt,1024);}

/** Keeps engineering intent complete and structured beside the provider request. */
export function engineeringConstraints(x:Input,projectBody?:string):TripoEngineeringConstraints{
 return{schema:'tripo-engineering-constraints-v1',project:projectEngineeringFields(projectBody),generation:{...(x.manufacturing??{})}};
}
function identity(x:Input){return JSON.stringify({projectId:x.projectId,projectRevision:x.projectRevision,kind:x.kind,operation:x.operation,variantIndex:x.variantIndex??null,prompt:x.kind==='text'||x.kind==='image'||x.kind==='multiview'||x.kind==='concept_image'?clean(x.prompt,1024):'',imageAssetId:x.imageAssetId??null,multiviewAssets:x.multiviewAssets??null,modelAssetId:x.modelAssetId??null,modelVersion:x.modelVersion,imageModel:x.imageModel,imageSize:x.imageSize,outputFormat:x.outputFormat,watermark:x.watermark,faceLimit:x.faceLimit??null,texture:x.texture,pbr:x.pbr,textureQuality:x.textureQuality,textureAlignment:x.textureAlignment,geometryQuality:x.geometryQuality??null,exportUv:x.exportUv,autoSize:x.autoSize,modelSeed:x.modelSeed??null,imageSeed:x.imageSeed??null,textureSeed:x.textureSeed??null,enableImageAutofix:x.enableImageAutofix,orientation:x.orientation,exportOrientation:x.exportOrientation??null,smartLowPoly:x.smartLowPoly,generateParts:x.generateParts,quad:x.quad,manufacturing:x.manufacturing??null});}
export type TripoPayloadContext={inputToken?:string;inputs?:Record<string,string>[]};
export function buildTripoPayload(x:Input,context:TripoPayloadContext={}):{endpoint:string;payload:Record<string,unknown>}{
 const prompt=visualGenerationPrompt(x);
 if(x.kind==='concept_image')return{endpoint:'/generation/text-to-image',payload:{prompt,model:x.imageModel,size:x.imageSize,output_format:x.outputFormat,watermark:x.watermark}};
 if(x.kind==='model')return{endpoint:'/models/import',payload:{input:context.inputToken??''}};
 const payload:Record<string,unknown>={model:x.modelVersion,texture:x.texture,pbr:x.pbr,export_uv:x.exportUv};
 if(x.modelVersion!=='v2.5-20250123')payload.texture_quality=x.textureQuality;
 if(x.modelVersion!=='v2.5-20250123'&&(x.autoSize||x.kind==='text'))payload.auto_size=x.autoSize;
 if(x.faceLimit!==undefined)payload.face_limit=x.faceLimit;
 if(x.geometryQuality&&x.modelVersion!=='P1-20260311'&&x.modelVersion!=='P2-20260801'&&x.modelVersion!=='v2.5-20250123')payload.geometry_quality=x.geometryQuality;
 if(x.modelSeed!==undefined)payload.model_seed=x.modelSeed;
 if(x.kind==='text'&&x.imageSeed!==undefined)payload.image_seed=x.imageSeed;
 if(x.textureSeed!==undefined)payload.texture_seed=x.textureSeed;
 if(x.negativePrompt)payload.negative_prompt=clean(x.negativePrompt,255);
 if(x.smartLowPoly)payload.smart_low_poly=true;
 if(x.generateParts)payload.generate_parts=true;
 if(x.quad)payload.quad=true;
 if(x.exportOrientation)payload.export_orientation=x.exportOrientation;
 if(x.kind==='text')payload.prompt=prompt;
 else if(x.kind==='image'){payload.input=context.inputToken??'';if(x.enableImageAutofix)payload.enable_image_autofix=true;payload.texture_alignment=x.textureAlignment;payload.orientation=x.orientation;}
 else{payload.inputs=context.inputs??[];payload.texture_alignment=x.textureAlignment;payload.orientation=x.orientation;}
 return{endpoint:x.kind==='text'?'/generation/text-to-model':x.kind==='image'?'/generation/image-to-model':'/generation/multiview-to-model',payload};
}
async function uploadToTripo(rt:RecoveryRuntime,asset:{object_key:string;content_type:string;filename:string;size:number},origin:string,authorization:string,fetcher:typeof fetch){
  if(asset.size>150*1024*1024)throw new ApiError(413,'三维文件超过 Tripo 150 MB 上限。');const stored=await rt.BUCKET.get(asset.object_key);if(!stored)throw new ApiError(404,'三维文件内容不存在。');const image=asset.content_type.startsWith('image/');const limit=image?20*1024*1024:150*1024*1024;if(typeof stored.size==='number'&&stored.size>limit)throw new ApiError(413,image?'参考图超过 Tripo 20 MB 上限。':'三维文件超过 Tripo 150 MB 上限。');const bytes=await stored.arrayBuffer();if(bytes.byteLength>limit)throw new ApiError(413,image?'参考图超过 Tripo 20 MB 上限。':'三维文件超过 Tripo 150 MB 上限。');const form=new FormData();form.set('file',new Blob([bytes],{type:asset.content_type||'application/octet-stream'}),asset.filename);
  const extension=asset.filename.split('.').pop()?.toLowerCase()??'';
  const usePresigned=!image&&(asset.size>60*1024*1024||bytes.byteLength>60*1024*1024||extension==='3mf');
  if(usePresigned){
    const presign=await fetcher(origin+'/files/presign',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify({format:extension}),signal:AbortSignal.timeout(30_000)}),presignData=parseProviderResponse(new TextDecoder().decode(await readLimited(presign,1024*1024))),uploadUrl=presignData.data?.presigned_url,token=presignData.data?.file_token;if(!presign.ok||presignData.code!==0||typeof uploadUrl!=='string'||typeof token!=='string')throw new ApiError(502,'Tripo 大文件上传凭据获取失败，请保留本地文件后重试。');const uploaded=await fetcher(uploadUrl,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},redirect:'error',body:bytes,signal:AbortSignal.timeout(90_000)});if(!uploaded.ok)throw new ApiError(502,'Tripo 大文件直传失败，请保留本地文件后重试。');return token;
  }
  const response=await fetcher(origin+'/files',{method:'POST',headers:{Authorization:authorization},redirect:'error',body:form,signal:AbortSignal.timeout(90_000)}),data=parseProviderResponse(new TextDecoder().decode(await readLimited(response,1024*1024))),fileToken=data.data?.file_token;if(!response.ok||data.code!==0||typeof fileToken!=='string')throw new ApiError(502,'Tripo 文件上传失败，请保留本地文件后重试。');return fileToken;
}
export async function submitTripoJob(rt:RecoveryRuntime,uid:string,x:Input,fetcher:typeof fetch=tripoFetcher(rt.TRIPO_PROXY_URL,rt.TRIPO_PROXY_BRIDGE_URL)){
 const parsed=generationInput.safeParse(x);if(!parsed.success)throw new ApiError(400,parsed.error.issues[0]?.message??'Tripo 请求参数无效。');x=parsed.data;const existing=await rt.DB.prepare('SELECT * FROM jobs WHERE id=? AND owner_id=?').bind(x.clientRequestId,uid).first<TripoJob>();const prior=(job:TripoJob)=>{let old:Input;try{old=JSON.parse(job.request);}catch{throw new ApiError(409,'提交编号已有不兼容记录。');}if(identity(old)!==identity(x))throw new ApiError(409,'同一提交编号不能用于不同的生成要求。');return{...recoveryDto(job),reused:true};};
 if(existing)return prior(existing);if(!rt.TRIPO_API_KEY)throw new ApiError(503,'Tripo 尚未连接。');const region=tripoRegion(rt.TRIPO_REGION),origin=tripoOrigin(region),project=await rt.DB.prepare('SELECT revision,body FROM projects WHERE id=? AND owner_id=?').bind(x.projectId,uid).first<{revision:number;body:string}>();
 if(!project)throw new ApiError(404,'请先保存项目。');if(project.revision!==x.projectRevision)throw new ApiError(409,'项目版本已改变，请重新载入再生成。');let asset:StoredAsset|undefined,multiAssets:StoredAsset[]=[];if(x.kind==='image')asset=await rt.DB.prepare('SELECT object_key,content_type,filename,size FROM assets WHERE id=? AND owner_id=?').bind(x.imageAssetId??'',uid).first<StoredAsset>()??undefined;if(x.kind==='model')asset=await rt.DB.prepare('SELECT object_key,content_type,filename,size FROM assets WHERE id=? AND owner_id=?').bind(x.modelAssetId??'',uid).first<StoredAsset>()??undefined;if(x.kind==='multiview'){const rows=await Promise.all((x.multiviewAssets??[]).map(v=>rt.DB.prepare('SELECT object_key,content_type,filename,size FROM assets WHERE id=? AND owner_id=?').bind(v.assetId,uid).first<StoredAsset>()));if(rows.some(v=>!v||!/^image\/(?:jpeg|png|webp)$/.test(v.content_type)||v.size>20*1024*1024))throw new ApiError(400,'多视图参考图必须是每张不超过 20 MB 的 PNG/JPEG/WebP。');multiAssets=rows as StoredAsset[];}
 if(x.kind==='image'&&(!asset||!/^image\/(?:jpeg|png|webp)$/.test(asset.content_type)||asset.size>20*1024*1024))throw new ApiError(400,'请上传不超过 20 MB 的 PNG/JPEG/WebP 参考图。');if(x.kind==='model'&&(!asset||!/(?:glb|gltf|fbx|obj|stl|3mf)$/i.test(asset.filename)||asset.size>150*1024*1024))throw new ApiError(400,'请上传不超过 150 MB 的 GLB/GLTF/FBX/OBJ/STL/3MF 模型。');
 const visualPrompt=visualGenerationPrompt(x),constraints=engineeringConstraints(x,project.body),id=x.clientRequestId,now=new Date().toISOString(),request=JSON.stringify({...x,apiRegion:region,providerModel:x.modelVersion,visualPrompt,engineeringConstraints:constraints,submittedPrompt:visualPrompt});const created=await rt.DB.prepare("INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,created_at,updated_at) VALUES(?,?,?,?,?,'preparing',?,?,?) ON CONFLICT(id) DO NOTHING").bind(id,uid,x.projectId,project.revision,x.kind,request,now,now).run();if(created.meta.changes!==1){const same=await rt.DB.prepare('SELECT * FROM jobs WHERE id=? AND owner_id=?').bind(id,uid).first<TripoJob>();if(!same)throw new ApiError(409,'提交编号不可用。');return prior(same);}
 const setStatus=async(status:string,taskId:string|null=null)=>{if(taskId){try{await rt.BUCKET.put(`${uid}/tripo-receipts/${id}.json`,JSON.stringify({jobId:id,taskId,apiRegion:region,receivedAt:new Date().toISOString()}),{httpMetadata:{contentType:'application/json'}});}catch{/* D1 remains authoritative; never regenerate because receipt storage failed. */}}try{await rt.DB.prepare('UPDATE jobs SET status=?,provider_task_id=?,updated_at=? WHERE id=? AND owner_id=? AND status=? AND provider_task_id IS NULL').bind(status,taskId,new Date().toISOString(),id,uid,status==='preparation_failed'?'preparing':'submitting').run();}catch{if(taskId)return{id,status:'submission_unknown',projectId:x.projectId,baseRevision:x.projectRevision,providerTaskId:taskId,reused:false,message:'供应商已返回编号，但本地状态保存失败。请保留编号并查询原任务；不要另起方案。'};throw new ApiError(503,'任务状态暂时无法保存，请使用原提交编号重试。');}const current=await rt.DB.prepare('SELECT * FROM jobs WHERE id=? AND owner_id=?').bind(id,uid).first<TripoJob>();if(!current)throw new ApiError(500,'任务记录暂时不可读，请使用原提交编号重试。');return{...recoveryDto(current),reused:false};};
 const authorization='Bearer '+rt.TRIPO_API_KEY;let payload:Record<string,unknown>,endpoint:string;if(x.kind==='concept_image'){({endpoint,payload}=buildTripoPayload(x));}else if(x.kind==='model'){let token:string;try{token=await uploadToTripo(rt,asset!,origin,authorization,fetcher);}catch{return setStatus('preparation_failed');}({endpoint,payload}=buildTripoPayload(x,{inputToken:token}));}else{const context:TripoPayloadContext={};if(x.kind==='image'){try{context.inputToken=await uploadToTripo(rt,asset!,origin,authorization,fetcher);}catch{return setStatus('preparation_failed');}}else if(x.kind==='multiview'){const inputs:Record<string,string>[]=[];try{for(let i=0;i<multiAssets.length;i++){const token=await uploadToTripo(rt,multiAssets[i],origin,authorization,fetcher);inputs.push({[x.multiviewAssets![i].view]:token});}}catch{return setStatus('preparation_failed');}context.inputs=inputs;}({endpoint,payload}=buildTripoPayload(x,context));}
 const preparing=await rt.DB.prepare("UPDATE jobs SET status='submitting',updated_at=? WHERE id=? AND owner_id=? AND status='preparing'").bind(new Date().toISOString(),id,uid).run();if(preparing.meta.changes!==1)throw new ApiError(409,'提交状态已改变，未发起新的供应商请求。');let response:Response;try{response=await fetcher(origin+endpoint,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify(payload),signal:AbortSignal.timeout(60_000)});}catch{return setStatus('submission_unknown');}const data=parseProviderResponse(new TextDecoder().decode(await readLimited(response,1024*1024))),taskId=data.data?.task_id,validTaskId=typeof taskId==='string'&&taskId.length>0&&taskId.length<=256;if(response.ok&&data.code===0&&validTaskId)return setStatus('queued',taskId);const knownRejected=response.status<500&&data.code!==undefined&&data.code!==0&&!validTaskId;return setStatus(knownRejected?'failed':'submission_unknown');
}
