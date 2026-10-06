import {agentToolInvocationSchema} from '@/lib/agent-tool-contract';
import {agentToolErrorResponse,authorizeAgentTool} from '@/lib/agent-tool-auth';
import {executeAgentTool} from '@/lib/agent-tool-gateway';
import {bodyJson,runtime} from '@/lib/server';

export async function POST(request:Request){
 try{
  const ownerId=await authorizeAgentTool(request);
  const invocation=agentToolInvocationSchema.parse(await bodyJson(request,256_000));
  return Response.json(await executeAgentTool(runtime(),ownerId,invocation));
 }catch(error){return agentToolErrorResponse(error);}
}
