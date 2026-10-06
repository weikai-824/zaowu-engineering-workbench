import {isJsonObject} from '@/lib/json-value';
import {createLlmProvider} from '@/lib/llm-provider';
import {ApiError,checkOrigin,errorResponse,owner,runtime} from '@/lib/server';

export async function POST(request:Request){
  try{
    checkOrigin(request);
    await owner();
    const environment=runtime();
    if(!environment.AI_API_KEY||!environment.AI_BASE_URL||!environment.AI_MODEL)throw new ApiError(503,'尚未配置通用 AI 接口、模型或服务端密钥。');
    let provider;
    try{provider=createLlmProvider({apiKey:environment.AI_API_KEY,baseUrl:environment.AI_BASE_URL,model:environment.AI_MODEL,provider:environment.AI_PROVIDER,bridgeUrl:environment.TRIPO_PROXY_BRIDGE_URL});}
    catch(error){throw new ApiError(503,error instanceof Error?error.message:'AI Provider 配置无效。');}
    const startedAt=Date.now();
    let completion;
    try{
      completion=await provider.completeJson({
        system:'你是连接诊断器。只返回 JSON 对象 {"ok":true}，不要输出解释或 Markdown。',
        user:'执行最小连接响应测试。',
        temperature:0,
        maxTokens:64,
      });
    }catch(error){throw new ApiError(502,error instanceof Error?error.message:'通用 AI 最小响应探测失败。');}
    let payload:unknown;
    try{payload=JSON.parse(completion.content);}catch{throw new ApiError(502,'通用 AI 已响应，但没有返回有效诊断 JSON。');}
    if(!isJsonObject(payload)||payload.ok!==true)throw new ApiError(502,'通用 AI 已响应，但诊断确认字段无效。');
    return Response.json({
      configured:true,
      provider:provider.id,
      model:provider.model,
      responseModel:completion.responseModel,
      latencyMs:Date.now()-startedAt,
      checkedAt:new Date().toISOString(),
    });
  }catch(error){return errorResponse(error);}
}
