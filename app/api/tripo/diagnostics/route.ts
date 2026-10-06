import {isJsonObject} from '@/lib/json-value';
import {owner,runtime,errorResponse,ApiError} from '@/lib/server';
import {tripoOrigin,tripoRegion,readLimited,tripoFetcher} from '@/lib/tripo-provider';

export async function GET(){
 try{
  await owner();
  const rt=runtime();
  if(!rt.TRIPO_API_KEY)throw new ApiError(503,'Tripo 尚未配置 API Key。');
  const region=tripoRegion(rt.TRIPO_REGION),origin=tripoOrigin(region),authorization={Authorization:'Bearer '+rt.TRIPO_API_KEY,Accept:'application/json'},fetcher=tripoFetcher(rt.TRIPO_PROXY_URL,rt.TRIPO_PROXY_BRIDGE_URL);
  let response:Response;
  try{
   response=await fetcher(origin+'/account/balance',{headers:authorization,redirect:'error',signal:AbortSignal.timeout(20_000)});
  }catch(error){
   console.error('Tripo diagnostic network failure',error instanceof Error?`${error.name}:${error.message}:${(error as Error&{cause?:{code?:string}}).cause?.code??'unknown'}`:'unknown');
   throw new ApiError(502,'无法连接 Tripo 账户接口，请检查地域或网络出口。');
  }
  let payload:unknown;
  try{payload=JSON.parse(new TextDecoder().decode(await readLimited(response,256*1024)));}
  catch{throw new ApiError(502,'Tripo 账户接口返回了无效响应。');}
  if(!response.ok||!isJsonObject(payload)||payload.code!==0){
   if(response.status===401||response.status===403)throw new ApiError(502,'Tripo API Key 无效或无权访问当前地域。');
   throw new ApiError(502,'Tripo 账户接口暂时不可用。');
  }
  const account=isJsonObject(payload.data)?payload.data:null,balance=account?.balance,frozen=account?.frozen;
  if(typeof balance!=='number'||!Number.isFinite(balance)||typeof frozen!=='number'||!Number.isFinite(frozen))throw new ApiError(502,'Tripo 账户接口未返回有效额度。');
  let usage:{tasks:number;credits:number;source:'account/usage'|'unavailable'}={tasks:0,credits:0,source:'unavailable'};
  try{
   const usageResponse=await fetcher(origin+'/account/usage',{headers:authorization,redirect:'error',signal:AbortSignal.timeout(10_000)});
   if(usageResponse.ok){
    const usagePayload:unknown=JSON.parse(new TextDecoder().decode(await readLimited(usageResponse,2*1024*1024)));
    const rows=isJsonObject(usagePayload)&&Array.isArray(usagePayload.data)?usagePayload.data.filter(isJsonObject):[];
    const credits=rows.reduce((sum,row)=>sum+(typeof row.credits_consumed==='number'&&Number.isFinite(row.credits_consumed)?row.credits_consumed:0),0);
    usage={tasks:rows.length,credits,source:'account/usage'};
   }
  }catch{/* Balance remains authoritative when usage is unavailable. */}
  return Response.json({configured:true,apiVersion:'v3',region,baseUrl:origin,model:'v3.1-20260211',balance,frozen,usage,checkedAt:new Date().toISOString(),capabilities:['text_to_model','image_to_model','import_model','mesh_segmentation','mesh_completion','highpoly_to_lowpoly','texture_model','convert_model']});
 }catch(error){return errorResponse(error);}
}
