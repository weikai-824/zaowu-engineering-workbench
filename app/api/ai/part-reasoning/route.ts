import {owner,runtime,errorResponse,ApiError,bodyJson,checkOrigin} from '@/lib/server';
import {z} from 'zod';
import profiles from '@/data/processes.json';
import {engineeringFingerprint,partEngineeringRole,type Project} from '@/lib/engineering';
import {createLlmProvider} from '@/lib/llm-provider';
import {projectPartReasoning} from '@/lib/part-reasoning';

const input=z.object({projectId:z.string().uuid(),projectRevision:z.number().int().positive(),partId:z.string().uuid()}).strict();
const explanation=z.object({
 role:z.string().min(1).max(180),selectionReason:z.string().min(1).max(1500),
 tradeoffs:z.array(z.string().min(1).max(500)).max(5),
 evidence:z.array(z.string().min(1).max(500)).max(8),
 pendingChecks:z.array(z.string().min(1).max(500)).max(8),
 confidence:z.number().min(0).max(1),
}).strict();

export async function POST(request:Request){
 try{
  checkOrigin(request);const uid=await owner(),x=input.parse(await bodyJson(request)),rt=runtime();
  const row=await rt.DB.prepare('SELECT body FROM projects WHERE id=? AND owner_id=?').bind(x.projectId,uid).first<{body:string}>();if(!row)throw new ApiError(404,'项目不存在。');
  const project=JSON.parse(row.body) as Project;if(project.revision!==x.projectRevision)throw new ApiError(409,'项目版本已变化，请先保存或刷新。');
  const part=project.parts.find(value=>value.id===x.partId);if(!part)throw new ApiError(404,'零件不存在。');
  const prior=await rt.DB.prepare("SELECT request,result FROM jobs WHERE owner_id=? AND project_id=? AND base_revision=? AND kind='ai_part_reasoning' AND status='ready' ORDER BY created_at DESC LIMIT 50").bind(uid,project.id,project.revision).all<{request:string;result:string}>();
  const cached=prior.results.find(value=>{try{const previous=JSON.parse(value.request);return previous.partId===part.id&&previous.promptVersion==='part-reasoning-v2';}catch{return false;}});
  if(cached)return Response.json({...explanation.parse(JSON.parse(cached.result)),source:'ai',cached:true});
  if(!rt.AI_API_KEY||!rt.AI_BASE_URL||!rt.AI_MODEL)throw new ApiError(503,'AI 服务尚未配置。');
  const profile=profiles.find(value=>value.id===part.profileId),fingerprint=await engineeringFingerprint(project);
  const currentChecks=project.checks.filter(value=>(!value.partId||value.partId===part.id)&&value.status!=='stale'&&value.inputHash===fingerprint).map(value=>({name:value.name,status:value.status,detail:value.detail}));
  const baseline=projectPartReasoning(project,part);
  const facts={project:{title:project.title,brief:project.brief.slice(0,4000),domain:project.domain,targetSize:project.targetSize,quantity:project.quantity,connection:project.connection,preferredProcess:project.preferredProcess},part:{id:part.id,name:part.name,kind:part.kind,engineeringRole:partEngineeringRole(part),sourceKind:part.source?.kind??'manual',dimensions:part.dimensions??null,triangles:part.triangles??null,interfaceLocked:part.interfaceLocked,profile:profile?{id:profile.id,process:profile.process,machine:profile.machine,material:profile.material,verificationStatus:profile.verificationStatus}:null},currentChecks,knownFacts:baseline.evidence};
  const provider=createLlmProvider({apiKey:rt.AI_API_KEY,baseUrl:rt.AI_BASE_URL,model:rt.AI_MODEL,provider:rt.AI_PROVIDER,bridgeUrl:rt.TRIPO_PROXY_BRIDGE_URL});
  const system='你是3D打印工程方案解释助手。只根据输入事实，为指定零件写可供工程师审核的选件依据，不要伪称这是生成模型真实的内部思维链。用简洁中文回答，role 必须是人能读懂的中文功能名称，不可直接写 visual_reference 或 manufacturing。区分事实、工程推断和待验证事项。回答为什么该零件在方案中有独立身份、它与项目需求的关系、分件或保留的取舍。Tripo visual_reference 只能作为外观候选，不能说成可制造、已切片或已生产。不得编造功能、尺寸、材料、强度、检查结果、备选方案评审记录或已经完成的验证。没有足够证据时明确写为推断并降低 confidence。输出纯 JSON：{role:string,selectionReason:string,tradeoffs:string[],evidence:string[],pendingChecks:string[],confidence:number}。';
  let completion;try{completion=await provider.completeJson({system,user:JSON.stringify(facts),temperature:.2,maxTokens:1800});}catch(error){throw new ApiError(502,error instanceof Error?error.message:'AI 选件分析失败。');}
  let result;try{result=explanation.parse(JSON.parse(completion.content));}catch{throw new ApiError(502,'AI 选件分析格式无效，请重试。');}
  result={...result,evidence:[...baseline.evidence,...currentChecks.map(value=>`当前检查：${value.name} · ${value.status}`)].slice(0,8)};
  const now=new Date().toISOString();await rt.DB.prepare('INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),uid,project.id,project.revision,'ai_part_reasoning','ready',JSON.stringify({partId:part.id,inputHash:fingerprint,promptVersion:'part-reasoning-v2',model:provider.model,responseId:completion.id}),JSON.stringify(result),now,now).run();
  return Response.json({...result,source:'ai',model:completion.responseModel??provider.model,cached:false});
 }catch(error){return errorResponse(error);}
}
