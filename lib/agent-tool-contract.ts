import {z} from 'zod';

const jsonScalar=z.union([z.string(),z.number().finite(),z.boolean(),z.null()]);
type JsonValue=z.infer<typeof jsonScalar>|JsonValue[]|{[key:string]:JsonValue};
const jsonValue:z.ZodType<JsonValue>=z.lazy(()=>z.union([jsonScalar,z.array(jsonValue),z.record(jsonValue)]));

export const toolNameSchema=z.enum([
 'apply_design_change',
 'create_cad_job',
 'start_cad_execution',
 'poll_cad_execution',
 'attach_cad_result',
 'verify_revision',
 'apply_visual_edit',
 'verify_visual_revision',
]);

export const agentToolInvocationSchema=z.object({
 run_id:z.string().uuid(),
 plan_version:z.number().int().positive().max(20),
 step_id:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
 tool_index:z.number().int().nonnegative().max(64),
 tool:toolNameSchema,
 idempotency_key:z.string().min(1).max(240),
 owner_id:z.string().min(1).max(256),
 project_id:z.string().uuid(),
 expected_revision:z.number().int().positive(),
 arguments:z.record(jsonValue),
}).strict();

export type AgentToolInvocation=z.infer<typeof agentToolInvocationSchema>;
export type AgentToolName=z.infer<typeof toolNameSchema>;
export type AgentToolOutcome='succeeded'|'pending'|'failed';
export type AgentToolErrorKind='retryable'|'non_retryable'|'state_unknown'|'human_required';
export type AgentToolEvidence=Record<string,JsonValue>;
export const agentToolResultSchema=z.object({
 invocation:agentToolInvocationSchema,
 outcome:z.enum(['succeeded','pending','failed']),
 summary:z.string().min(1).max(2000),
 output:z.record(jsonValue),
 evidence:z.array(z.record(jsonValue)),
 error_code:z.string().max(160).nullable(),
 error_kind:z.enum(['retryable','non_retryable','state_unknown','human_required']).nullable(),
}).strict().superRefine((value,context)=>{
 const classified=value.error_code!==null&&value.error_kind!==null;
 if(value.outcome==='failed'&&!classified)context.addIssue({code:z.ZodIssueCode.custom,message:'失败工具结果必须包含错误分类。'});
 if(value.outcome!=='failed'&&(value.error_code!==null||value.error_kind!==null))context.addIssue({code:z.ZodIssueCode.custom,message:'非失败结果不能包含错误分类。'});
});
export type AgentToolResult=z.infer<typeof agentToolResultSchema>;

export function toolResult(invocation:AgentToolInvocation,summary:string,output:Record<string,JsonValue>={},evidence:AgentToolEvidence[]=[]):AgentToolResult{
 return{invocation,outcome:'succeeded',summary,output,evidence,error_code:null,error_kind:null};
}

export function pendingToolResult(invocation:AgentToolInvocation,summary:string,output:Record<string,JsonValue>={},evidence:AgentToolEvidence[]=[]):AgentToolResult{
 return{invocation,outcome:'pending',summary,output,evidence,error_code:null,error_kind:null};
}

export function failedToolResult(invocation:AgentToolInvocation,code:string,kind:AgentToolErrorKind,summary:string,evidence:AgentToolEvidence[]=[]):AgentToolResult{
 return{invocation,outcome:'failed',summary,output:{},evidence,error_code:code,error_kind:kind};
}
