import {z} from 'zod';
import {designFeedbackSchema} from './design-feedback';
import {ApiError,runtime} from './server';

// Agent settings enforce a <=450s worst-case context/image/model retry budget.
// Leave 30s for local transport, serialization and synchronous trace flushing.
const AGENT_SERVICE_TIMEOUT_MS=480_000;

const runStatus=z.enum(['pending','loading_context','planning','waiting_for_clarification','waiting_for_approval','executing','waiting_for_tool','verifying','replanning','failed','canceled','succeeded']);
export const createAgentRunSchema=z.object({
 client_request_id:z.string().uuid(),
 project_id:z.string().uuid(),
 project_revision:z.number().int().positive(),
 goal:z.string().min(1).max(2000),
 feedback:designFeedbackSchema,
}).strict();
export const agentDecisionSchema=z.object({choice:z.enum(['approve','reject','modify']),feedback:z.string().max(2000).nullable().optional()}).strict().superRefine((value,context)=>{if(value.choice==='modify'&&!value.feedback?.trim())context.addIssue({code:z.ZodIssueCode.custom,message:'修改计划时必须填写补充要求。',path:['feedback']});});
export const agentClarificationSchema=z.object({answers:z.array(z.string().trim().min(1).max(4000)).min(1).max(20)}).strict();
export const agentRunSchema=z.object({
 run_id:z.string().uuid(),thread_id:z.string().uuid(),status:runStatus,
 project_id:z.string().uuid(),project_revision:z.number().int().positive(),current_revision:z.number().int().positive(),
 plan:z.record(z.unknown()).nullable(),events:z.array(z.record(z.unknown())),pending_action:z.enum(['clarification','approval','tool_wait']).nullable(),
 failure:z.record(z.unknown()).nullable(),final_asset_ids:z.array(z.string().uuid()),tool_call_count:z.number().int().nonnegative(),replan_count:z.number().int().nonnegative(),
 model_input_tokens:z.number().int().nonnegative(),model_output_tokens:z.number().int().nonnegative(),estimated_cost_usd:z.number().nonnegative(),
 created_at:z.string().datetime({offset:true}),updated_at:z.string().datetime({offset:true}),
}).strict();
export type AgentRun=z.infer<typeof agentRunSchema>;

export function agentServiceConfigured(){const value=runtime();return !!value.AGENT_SERVICE_URL&&!!value.AGENT_SERVICE_TOKEN;}

export async function callAgentService(ownerId:string,path:string,init:RequestInit={}){
 const value=runtime(),baseUrl=value.AGENT_SERVICE_URL?.replace(/\/$/,'');
 if(!baseUrl||!value.AGENT_SERVICE_TOKEN)throw new ApiError(503,'返工 Agent 服务尚未配置。');
 let response:Response;
 try{
  response=await fetch(`${baseUrl}/v1/runs${path}`,{...init,signal:AbortSignal.timeout(AGENT_SERVICE_TIMEOUT_MS),headers:{...init.headers,Authorization:`Bearer ${value.AGENT_SERVICE_TOKEN}`,'X-Zaowu-Owner-Id':ownerId}});
 }catch{throw new ApiError(503,'返工 Agent 服务暂时不可达，任务状态仍保存在服务端 checkpoint 中。');}
 const raw=await response.text();
 if(raw.length>4*1024*1024)throw new ApiError(503,'返工 Agent 返回内容超出产品端限制。');
 let data:unknown;
 try{data=JSON.parse(raw);}catch{throw new ApiError(503,'返工 Agent 返回了无效响应。');}
 if(!response.ok){
  const parsed=z.object({error:z.object({message:z.string()}).passthrough()}).safeParse(data);
  throw new ApiError(response.status,parsed.success?parsed.data.error.message:'返工 Agent 请求失败。');
 }
 return agentRunSchema.parse(data);
}
