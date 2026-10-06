import {z} from 'zod';
import {agentToolErrorResponse,authorizeAgentTool,AgentToolHttpError} from '@/lib/agent-tool-auth';
import {bodyJson,runtime} from '@/lib/server';
import {type Project} from '@/lib/engineering';
import {planningContext} from '@/lib/planning-context';

const input=z.object({
 project_id:z.string().uuid(),
 project_revision:z.number().int().positive(),
 part_id:z.string().uuid(),
 accept_newer_revision:z.boolean(),
}).strict();

export async function POST(request:Request){
 try{
  const ownerId=await authorizeAgentTool(request);
  const value=input.parse(await bodyJson(request,16_000));
  const row=await runtime().DB.prepare('SELECT body,revision FROM projects WHERE id=? AND owner_id=?').bind(value.project_id,ownerId).first<{body:string;revision:number}>();
  if(!row)throw new AgentToolHttpError(404,'project_not_found','项目不存在。');
  if(value.accept_newer_revision?row.revision<value.project_revision:row.revision!==value.project_revision)throw new AgentToolHttpError(409,'project_revision_conflict','项目版本已经变化。');
  const project=JSON.parse(row.body) as Project;
  if(project.revision!==row.revision)throw new AgentToolHttpError(409,'project_snapshot_invalid','项目快照与版本索引不一致。','state_unknown');
  if(!project.parts.some(part=>part.id===value.part_id))throw new AgentToolHttpError(409,'feedback_target_missing','圈选对应的零件在当前版本中不存在。');
  const context=await planningContext(project,value.part_id);
  return Response.json({
   project_id:project.id,
   revision:project.revision,
   input_hash:context.inputHash,
   selected_part_id:value.part_id,
   project:context.project,
   evidence:context.evidence,
   limitations:[context.evidenceLimitations],
  });
 }catch(error){return agentToolErrorResponse(error);}
}
