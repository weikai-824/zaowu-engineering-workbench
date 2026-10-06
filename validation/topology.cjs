// Read-only production bundle; all generated files/results stay under work/.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const{createRequire}=require('node:module');
const project=path.resolve(__dirname,'..');const req=createRequire(path.join(project,'package.json'));const esbuild=req('esbuild');
const out=path.join(project,'work/validation/topology-review');fs.mkdirSync(out,{recursive:true});
const source=path.join(project,'lib/topology.ts');const sourceSha256=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
esbuild.buildSync({entryPoints:[source],outfile:path.join(out,'topology.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const mod=require(path.join(out,'topology.cjs'));const{analyzeTriangles,TOPOLOGY_LIMIT,TOPOLOGY_TOLERANCE_MM}=mod;
const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'topology-fixtures.json'),'utf8'));
// The production API accepts triangle soup: represent these fixtures as non-indexed records.
function input(f){return{coordinates:Float64Array.from(f.faces.flatMap(face=>face.flatMap(v=>f.vertices[v]))),sourceMeshes:1,sourceVertexRecords:f.faces.length*3};}
function hash(c){const b=Buffer.alloc(c.byteLength);for(let i=0;i<c.length;i++)b.writeDoubleLE(c[i]===0?0:c[i],i*8);return crypto.createHash('sha256').update(b).digest('hex');}
const mapping={boundaryEdges:'boundaryEdges',nonManifoldEdges:'nonManifoldEdges',duplicateExtraFaces:'duplicateFaces',degenerateFaces:'degenerateFaces',vertexLinkFailures:'nonManifoldVertices',edgeFaceComponents:'edgeConnectedComponents',inconsistentTwoFaceEdges:'windingConflictEdges'};
const results=[];
(async()=>{
for(const f of plan.fixtures){const data=input(f),before=hash(data.coordinates),start=performance.now();const report=await analyzeTriangles(data);const expected=f.expectedExactPosition??f.expectedRaw;const differences=[];
for(const [key,value]of Object.entries(expected)){if(mapping[key]&&report.exact[mapping[key]]!==value)differences.push({key,expected:value,actual:report.exact[mapping[key]]});}
results.push({id:f.id,expectedView:'exactPosition',elapsedMs:performance.now()-start,report,differences,inputUnchanged:hash(data.coordinates)===before,hashMatchesInput:report.geometryHash===before,
scopeNotes:f.id==='T16_mobius_strip'?['Only current winding conflicts are implemented; parityConsistent is not checked.']:f.id==='T18_isolated_vertex'?['Unreferenced source points are not represented in expanded triangle coordinates; unusedVertices is outside current API scope.']:[]});}
async function mustReject(id,data){try{await analyzeTriangles(data);results.push({id,expected:'reject',actual:'accept',blocking:true});}catch(e){results.push({id,expected:'reject',actual:'reject',error:e.message});}}
const good=input(plan.fixtures[0]);await mustReject('N01_empty',{...good,coordinates:new Float64Array()});
await mustReject('N02_incomplete_triangle',{...good,coordinates:new Float64Array(8)});
const nan=good.coordinates.slice();nan[0]=NaN;await mustReject('N03_nan',{...good,coordinates:nan});
const inf=good.coordinates.slice();inf[0]=Infinity;await mustReject('N04_infinity',{...good,coordinates:inf});
await mustReject('N05_face_budget',{...good,coordinates:new Float64Array((TOPOLOGY_LIMIT+1)*9)});
await mustReject('N06_wrong_typed_array',{...good,coordinates:new Float32Array(good.coordinates)});
await mustReject('N07_invalid_metadata',{...good,sourceMeshes:0});

// R1: external caller mutates the same input during the digest await.
const race=input(plan.fixtures[0]);const originalHash=hash(race.coordinates);const originalStats=results.find(x=>x.id==='T01_closed_tetra').report.exact;const pending=analyzeTriangles(race);race.coordinates[0]=0.125;const mutatedHash=hash(race.coordinates);const raced=await pending;
const stable=await analyzeTriangles({...race,coordinates:race.coordinates.slice()});
results.push({id:'R01_hash_analysis_mutation_race',originalHash,mutatedHash,returnedHash:raced.geometryHash,returnedExact:raced.exact,stableMutatedExact:stable.exact,
snapshotMatchesOriginal:raced.geometryHash===originalHash&&JSON.stringify(raced.exact)===JSON.stringify(originalStats),
sameStatsAsMutated:JSON.stringify(raced.exact)===JSON.stringify(stable.exact),
blocking:!(raced.geometryHash===originalHash&&JSON.stringify(raced.exact)===JSON.stringify(originalStats))});

const metadata=input(plan.fixtures[0]);const expectedMetadata={sourceMeshes:metadata.sourceMeshes,sourceVertexRecords:metadata.sourceVertexRecords};
const metadataPending=analyzeTriangles(metadata);metadata.sourceMeshes=0;metadata.sourceVertexRecords=-1;const metadataReport=await metadataPending;
results.push({id:'R02_metadata_mutation',expectedMetadata,actual:{sourceMeshes:metadataReport.input.sourceMeshes,sourceVertexRecords:metadataReport.input.sourceVertexRecords},
blocking:metadataReport.input.sourceMeshes!==expectedMetadata.sourceMeshes||metadataReport.input.sourceVertexRecords!==expectedMetadata.sourceVertexRecords});
const shared=new Float64Array(new SharedArrayBuffer(good.coordinates.byteLength));shared.set(good.coordinates);await mustReject('N08_shared_array_buffer',{...good,coordinates:shared});

// Fixed representative proximity examples use a tiny isolated third point; no rendering/model mutation.
for(const c of [
{id:'P01_chain',points:[[0,0,0],[0.75,0,0],[1.5,0,0]],expectedVertices:2},
{id:'P02_grid_boundary',points:[[0.99,0,0],[1.01,0,0],[0,10,0]],expectedVertices:2},
{id:'P03_same_cell_far_diagonal',points:[[0.01,0.01,0.01],[0.99,0.99,0.99],[0,10,0]],expectedVertices:3}]){
const coordinates=Float64Array.from(c.points.flat().map(x=>x*TOPOLOGY_TOLERANCE_MM));const r=await analyzeTriangles({coordinates,sourceMeshes:1,sourceVertexRecords:3});results.push({id:c.id,expectedTolerantVertices:c.expectedVertices,actualTolerantVertices:r.tolerant.vertices,passed:r.tolerant.vertices===c.expectedVertices,verdict:r.verdict});}

const repeated=input(plan.fixtures[0]);const r1=await analyzeTriangles(repeated);const r2=await analyzeTriangles(repeated);
results.push({id:'P08_repeatability',sameGeometryHash:r1.geometryHash===r2.geometryHash,sameStats:JSON.stringify(r1.exact)===JSON.stringify(r2.exact)});
const intersect=results.find(x=>x.id==='T12_intersecting_closed_shells');
results.push({id:'P09_no_manufacturing_claim',topologyVerdict:intersect.report.verdict,explicitSelfIntersectionNotChecked:intersect.report.notChecked.includes('self_intersection'),explicitPhysicalNotChecked:intersect.report.notChecked.includes('physical_manufacturing'),verification:intersect.report.verification});
const failed=results.some(r=>r.blocking||r.differences?.length||r.passed===false||r.expected==='reject'&&r.actual!=='reject'||r.sameGeometryHash===false||r.sameStats===false||r.id==='P09_no_manufacturing_claim'&&(!r.explicitSelfIntersectionNotChecked||!r.explicitPhysicalNotChecked||r.verification!=='client_report_unverified'));if(failed)process.exitCode=1;
const result={date:new Date().toISOString(),sourceSha256,analyzerVersion:mod.TOPOLOGY_VERSION,triangleLimit:TOPOLOGY_LIMIT,vertexLimit:mod.TOPOLOGY_VERTEX_LIMIT,edgeLimit:mod.TOPOLOGY_EDGE_LIMIT,results};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sourceSha256,cases:results.length,blocking:results.filter(x=>x.blocking).map(x=>x.id),countDifferences:results.filter(x=>x.differences?.length).map(x=>({id:x.id,differences:x.differences})),rejectionFailures:results.filter(x=>x.expected==='reject'&&x.actual!=='reject')},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
