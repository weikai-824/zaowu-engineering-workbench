import {owner,runtime,errorResponse,ApiError,bodyJson,checkOrigin} from '@/lib/server';
import {processInput,submitTripoProcess} from '@/lib/tripo-process';
export async function POST(request:Request){try{checkOrigin(request);const uid=await owner();const parsed=processInput.safeParse(await bodyJson(request,20000));if(!parsed.success)throw new ApiError(400,parsed.error.issues[0]?.message??'Tripo 后处理参数无效。');return Response.json(await submitTripoProcess(runtime(),uid,parsed.data));}catch(e){return errorResponse(e);}}
