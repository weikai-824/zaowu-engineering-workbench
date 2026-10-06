import {z} from 'zod';
import {owner,errorResponse,bodyJson,checkOrigin} from '@/lib/server';
import {previewTripoPayload} from '@/lib/tripo-preview';
import {manufacturing} from '@/lib/tripo-submit';

const requestSchema=z.object({profile:z.enum(['golden_baseline','high_quality_validation']),projectId:z.string().uuid(),projectRevision:z.number().int().positive(),prompt:z.string().min(1).max(1024),clientRequestId:z.string().uuid().optional(),region:z.enum(['global','china']).optional(),projectBody:z.string().max(4_000_000).optional(),manufacturing:manufacturing.optional()}).strict();

/** Dry-run only: this route never reads credentials or calls the Tripo provider. */
export async function POST(request:Request){try{checkOrigin(request);await owner();const parsed=requestSchema.safeParse(await bodyJson(request,4_100_000));if(!parsed.success)return Response.json({error:'Tripo 预览参数无效。'},{status:400});return Response.json(previewTripoPayload(parsed.data.profile,parsed.data));}catch(e){return errorResponse(e);}}
