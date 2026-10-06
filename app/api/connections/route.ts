import {owner,runtime,errorResponse} from '@/lib/server';
import {providerId} from '@/lib/llm-provider';

export async function GET(){
  try{
    const uid=await owner(),e=runtime();
    let aiPreviouslyVerified=false,cadPreviouslyVerified=false,slicePreviouslyVerified=false,currentSliceStatus:string|null=null;
    aiPreviouslyVerified=!!await e.DB.prepare("SELECT 1 AS ok FROM jobs WHERE owner_id=? AND kind='ai_plan' AND status IN ('suggestion_ready','applied') LIMIT 1").bind(uid).first();
    const rows=await e.DB.prepare('SELECT body FROM projects WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100').bind(uid).all<{body:string}>();
    for(const row of rows.results){
      try{
        const project=JSON.parse(row.body) as {revision:number;checks?:Array<{name?:string;status?:string;revision?:number;provenance?:{kind?:string;jobId?:string}}>};
        const checks=project.checks??[];
        if(checks.some(c=>c.status==='passed'&&c.provenance?.kind==='offline_slice'&&c.revision===project.revision)){
          slicePreviouslyVerified=true;
          currentSliceStatus='offline_consistent';
        }
        if(checks.some(c=>c.status==='passed'&&((c.name??'').includes('CAD')||(c.provenance?.kind??'').includes('cad'))))cadPreviouslyVerified=true;
      }catch{}
    }
    if(!cadPreviouslyVerified){const cad=await e.DB.prepare("SELECT 1 AS ok FROM jobs WHERE owner_id=? AND kind='cad_build' AND status IN ('completed','succeeded','verified','attached') LIMIT 1").bind(uid).first();cadPreviouslyVerified=!!cad;}
    const aiProvider=providerId({baseUrl:e.AI_BASE_URL??'',provider:e.AI_PROVIDER});
    const agentConfigured=!!(e.AGENT_SERVICE_URL&&e.AGENT_SERVICE_TOKEN&&e.AGENT_TOOL_GATEWAY_TOKEN);
    return Response.json({localDemo:e.LOCAL_DEMO_MODE==='true',agent:{configured:agentConfigured,state:agentConfigured?'configured':'not_configured'},ai:{configured:!!(e.AI_API_KEY&&e.AI_BASE_URL&&e.AI_MODEL),provider:aiProvider,model:e.AI_MODEL??null,state:aiPreviouslyVerified?'previously_verified':'configured',previouslyVerified:aiPreviouslyVerified},tripo:{configured:!!e.TRIPO_API_KEY,proxyConfigured:!!(e.TRIPO_PROXY_URL||(typeof process!=='undefined'&&process.env?.TRIPO_PROXY_URL)),version:'v3',region:e.TRIPO_REGION==='china'?'china':'global',model:'v3.1-20260211',capabilities:['text_to_model','image_to_model','import_model','mesh_segmentation','mesh_completion','highpoly_to_lowpoly','texture_model','convert_model']},engineering:{configured:true,executor:'local_pairing',state:cadPreviouslyVerified?'previously_verified':'available_when_paired',currentlyConnected:false,previouslyVerified:cadPreviouslyVerified},slicing:{configured:true,engine:'Bambu Studio',version:'02.08.02.60',executable:false,state:slicePreviouslyVerified?'previously_verified':'runtime_unavailable',currentlyConnected:false,previouslyVerified:slicePreviouslyVerified,currentStatus:currentSliceStatus}});
  }catch(e){return errorResponse(e);}
}
