import {z} from 'zod';
import {bodyJson,checkOrigin,errorResponse,owner,runtime,ApiError} from '@/lib/server';
import {intakeTripoCandidate} from '@/lib/tripo-intake';

export async function POST(request:Request){
 try{checkOrigin(request);const uid=await owner();const parsed=z.object({jobId:z.string().uuid(),projectRevision:z.number().int().positive(),targetLongestMm:z.number().finite().positive().max(100000).optional()}).strict().safeParse(await bodyJson(request));if(!parsed.success)throw new ApiError(400,'工程化接入参数无效。');return Response.json(await intakeTripoCandidate(runtime(),uid,parsed.data));}
 catch(e){return errorResponse(e);}
}
