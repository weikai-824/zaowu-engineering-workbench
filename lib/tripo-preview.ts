import {buildTripoPayload,engineeringConstraints,generationInput,visualGenerationPrompt,type Input} from './tripo-submit';
import {tripoOrigin,type TripoRegion} from './tripo-provider';

export type TripoPreviewProfile='golden_baseline'|'high_quality_validation';
type PreviewOverrides={projectId:string;projectRevision:number;prompt:string;clientRequestId?:string;region?:TripoRegion;projectBody?:string;manufacturing?:Input['manufacturing']};

const highQualityNegativePrompt='low-poly; disconnected shells; floating parts; thin unsupported walls; decorative scene elements';

function profileInput(profile:TripoPreviewProfile,overrides:PreviewOverrides):Input{
 const high=profile==='high_quality_validation';
 return generationInput.parse({clientRequestId:overrides.clientRequestId??'00000000-0000-4000-8000-000000000000',projectId:overrides.projectId,projectRevision:overrides.projectRevision,kind:'text',operation:'generate',prompt:overrides.prompt,modelVersion:'v3.1-20260211',faceLimit:high?80000:10000,texture:true,pbr:true,textureQuality:high?'detailed':'standard',geometryQuality:high?'detailed':undefined,exportUv:true,autoSize:!high,modelSeed:high?20260915:undefined,imageSeed:high?20260916:undefined,textureSeed:high?20260917:undefined,negativePrompt:high?highQualityNegativePrompt:undefined,enableImageAutofix:false,orientation:'default',smartLowPoly:false,generateParts:false,quad:false,manufacturing:overrides.manufacturing});
}

export function previewTripoPayload(profile:TripoPreviewProfile,overrides:PreviewOverrides){
 const input=profileInput(profile,overrides),prompt=visualGenerationPrompt(input),built=buildTripoPayload(input);
 return{schema:'tripo-payload-preview-v1',dryRun:true,submit:false,networkRequests:[],profile,provider:{region:overrides.region??'global',baseUrl:tripoOrigin(overrides.region??'global')},visualPrompt:prompt,engineeringConstraints:engineeringConstraints(input,overrides.projectBody),request:{method:'POST',endpoint:built.endpoint,url:tripoOrigin(overrides.region??'global')+built.endpoint,body:built.payload},normalizedInput:input,notes:profile==='golden_baseline'?['复现当前 Golden Scenario：Text-to-3D、10k face limit、standard texture/default geometry quality、auto_size=true。','为保持旧场景语义，geometry_quality 不发送，使用 provider 默认值。','工程约束保存在 engineeringConstraints，不拼接进 generation prompt。','此结果仅为请求预览，不创建 jobs、不上传文件、不消耗 credits。']:['High Quality Validation：仍使用稳定的 v3.1-20260211；显式 detailed geometry、80k face limit、纹理/PBR、种子和 negative prompt。','工程约束保存在 engineeringConstraints，不拼接进 generation prompt。','此结果仅为请求预览，不创建 jobs、不上传文件、不消耗 credits。']};
}
