import {z} from 'zod';
import profiles from '@/data/processes.json';
import type {Project} from '@/lib/engineering';
import {processConfigurationSummary} from '@/lib/process-configuration';
import {privateParameterName,privateProcessSet} from '@/lib/private-process-library';
import {createLlmProvider} from '@/lib/llm-provider';
import {owner,runtime,errorResponse,ApiError,bodyJson,checkOrigin} from '@/lib/server';

const input=z.object({projectId:z.string().uuid()}).strict();
const output=z.object({profileId:z.string(),summary:z.string().min(1).max(600),reasons:z.array(z.string().min(1).max(350)).min(1).max(20),checks:z.array(z.string().min(1).max(250)).min(1).max(20)});

export async function POST(request:Request){
  try{
    checkOrigin(request);
    const parsed=input.safeParse(await bodyJson(request));
    if(!parsed.success)throw new ApiError(400,'项目编号无效。');
    const uid=await owner(),runtimeState=runtime();
    const row=await runtimeState.DB.prepare('SELECT body FROM projects WHERE id=? AND owner_id=?').bind(parsed.data.projectId,uid).first<{body:string}>();
    if(!row)throw new ApiError(404,'请先保存当前项目和参数集。');
    const project=JSON.parse(row.body) as Project;
    if(!runtimeState.AI_API_KEY||!runtimeState.AI_BASE_URL||!runtimeState.AI_MODEL)throw new ApiError(503,'AI 服务尚未配置。');
    const candidates=profiles.map(profile=>({id:profile.id,process:profile.process,machine:profile.machine,material:profile.material,privateSet:privateProcessSet(profile),privateParameters:profile.parameters.map(parameter=>({name:privateParameterName(parameter.name),value:parameter.value,unit:parameter.unit}))}));
    const provider=createLlmProvider({apiKey:runtimeState.AI_API_KEY,baseUrl:runtimeState.AI_BASE_URL,model:runtimeState.AI_MODEL,provider:runtimeState.AI_PROVIDER,bridgeUrl:runtimeState.TRIPO_PROXY_BRIDGE_URL});
    const completion=await provider.completeJson({system:'你是3D打印工程选型助手。只能依据输入中的项目需求、已保存的项目参数副本和当前工作区私有工艺库，在候选 profileId 中选一项并解释精度、强度、材料及设备匹配依据。不得把项目副本写成已经完成实机验证的生产参数，也不得声称切片、校准、试制或物理验收已完成。缺少证据要放入 checks。只输出 JSON：{"profileId":string,"summary":string,"reasons":string[],"checks":string[]}。',user:[{type:'text',text:JSON.stringify({project:{title:project.title,brief:project.brief,domain:project.domain,targetSizeMm:project.targetSize,quantity:project.quantity,preferredProcess:project.preferredProcess},currentConfiguration:project.processConfiguration??null,configurationSummary:processConfigurationSummary(project.processConfiguration),candidates})}],temperature:.1,maxTokens:1500});
    let result:z.infer<typeof output>;
    try{result=output.parse(JSON.parse(completion.content));}catch{throw new ApiError(502,'AI 匹配结果格式无效。');}
    if(!profiles.some(profile=>profile.id===result.profileId))throw new ApiError(502,'AI 返回了资料库以外的工艺组合。');
    return Response.json({...result,reasons:result.reasons.slice(0,6),checks:result.checks.slice(0,6),basis:'ai'});
  }catch(error){return errorResponse(error);}
}
