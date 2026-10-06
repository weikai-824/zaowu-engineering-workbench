import {owner,runtime,errorResponse,bodyJson,checkOrigin,ApiError} from '@/lib/server';
import {reconcileTripoJobs} from '@/lib/tripo-recovery';
import {z} from 'zod';

const input=z.object({projectId:z.string().uuid().optional(),limit:z.number().int().min(1).max(20).default(20)}).strict();

export async function POST(request:Request){
 try{checkOrigin(request);const uid=await owner();const parsed=input.safeParse(await bodyJson(request));if(!parsed.success)throw new ApiError(400,'批量回收参数无效。');return Response.json(await reconcileTripoJobs(runtime(),uid,parsed.data.projectId,parsed.data.limit));}
 catch(e){return errorResponse(e);}
}
