import {z} from 'zod';
import JSZip from 'jszip';
import {owner,runtime,errorResponse,ApiError,checkOrigin,bodyJson,bodyBytes} from '@/lib/server';
import {engineeringFingerprint,manufacturingParts,type Project} from '@/lib/engineering';
import {sha256} from '@/lib/slice-contract';
import type {OutputReviewSnapshot,OutputExport} from '@/lib/output-review';

const uuid=z.string().uuid();
const reviewInput=z.object({projectId:uuid,revision:z.number().int().positive(),items:z.array(z.object({partId:uuid,printability:z.enum(['pending','approved','revise']),loadAndAssembly:z.enum(['pending','approved','revise']),note:z.string().max(1000)}).strict()).max(200)}).strict();
type JobRow={id:string;project_id:string;base_revision:number;request:string;created_at:string;updated_at:string};

async function currentProject(projectId:string,uid:string){
 const row=await runtime().DB.prepare('SELECT body FROM projects WHERE id=? AND owner_id=?').bind(projectId,uid).first<{body:string}>();
 if(!row)throw new ApiError(404,'项目不存在。');
 const project=JSON.parse(row.body) as Project;
 return {project,fingerprint:await engineeringFingerprint(project)};
}

export async function GET(request:Request){try{
 const uid=await owner(),rt=runtime(),url=new URL(request.url),id=url.searchParams.get('id');
 if(id){if(!uuid.safeParse(id).success)throw new ApiError(400,'导出记录编号无效。');const row=await rt.DB.prepare("SELECT request FROM jobs WHERE id=? AND owner_id=? AND kind='output_export'").bind(id,uid).first<{request:string}>();if(!row)throw new ApiError(404,'导出记录不存在。');const record=JSON.parse(row.request) as {objectKey:string;filename:string};const object=await rt.BUCKET.get(record.objectKey);if(!object)throw new ApiError(404,'导出文件不存在。');return new Response(object.body,{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${record.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 const projectId=url.searchParams.get('projectId')??'';if(!uuid.safeParse(projectId).success)throw new ApiError(400,'项目编号无效。');
 const {project,fingerprint}=await currentProject(projectId,uid);
 const rows=await rt.DB.prepare("SELECT id,project_id,base_revision,request,created_at,updated_at FROM jobs WHERE owner_id=? AND project_id=? AND kind IN ('output_review','output_export') ORDER BY created_at DESC LIMIT 120").bind(uid,projectId).all<JobRow>();
 const reviews=rows.results.filter(row=>JSON.parse(row.request).scope==='human_review_only').map(row=>JSON.parse(row.request) as OutputReviewSnapshot);
 const review=reviews.find(item=>item.fingerprint===fingerprint)??null;
 const exports:OutputExport[]=rows.results.filter(row=>{const data=JSON.parse(row.request);return data.scope==='output_export';}).map(row=>{const data=JSON.parse(row.request);return{id:row.id,revision:row.base_revision,createdAt:row.created_at,bytes:data.bytes,sha256:data.sha256,reviewId:data.reviewId,stale:data.fingerprint!==fingerprint};});
 return Response.json({revision:project.revision,fingerprint,review,exports});
 }catch(error){return errorResponse(error);}}

export async function PUT(request:Request){try{
 checkOrigin(request);const uid=await owner(),input=reviewInput.safeParse(await bodyJson(request,250_000));if(!input.success)throw new ApiError(400,'复审内容无效。');
 const {project,fingerprint}=await currentProject(input.data.projectId,uid);if(project.revision!==input.data.revision)throw new ApiError(409,'项目版本已变化，请刷新后复审。');
 const parts=manufacturingParts(project),ids=new Set(parts.map(part=>part.id));if(input.data.items.length!==parts.length||new Set(input.data.items.map(item=>item.partId)).size!==parts.length||input.data.items.some(item=>!ids.has(item.partId)))throw new ApiError(400,'复审必须对应当前全部制造零件。');
 const rt=runtime(),id=crypto.randomUUID(),now=new Date().toISOString();
 const review:OutputReviewSnapshot={id,projectId:project.id,revision:project.revision,fingerprint,updatedAt:now,items:input.data.items,scope:'human_review_only',physicalValidation:'not_run',productionReady:false};
 await rt.DB.prepare('INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,uid,project.id,project.revision,'output_review','saved',JSON.stringify(review),now,now).run();
 return Response.json(review);
 }catch(error){return errorResponse(error);}}

export async function POST(request:Request){try{
 checkOrigin(request);const uid=await owner(),projectId=request.headers.get('x-project-id')??'',reviewId=request.headers.get('x-review-id')??'',revision=Number(request.headers.get('x-project-revision'));
 if(!uuid.safeParse(projectId).success||!uuid.safeParse(reviewId).success||!Number.isInteger(revision)||revision<1)throw new ApiError(400,'导出缺少有效的项目或复审记录。');
 const {project,fingerprint}=await currentProject(projectId,uid);if(project.revision!==revision)throw new ApiError(409,'项目版本已变化，请重新导出。');
 const row=await runtime().DB.prepare("SELECT request FROM jobs WHERE id=? AND owner_id=? AND project_id=? AND kind='output_review'").bind(reviewId,uid,projectId).first<{request:string}>();if(!row)throw new ApiError(409,'复审记录不存在，请重新确认。');const review=JSON.parse(row.request) as OutputReviewSnapshot;
 const parts=manufacturingParts(project);if(review.fingerprint!==fingerprint||parts.length===0||parts.some(part=>{const item=review.items.find(value=>value.partId===part.id);return item?.printability!=='approved'||item.loadAndAssembly!=='approved';}))throw new ApiError(409,'当前制造零件尚未全部完成人工复审。');
 if(request.headers.get('content-type')!=='application/zip')throw new ApiError(415,'请上传工程结果 ZIP。');
 const data=await bodyBytes(request,120*1024*1024),signature=new Uint8Array(data,0,4);if(signature[0]!==80||signature[1]!==75||signature[2]!==3||signature[3]!==4)throw new ApiError(400,'工程结果包不是有效 ZIP 文件。');
 try{const zip=await JSZip.loadAsync(data),reviewFile=zip.file('review/human-review.json'),projectFile=zip.file('project.json');if(!reviewFile||!projectFile)throw Error('缺少项目或人工复审记录。');const embeddedReview=JSON.parse(await reviewFile.async('string')) as OutputReviewSnapshot,embeddedProject=JSON.parse(await projectFile.async('string')) as Project;if(JSON.stringify(embeddedReview)!==JSON.stringify(review)||embeddedProject.id!==project.id||embeddedProject.revision!==project.revision||await engineeringFingerprint(embeddedProject)!==fingerprint)throw Error('工程包与当前项目或人工复审记录不一致。');}catch(cause){throw new ApiError(400,'工程结果包核对失败：'+(cause instanceof Error?cause.message:String(cause)));}
 const digest=await sha256(data),id=crypto.randomUUID(),now=new Date().toISOString(),filename=`${project.title.replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,50)||'project'}-v${revision}-engineering-output.zip`,objectKey=`${uid}/outputs/${id}/engineering-output.zip`;
 await runtime().BUCKET.put(objectKey,data,{httpMetadata:{contentType:'application/zip'}});
 const record={scope:'output_export',fingerprint,reviewId,bytes:data.byteLength,sha256:digest,filename,objectKey};
 await runtime().DB.prepare('INSERT INTO jobs(id,owner_id,project_id,base_revision,kind,status,request,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,uid,projectId,revision,'output_export','archived',JSON.stringify(record),now,now).run();
 return Response.json({id,revision,createdAt:now,bytes:data.byteLength,sha256:digest,reviewId,stale:false} satisfies OutputExport);
 }catch(error){return errorResponse(error);}}
