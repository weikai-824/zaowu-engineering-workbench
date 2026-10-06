import {runtime} from './server';
import {sha256Hex} from './crypto-portable';

export class AgentToolHttpError extends Error{
 constructor(public status:number,public code:string,message:string,public kind:'retryable'|'non_retryable'|'state_unknown'='non_retryable'){super(message);}
}

async function secretsEqual(actual:string,expected:string){
 const [a,b]=await Promise.all([sha256Hex(actual),sha256Hex(expected)]);
 let different=a.length^b.length;
 for(let index=0;index<Math.min(a.length,b.length);index++)different|=a.charCodeAt(index)^b.charCodeAt(index);
 return different===0;
}

export async function authorizeAgentTool(request:Request){
 const token=runtime().AGENT_TOOL_GATEWAY_TOKEN;
 if(!token)throw new AgentToolHttpError(503,'tool_gateway_not_configured','Agent Tool Gateway 尚未配置。','retryable');
 const authorization=request.headers.get('authorization')??'';
 if(!await secretsEqual(authorization,`Bearer ${token}`))throw new AgentToolHttpError(401,'tool_gateway_unauthorized','Agent Tool Gateway 凭据无效。');
 const ownerId=request.headers.get('x-zaowu-owner-id')??'';
 if(!ownerId||ownerId.length>256||Array.from(ownerId).some(character=>character.charCodeAt(0)<32))throw new AgentToolHttpError(401,'owner_identity_invalid','缺少有效的产品用户身份。');
 return ownerId;
}

export function agentToolErrorResponse(error:unknown){
 if(error instanceof AgentToolHttpError)return Response.json({code:error.code,message:error.message,kind:error.kind},{status:error.status});
 if(error instanceof zodError)return Response.json({code:'tool_gateway_request_invalid',message:'Tool Gateway 请求格式无效。',kind:'non_retryable'},{status:400});
 console.error('Agent Tool Gateway failed',error instanceof Error?error.message:String(error));
 return Response.json({code:'tool_gateway_unavailable',message:'Agent Tool Gateway 暂时不可用。',kind:'state_unknown'},{status:503});
}

// Keep the Zod dependency behind a tiny nominal class check so route files share one error envelope.
import {ZodError as zodError} from 'zod';
