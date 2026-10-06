import {owner,runtime,errorResponse,ApiError,bodyJson,checkOrigin} from '@/lib/server';
import {z} from 'zod';
import profiles from '@/data/processes.json';
import {planningContext,validateEvidenceReferences} from '@/lib/planning-context';
import type {Project} from '@/lib/engineering';
import {cadSchema,parseCad,changeCadParameters} from '@/lib/cad-spec';
import {designFeedbackSchema} from '@/lib/design-feedback';
import {createLlmProvider} from '@/lib/llm-provider';

const input=z.object({
 projectId:z.string().uuid(),instruction:z.string().min(1).max(8000),partId:z.string().uuid().optional(),
 imageAssetId:z.string().uuid().optional(),modelAssetId:z.string().uuid().optional(),designFeedback:designFeedbackSchema.optional(),
});
const output=z.object({
 evidenceIds:z.array(z.string().min(1).max(200)).max(30),summary:z.string().max(4000),questions:z.array(z.string()).max(20),
 proposedActions:z.array(z.object({action:z.enum(['change_base_dimensions','recommend_process','request_engineering_review','change_cad_parameters','create_cad_design']),partId:z.string().nullable(),designId:z.string().uuid().optional(),designSpec:cadSchema.optional(),parameters:z.record(z.union([z.number(),z.string(),z.boolean(),z.null()])),reason:z.string()})).max(30),
 requiredChecks:z.array(z.string()).max(30),riskFlags:z.array(z.string().max(500)).max(30),confidence:z.number().min(0).max(1),
});

const systemPrompt='你是3D打印工程规划助手。输入可能包含文字、参考图片、三维附件元数据、design-feedback-v1 单点定位，或 design-feedback-region-v1 圈选及带橙色圈线的三维视图截图。圈选路径为归一化屏幕坐标，截图仅代表提交时的可见视角；结合圈内可见外观与选中的零件提出具体、分步骤的修改建议，但不可推断背面、内部结构或看不到的尺寸。单点定位数据只用于指出零件、对象、三角面、坐标、法向和观察视角，不等于视觉理解或制造验证。三维附件元数据不能证明已读取网格细节。只生成建议，不能声称建模、切片、校准或物理验证已完成。change_cad_parameters 只能修改未锁定参数，create_cad_design 只能使用上下文中的 cad-plan-v1 白名单词汇；接口定义、锁定参数、关联特征及解析后的孔位/尺寸不能改变。如 project.processConfiguration 已设置，先读取 profileId 与 values，解释它们对建模尺寸、壁厚和工艺选择的影响；这些值是用户草稿，不能视为厂商认证或实机校准。只引用真实 partId、profileId 和 current=true 的 evidenceIds；过期检查不得作为当前事实。拓扑通过不表示无自交、壁厚合格或可制造。未知要求必须列入 questions 或 riskFlags。每个动作的 reason 应解释目标、约束与选择该动作的原因；无法自动执行的外观改动应作为 request_engineering_review 并说明人工工作。输出纯JSON对象，字段为 {evidenceIds:string[],summary:string,questions:string[],proposedActions:[{action:"change_base_dimensions"|"recommend_process"|"request_engineering_review"|"change_cad_parameters"|"create_cad_design",partId:string|null,designId?:string,designSpec?:object,parameters:object,reason:string}],requiredChecks:string[],riskFlags:string[],confidence:number}。';

