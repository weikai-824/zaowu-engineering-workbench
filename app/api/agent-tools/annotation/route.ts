import {z} from 'zod';
import {agentToolErrorResponse,authorizeAgentTool,AgentToolHttpError} from '@/lib/agent-tool-auth';
import {bodyJson,runtime} from '@/lib/server';

const input=z.object({project_id:z.string().uuid(),project_revision:z.number().int().positive(),asset_id:z.string().uuid()}).strict();
const MAX_IMAGE_BYTES=2*1024*1024;

function encodeBase64(bytes:Uint8Array){
 let binary='';
 for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
 return btoa(binary);
}

export async function POST(request:Request){
 try{
  const ownerId=await authorizeAgentTool(request);
  const value=input.parse(await bodyJson(request,4_000));
  const rt=runtime();
  const project=await rt.DB.prepare('SELECT revision FROM projects WHERE id=? AND owner_id=?').bind(value.project_id,ownerId).first<{revision:number}>();
  if(!project)throw new AgentToolHttpError(404,'project_not_found','项目不存在。');
  if(project.revision<value.project_revision)throw new AgentToolHttpError(409,'project_revision_conflict','圈选来源版本不存在。');
  const asset=await rt.DB.prepare('SELECT object_key,content_type,size FROM assets WHERE id=? AND owner_id=?').bind(value.asset_id,ownerId).first<{object_key:string;content_type:string;size:number}>();
  if(!asset)throw new AgentToolHttpError(404,'annotation_not_found','圈选截图不存在。');
  if(!['image/png','image/jpeg','image/webp'].includes(asset.content_type)||asset.size<=0||asset.size>MAX_IMAGE_BYTES)throw new AgentToolHttpError(413,'annotation_image_invalid','圈选截图格式或大小不符合 Agent 输入限制。');
  const object=await rt.BUCKET.get(asset.object_key);
  if(!object)throw new AgentToolHttpError(404,'annotation_content_missing','圈选截图内容不存在。','state_unknown');
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.length!==asset.size)throw new AgentToolHttpError(409,'annotation_size_mismatch','圈选截图记录与对象内容不一致。','state_unknown');
  return Response.json({data_url:`data:${asset.content_type};base64,${encodeBase64(bytes)}`});
 }catch(error){return agentToolErrorResponse(error);}
}
