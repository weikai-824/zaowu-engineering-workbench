'use client';
import {Button} from '@/components/ui/button';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '@/components/ui/collapsible';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
import type {Evidence} from '@/lib/engineering';
import type {TopologyStats} from '@/lib/topology';
const rows:[keyof TopologyStats,string][]=[['boundaryEdges','缺口边'],['nonManifoldEdges','非流形边'],['nonManifoldVertices','非流形顶点'],['windingConflictEdges','绕向冲突'],['duplicateFaces','重复面'],['degenerateFaces','退化面'],['edgeConnectedComponents','连通壳']];
export default function TopologyDetails({evidence,showing,onShow}:{evidence:Evidence;showing:boolean;onShow:()=>void}){
 const r=evidence.topology;if(!r)return null;
 return <Collapsible className="topology-details"><CollapsibleTrigger asChild><Button size="sm" variant="ghost">查看检查明细</Button></CollapsibleTrigger><CollapsibleContent>
  <p className="hint">同坐标顶点仅在检查时关联；原模型与贴图没有被修改。连通壳不等于设计零件。</p>
  <Table><TableHeader><TableRow><TableHead>项目</TableHead><TableHead>同坐标关联</TableHead><TableHead>容差关联</TableHead></TableRow></TableHeader><TableBody>{rows.map(([key,label])=><TableRow key={key}><TableCell>{label}</TableCell><TableCell>{r.exact[key]}</TableCell><TableCell>{r.tolerant[key]}</TableCell></TableRow>)}</TableBody></Table>
  <p className="hint">数值容差 {r.options.weldToleranceMm} mm；{r.mergedDistinctVertices} 个不同坐标顶点被关联。它不是装配公差，也没有被写回模型。</p>
  {r.verdict==='tolerance_sensitive'&&<p className="topology-warning">结果对容差敏感，请检查接缝和极小特征，不能据此确认模型闭合。</p>}
  {r.examples.length>0&&<Button variant="outline" size="sm" disabled={evidence.status==='stale'} onClick={onShow}>{showing?'隐藏问题边':'显示问题边样例'}（{r.examples.length} 条）</Button>}
  <p className="hint">红线只显示有限的边问题样例；重复面、退化面及仅顶点相接的问题请结合计数复核。未检查自交、壁厚、壳内外关系和功能强度。</p>
  <p className="hint">检测于 v{evidence.measuredAtRevision} · {new Date(r.measuredAt).toLocaleString()}<br/>算法 {r.algorithm} · 几何指纹 {r.geometryHash.slice(0,12)}…</p>
 </CollapsibleContent></Collapsible>;
}
