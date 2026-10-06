import {z} from 'zod';
import {callAgentService} from '@/lib/agent-service';
import {ApiError,errorResponse,owner} from '@/lib/server';

export async function GET(_request:Request,{params}:{params:Promise<{runId:string}>}){
 try{
  const ownerId=await owner(),runId=z.string().uuid().parse((await params).runId);
  return Response.json(await callAgentService(ownerId,`/${runId}`));
 }catch(error){return errorResponse(error instanceof z.ZodError?new ApiError(400,'返工任务编号无效。'):error);}
}
