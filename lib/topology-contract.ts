import {z} from 'zod';
import {TOPOLOGY_VERSION,TOPOLOGY_TOLERANCE_MM,TOPOLOGY_AREA_MM2,TOPOLOGY_LIMIT,topologyVerdict} from './topology';
const count=z.number().int().min(0).max(TOPOLOGY_LIMIT*3);
const point=z.tuple([z.number().finite().min(-1e9).max(1e9),z.number().finite().min(-1e9).max(1e9),z.number().finite().min(-1e9).max(1e9)]);
const stats=z.object({vertices:count,validTriangles:count,boundaryEdges:count,nonManifoldEdges:count,windingConflictEdges:count,duplicateFaces:count,degenerateFaces:count,nonManifoldVertices:count,edgeConnectedComponents:count}).strict();
export const topologySchema=z.object({
 algorithm:z.literal(TOPOLOGY_VERSION),producer:z.literal('browser_mesh_analysis'),verification:z.literal('client_report_unverified'),geometryHash:z.string().regex(/^[0-9a-f]{64}$/),measuredAt:z.string().datetime(),
 input:z.object({triangles:z.number().int().positive().max(TOPOLOGY_LIMIT),sourceMeshes:z.number().int().positive().max(4000),sourceVertexRecords:z.number().int().positive().max(4_000_000),coordinateSystem:z.literal('mm_z_up_world'),hashEncoding:z.literal('ordered_triangles_float64_le')}).strict(),
 options:z.object({weldToleranceMm:z.literal(TOPOLOGY_TOLERANCE_MM),minimumAreaMm2:z.literal(TOPOLOGY_AREA_MM2)}).strict(),
 exact:stats,tolerant:stats,mergedDistinctVertices:count,verdict:z.enum(['no_topology_issue_detected','tolerance_sensitive','topology_issues']),
 components:z.array(z.object({triangles:count,minMm:point,maxMm:point}).strict()).max(8),componentListTruncated:z.boolean(),
 examples:z.array(z.object({kind:z.enum(['boundary','non_manifold','winding']),a:point,b:point}).strict()).max(24),exampleView:z.enum(['exact','tolerant']),duplicateFaceExamples:z.array(count).max(8),degenerateFaceExamples:z.array(count).max(8),
 notChecked:z.tuple([z.literal('self_intersection'),z.literal('wall_thickness'),z.literal('outward_orientation'),z.literal('shell_containment'),z.literal('assembly_fit'),z.literal('physical_manufacturing')])
}).strict().superRefine((r,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
 for(const s of [r.exact,r.tolerant])if(s.validTriangles+s.degenerateFaces!==r.input.triangles||s.duplicateFaces>s.validTriangles||s.edgeConnectedComponents>s.validTriangles)issue('拓扑计数不一致。');
 if(r.exact.vertices-r.tolerant.vertices!==r.mergedDistinctVertices||r.verdict!==topologyVerdict(r.exact,r.tolerant,r.mergedDistinctVertices))issue('拓扑结论与计数不一致。');
 if(r.components.length!==Math.min(8,r.exact.edgeConnectedComponents)||r.componentListTruncated!==(r.exact.edgeConnectedComponents>8))issue('连通分量清单不一致。');
 if([...r.duplicateFaceExamples,...r.degenerateFaceExamples].some(i=>i>=r.input.triangles))issue('面示例编号越界。');
});