export async function POST(request:Request){
 try{
  checkOrigin(request);
  const uid=await owner(),parsed=input.safeParse(await bodyJson(request));
  if(!parsed.success)throw new ApiError(400,'请填写工程改版要求。');
  const x=parsed.data,e=runtime();
  if(!e.AI_API_KEY||!e.AI_BASE_URL||!e.AI_MODEL)throw new ApiError(503,'尚未配置 AI 服务的接口地址、模型和服务端密钥。');
  const row=await e.DB.prepare('SELECT body FROM projects WHERE id=? AND owner_id=?').bind(x.projectId,uid).first<{body:string}>();
  if(!row)throw new ApiError(404,'请先保存项目。');
  const project=JSON.parse(row.body) as Project;
  if(x.partId&&!project.parts.some(part=>part.id===x.partId))throw new ApiError(400,'所选零件不存在。');
  if(x.designFeedback&&(x.designFeedback.projectId!==project.id||x.designFeedback.projectRevision!==project.revision||x.designFeedback.partId!==x.partId))throw new ApiError(400,'三维定位反馈与当前项目、版本或所选零件不一致。');
  if(x.designFeedback?.schema==='design-feedback-region-v1'&&x.designFeedback.annotationImageAssetId===x.imageAssetId)throw new ApiError(400,'圈选视图与参考图需要分别上传。');
  const modelPart=x.modelAssetId?project.parts.find(part=>part.assetId===x.modelAssetId):undefined;
  if(x.modelAssetId&&!modelPart)throw new ApiError(400,'三维附件必须属于当前项目的零件。');
  const modelAsset=x.modelAssetId?await e.DB.prepare('SELECT filename,content_type,size FROM assets WHERE id=? AND owner_id=?').bind(x.modelAssetId,uid).first<{filename:string;content_type:string;size:number}>():null;
  if(x.modelAssetId&&!modelAsset)throw new ApiError(400,'三维附件不存在或无权访问。');
  const context=await planningContext(project,x.partId);
  const content:Array<{type:'text';text:string}|{type:'image_url';image_url:{url:string}}>=[{type:'text',text:JSON.stringify({
   instruction:x.instruction,selectedPart:x.partId,designFeedback:x.designFeedback??null,
   modelInput:modelPart&&modelAsset?{assetId:x.modelAssetId,filename:modelAsset.filename,contentType:modelAsset.content_type,bytes:modelAsset.size,part:{id:modelPart.id,name:modelPart.name,kind:modelPart.kind,dimensions:modelPart.dimensions??null,triangles:modelPart.triangles??null,position:modelPart.position,source:modelPart.source??null,profileId:modelPart.profileId??null,interfaceLocked:modelPart.interfaceLocked}}:null,
   ...context,
   cadVocabulary:{schema:'cad-plan-v1',units:'mm',fields:'id(UUID),name,parameters:{key:{label,value,min,max,locked}},parts:[{id(UUID),name,color(hex),placement:[scalar,scalar,scalar],features:[],result:featureId}],interfaces:[]',scalar:'number or {param:key,scale?:number,offset?:number}',features:['{id,op:box,size:vec3,origin:vec3}','{id,op:cylinder,radius:scalar,height:scalar,origin:vec3,axis:X|Y|Z}','{id,op:sphere,radius:scalar,origin:vec3}','{id,op:profile_extrude,plane:XY|XZ|YZ,points:[[scalar,scalar],...],depth:scalar,origin:vec3}','{id,op:union|subtract|intersect,left:priorFeatureId,right:priorFeatureId}','{id,op:fillet_all,input:priorFeatureId,radius:scalar}','{id,op:fillet_edges,input:priorFeatureId,radius:scalar,axis:X|Y|Z}'],interface:'{id,partId,featureId:Z-cylinder-tool,kind:straight_bore_z,center:[scalar,scalar],zStart:scalar,length:scalar,radius:scalar,locked:boolean}'},
   referenceProfiles:profiles.map(value=>({id:value.id,process:value.process,machine:value.machine,material:value.material,productionReady:false})),
  })}];
  if(x.imageAssetId){
   const asset=await e.DB.prepare('SELECT object_key,content_type,size FROM assets WHERE id=? AND owner_id=?').bind(x.imageAssetId,uid).first<{object_key:string;content_type:string;size:number}>();
   if(!asset||!['image/jpeg','image/png','image/webp'].includes(asset.content_type)||asset.size>8*1024*1024)throw new ApiError(400,'参考图不可用。');
   const object=await e.BUCKET.get(asset.object_key);if(!object)throw new ApiError(404,'参考图不存在。');
   const bytes=new Uint8Array(await object.arrayBuffer());let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));
   content.push({type:'image_url',image_url:{url:'data:'+asset.content_type+';base64,'+btoa(binary)}});
  }
  if(x.designFeedback?.schema==='design-feedback-region-v1'){
   const asset=await e.DB.prepare('SELECT object_key,content_type,size FROM assets WHERE id=? AND owner_id=?').bind(x.designFeedback.annotationImageAssetId,uid).first<{object_key:string;content_type:string;size:number}>();
   if(!asset||asset.content_type!=='image/jpeg'||asset.size>2*1024*1024)throw new ApiError(400,'圈选视图不可用，请重新圈选。');
   const object=await e.BUCKET.get(asset.object_key);if(!object)throw new ApiError(404,'圈选视图不存在。');
   const bytes=new Uint8Array(await object.arrayBuffer());let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));
   content.push({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+btoa(binary)}});
  }
  let provider;try{provider=createLlmProvider({apiKey:e.AI_API_KEY,baseUrl:e.AI_BASE_URL,model:(x.imageAssetId||x.designFeedback?.schema==='design-feedback-region-v1')&&e.AI_VISION_MODEL?e.AI_VISION_MODEL:e.AI_MODEL,provider:e.AI_PROVIDER,bridgeUrl:e.TRIPO_PROXY_BRIDGE_URL});}catch(error){throw new ApiError(503,error instanceof Error?error.message:'AI Provider 配置无效。');}
  const startedAt=Date.now();let completion;
  try{completion=await provider.completeJson({system:systemPrompt,user:content,temperature:.2,maxTokens:7000});}catch(error){throw new ApiError(502,error instanceof Error?error.message:'AI Provider 调用失败。');}
  let plan;try{plan=output.parse(JSON.parse(completion.content));}catch(error){throw new ApiError(502,'AI 返回未通过工程指令格式检查，没有修改项目：'+(error instanceof Error?error.message:'未知格式错误'));}
  for(const action of plan.proposedActions){
   if(action.action==='change_cad_parameters'){
    const design=project.cadDesigns?.find(value=>value.id===action.designId);if(!design)throw new ApiError(502,'AI 引用了不存在的 CAD 设计。');
    try{changeCadParameters(design,action.parameters);}catch(error){throw new ApiError(502,error instanceof Error?error.message:'CAD 改版无效。');}
   }
   if(action.action==='create_cad_design'){
    try{const design=parseCad(action.designSpec);if(project.cadDesigns?.some(value=>value.id===design.id)||design.parts.some(value=>project.parts.some(part=>part.id===value.id)))throw Error('CAD 编号冲突。');}catch(error){throw new ApiError(502,error instanceof Error?error.message:'AI 新设计无效。');}
   }
   if(action.partId&&!project.parts.some(part=>part.id===action.partId))throw new ApiError(502,'AI 引用了不存在的零件，建议已拒绝。');
   if(action.action==='change_base_dimensions'){
    const part=project.parts.find(value=>value.id===action.partId);if(part?.kind!=='base'||Object.keys(action.parameters).some(key=>!['diameter','height'].includes(key)))throw new ApiError(502,'AI 提议了未开放或受锁定保护的参数修改。');
   }
  }
  let evidenceUsed;try{evidenceUsed=validateEvidenceReferences(plan.evidenceIds,context);}catch(error){throw new ApiError(502,error instanceof Error?error.message:'AI 检查引用无效。');}
  const now=new Date().toISOString(),aiJob={provider:provider.id,model:provider.model,responseModel:completion.responseModel,responseId:completion.id,usage:completion.usage,validation:{status:'passed',schema:'ai-plan-v1'},latencyMs:Date.now()-startedAt};
  const storedPlan={...plan,evidenceUsed:evidenceUsed.map(value=>({id:value.id,name:value.name,partId:value.partId,geometryHash:value.geometryHash,algorithm:value.algorithm,measuredAtRevision:value.measuredAtRevision})),aiJob},id=crypto.randomUUID();
  await e.DB.prepare('INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,uid,project.id,project.revision,'ai_plan','suggestion_ready',JSON.stringify({...x,inputHash:context.inputHash,evidenceSnapshot:evidenceUsed,aiJob:{provider:aiJob.provider,model:aiJob.model,responseModel:aiJob.responseModel,responseId:aiJob.responseId,usage:aiJob.usage}}),JSON.stringify(storedPlan),now,now).run();
  return Response.json({...storedPlan,jobId:id,baseRevision:project.revision,state:'suggestion_only'});
 }catch(error){return errorResponse(error);}
}
