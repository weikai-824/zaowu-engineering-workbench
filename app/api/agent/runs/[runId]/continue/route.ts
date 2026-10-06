import {z} from 'zod';
import {callAgentService} from '@/lib/agent-service';
import {ApiError,checkOrigin,errorResponse,owner} from '@/lib/server';

export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}){
 try{
  checkOrigin(request);
  const ownerId=await owner(),runId=z.string().uuid().parse((await params).runId);
  return Response.json(await callAgentService(ownerId,`/${runId}/continue`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check'})}));
 }catch(error){return errorResponse(error instanceof z.ZodError?new ApiError(400,'返工任务编号无效。'):error);}
}
