import {tripoFetcher,TripoIssue} from './tripo-provider';

export type LlmProviderId='deepseek'|'openai'|'openai-compatible';
export type LlmContent=string|Array<{type:'text';text:string}|{type:'image_url';image_url:{url:string}}>;
export type LlmUsage={promptTokens:number|null;completionTokens:number|null;totalTokens:number|null}|null;
export type LlmCompletion={id:string;responseModel:string|null;content:string;finishReason:string|null;usage:LlmUsage};

type ProviderConfig={apiKey:string;baseUrl:string;model:string;provider?:string;bridgeUrl?:string};
type CompletionInput={system:string;user:LlmContent;temperature?:number;maxTokens?:number};
type CompletionData={id?:unknown;model?:unknown;choices?:Array<{message?:{content?:unknown};finish_reason?:unknown}>;usage?:{prompt_tokens?:unknown;completion_tokens?:unknown;total_tokens?:unknown}};

export interface LlmProvider{
 readonly id:LlmProviderId;
 readonly model:string;
 readonly supportsStructuredJson:true;
 completeJson(input:CompletionInput):Promise<LlmCompletion>;
}

export function providerId(config:Pick<ProviderConfig,'baseUrl'|'provider'>):LlmProviderId{
 if(config.provider==='deepseek'||config.provider==='openai'||config.provider==='openai-compatible')return config.provider;
 try{const host=new URL(config.baseUrl).hostname;if(host==='api.deepseek.com')return 'deepseek';if(host==='api.openai.com')return 'openai';}catch{}
 return 'openai-compatible';
}

function usage(value:CompletionData['usage']):LlmUsage{
 if(!value)return null;
 const number=(key:keyof NonNullable<CompletionData['usage']>)=>typeof value[key]==='number'&&Number.isFinite(value[key])?value[key] as number:null;
 return {promptTokens:number('prompt_tokens'),completionTokens:number('completion_tokens'),totalTokens:number('total_tokens')};
}

class OpenAiCompatibleProvider implements LlmProvider{
 readonly id:LlmProviderId;
 readonly model:string;
 readonly supportsStructuredJson=true as const;
 private readonly endpoint:URL;
 constructor(private readonly config:ProviderConfig){
  this.id=providerId(config);this.model=config.model;this.endpoint=new URL(config.baseUrl.replace(/\/$/,'')+'/chat/completions');
  if(this.endpoint.protocol!=='https:')throw Error('AI 接口需使用 HTTPS。');
 }
 async completeJson(input:CompletionInput):Promise<LlmCompletion>{
  const body:Record<string,unknown>={model:this.model,temperature:input.temperature??.2,max_tokens:input.maxTokens??7000,response_format:{type:'json_object'},messages:[{role:'system',content:input.system},{role:'user',content:input.user}]};
  if(this.id==='deepseek')body.thinking={type:'disabled'};
  if(this.endpoint.hostname.endsWith('.maas.aliyuncs.com')&&this.model.startsWith('qwen'))body.enable_thinking=false;
  let response:Response;
  try{
   const transport=this.config.bridgeUrl?tripoFetcher(undefined,this.config.bridgeUrl):fetch;
   response=await transport(this.endpoint,{method:'POST',headers:{Authorization:'Bearer '+this.config.apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify(body)});
  }catch(error){if(error instanceof TripoIssue&&error.code==='provider_unreachable')throw Error('AI 代理桥接失败，请检查网络代理。');throw error;}
  if(!response.ok)throw Object.assign(Error('AI 服务返回 '+response.status+'，请检查模型、权限或额度。'),{status:response.status});
  const data=await response.json() as CompletionData;
  const id=typeof data.id==='string'&&data.id.length<=200?data.id:'';
  const content=data.choices?.[0]?.message?.content;
  if(!id||typeof content!=='string')throw Error('AI 服务未返回可追踪的结构化响应。');
  return {id,responseModel:typeof data.model==='string'?data.model:null,content,finishReason:typeof data.choices?.[0]?.finish_reason==='string'?data.choices[0].finish_reason:null,usage:usage(data.usage)};
 }
}

export function createLlmProvider(config:ProviderConfig):LlmProvider{return new OpenAiCompatibleProvider(config);}
