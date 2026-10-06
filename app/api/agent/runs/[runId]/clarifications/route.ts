import {z} from 'zod';
import {agentClarificationSchema,callAgentService} from '@/lib/agent-service';
import {ApiError,bodyJson,checkOrigin,errorResponse,owner} from '@/lib/server';

export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}){
 try{
  checkOrigin(request);
  const ownerId=await owner(),runId=z.string().uuid().parse((await params).runId),body=agentClarificationSchema.parse(await bodyJson(request,96_000));
  return Response.json(await callAgentService(ownerId,`/${runId}/clarifications`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 }catch(error){return errorResponse(error instanceof z.ZodError?new ApiError(400,'澄清回答格式无效。'):error);}
}
