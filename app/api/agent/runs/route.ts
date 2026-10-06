import {z} from 'zod';
import {callAgentService,createAgentRunSchema} from '@/lib/agent-service';
import {ApiError,bodyJson,checkOrigin,errorResponse,owner} from '@/lib/server';

export async function POST(request:Request){
 try{
  checkOrigin(request);
  const ownerId=await owner(),body=createAgentRunSchema.parse(await bodyJson(request,3*1024*1024));
  return Response.json(await callAgentService(ownerId,'',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{status:202});
 }catch(error){return errorResponse(error instanceof z.ZodError?new ApiError(400,'返工任务参数无效。'):error);}
}
