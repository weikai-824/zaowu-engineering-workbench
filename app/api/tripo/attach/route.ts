import {z} from 'zod';
import {owner,runtime,checkOrigin,bodyJson,errorResponse,ApiError} from '@/lib/server';
import {attachRecoveredModel} from '@/lib/tripo-attach';
export async function POST(request:Request){try{checkOrigin(request);const uid=await owner();const parsed=z.object({jobId:z.string().uuid(),projectRevision:z.number().int().positive(),acceptNewerBase:z.boolean().optional(),targetLongestMm:z.number().finite().positive().max(100000).optional()}).strict().safeParse(await bodyJson(request));if(!parsed.success)throw new ApiError(400,'模型附加参数无效。');return Response.json(await attachRecoveredModel(runtime().DB,uid,parsed.data));}catch(e){return errorResponse(e);}}
