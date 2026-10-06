import {z} from 'zod';
import {agentDecisionSchema,callAgentService} from '@/lib/agent-service';
import {ApiError,bodyJson,checkOrigin,errorResponse,owner} from '@/lib/server';

export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}){
 try{
  checkOrigin(request);
  const ownerId=await owner(),runId=z.string().uuid().parse((await params).runId),body=agentDecisionSchema.parse(await bodyJson(request,8_000));
  return Response.json(await callAgentService(ownerId,`/${runId}/decisions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 }catch(error){return errorResponse(error instanceof z.ZodError?new ApiError(400,'审批决定格式无效。'):error);}
}
