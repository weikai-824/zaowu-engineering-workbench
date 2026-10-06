// Independent adversarial budget input, not an implementation of the analyzer.
// Execute each case in a fresh Node process with --max-old-space-size=320.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const out=path.resolve(__dirname,'../work/validation/topology-review');
const source=path.resolve(__dirname,'../lib/topology.ts');
const sourceSha256=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const base=JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8'));
if(base.sourceSha256!==sourceSha256)throw Error('Read-only source changed after the 33-case bundle; rerun topology-code-review.cjs first.');
const mod=require(path.join(out,'topology.cjs'));
if(mod.TOPOLOGY_VERTEX_LIMIT!==300000||mod.TOPOLOGY_EDGE_LIMIT!==600000||mod.TOPOLOGY_LIMIT!==300000)throw Error('Expected current 300000-face/300000-point/600000-edge contract.');
const which=process.argv[2];if(!['vertex','edge'].includes(which))throw Error('Use vertex or edge.');
let coordinates,triangles,distinctVertices,distinctEdges,description,expectedErrorFragment;
if(which==='vertex'){
 // 100001 disjoint nondegenerate triangles; all 300003 points are distinct.
 triangles=100001;distinctVertices=300003;distinctEdges=300003;
 coordinates=new Float64Array(triangles*9);
 for(let f=0;f<triangles;f++){
  const o=f*9,x=f*2;
  coordinates[o]=x;coordinates[o+1]=0;coordinates[o+2]=0;
  coordinates[o+3]=x+1;coordinates[o+4]=0;coordinates[o+5]=0;
  coordinates[o+6]=x;coordinates[o+7]=1;coordinates[o+8]=0;
 }
 description='100001 disjoint right triangles; 300003 distinct positions; face/edge budgets are not exceeded.';
 expectedErrorFragment='30 万个不同坐标顶点预算';
}else{
 // Edge-disjoint triples from a Latin square over three disjoint vertex sets.
 // For each (a,b): A_a, B_b, C_(a+b mod n). Every A-B, A-C, B-C pair is unique.
 // Nondegenerate embedding: A=(a,0,0), B=(b,1000,0), C=(c,0,1000).
 const n=448;triangles=200001;distinctVertices=2*n+Math.ceil(triangles/n);distinctEdges=triangles*3;
 coordinates=new Float64Array(triangles*9);
 for(let f=0;f<triangles;f++){
  const a=Math.floor(f/n),b=f%n,c=(a+b)%n,o=f*9;
  coordinates[o]=a;coordinates[o+1]=0;coordinates[o+2]=0;
  coordinates[o+3]=b;coordinates[o+4]=1000;coordinates[o+5]=0;
  coordinates[o+6]=c;coordinates[o+7]=0;coordinates[o+8]=1000;
 }
 description='200001 Latin-square triples using 1343 distinct points and 600003 distinct edges; triangles and positions remain below their budgets.';
 expectedErrorFragment='60 万条不同边预算';
}
function hash(){return crypto.createHash('sha256').update(Buffer.from(coordinates.buffer,coordinates.byteOffset,coordinates.byteLength)).digest('hex');}
const before=hash();
(async()=>{
 const start=performance.now();let returnedReport=false,error=null,verdict=null;
 try{const r=await mod.analyzeTriangles({coordinates,sourceMeshes:1,sourceVertexRecords:coordinates.length/3});returnedReport=true;verdict=r.verdict;}catch(e){error=e.message;}
 const elapsedMs=performance.now()-start,maxRSSMiB=process.resourceUsage().maxRSS/1024;
 const row={id:which==='vertex'?'N09_distinct_vertex_budget':'N10_distinct_edge_budget',sourceSha256,description,
  input:{triangles,distinctVertices,distinctEdges,bytes:coordinates.byteLength,sha256:before},
  limits:{triangles:mod.TOPOLOGY_LIMIT,vertices:mod.TOPOLOGY_VERTEX_LIMIT,edges:mod.TOPOLOGY_EDGE_LIMIT},
  expected:'explicit_resource_rejection_without_report',returnedReport,verdict,error,
  inputUnchanged:hash()===before,elapsedMs,maxRSSMiB,nodeHeapLimitArgument:'--max-old-space-size=320',
  withinRequestedTimeAndMemory:elapsedMs<60000&&maxRSSMiB<=512,
  noSamplingNotice:typeof error==='string'&&error.includes('未作抽样判定')};
 row.passed=!returnedReport&&typeof error==='string'&&error.includes(expectedErrorFragment)&&row.noSamplingNotice&&row.inputUnchanged&&row.withinRequestedTimeAndMemory;
 fs.writeFileSync(path.join(out,`budget-${which}.json`),JSON.stringify(row,null,2)+'\n');console.log(JSON.stringify(row,null,2));
 if(!row.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
