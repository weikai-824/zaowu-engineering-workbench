"""Controlled CAD executor. Python 3.12 + cadquery==2.8.0; no arbitrary Python in tasks."""
import argparse, hashlib, json, math, os, pathlib, struct, subprocess, sys, tempfile, time, uuid, zipfile

VERSION = 'controlled-cad-v3'
def digest(b): return hashlib.sha256(b).hexdigest()

def clean_stl_degenerate(path):
    """Drop zero-length STL facets emitted at exact fillet/planar seams.

    CadQuery/OCP can emit a handful of zero-area facets at tangent seams. They
    are not part of the BREP solid, but they make the browser's strict saved
    part correspondence refuse an otherwise valid manufacturing asset. Keep
    every non-degenerate facet byte-for-byte and rebuild only the count field.
    """
    raw = pathlib.Path(path).read_bytes()
    if len(raw) < 134:
        raise ValueError('STL output is incomplete')
    count = struct.unpack_from('<I', raw, 80)[0]
    if len(raw) != 84 + 50 * count:
        raise ValueError('STL output length is invalid')
    kept = []
    for i in range(count):
        off = 84 + i * 50
        points = [struct.unpack_from('<3f', raw, off + 12 + 12 * j) for j in range(3)]
        edges = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            edges.append(math.sqrt(sum((points[a][k] - points[b][k]) ** 2 for k in range(3))))
        if min(edges) > 2e-5:
            kept.append(raw[off:off + 50])
    if not kept:
        raise ValueError('STL output contains no non-degenerate facets')
    out = bytearray(raw[:80]) + struct.pack('<I', len(kept)) + b''.join(kept)
    pathlib.Path(path).write_bytes(out)
def read_task(path):
    if pathlib.Path(path).stat().st_size > 1_000_000: raise ValueError('Task exceeds 1 MB')
    task = json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    if task.get('schema') != 'cad-task-v1' or digest(task['designJson'].encode()) != task['designSha256']: raise ValueError('Task schema or design hash mismatch')
    uuid.UUID(task['jobId']); uuid.UUID(task['projectId'])
    d = json.loads(task['designJson'])
    if d.get('schema') != 'cad-plan-v1' or d.get('units') != 'mm' or not 1 <= len(d['parts']) <= 12 or len(d['parameters']) > 64 or len(d['interfaces']) > 24: raise ValueError('CAD design limits')
    if len({p['id'] for p in d['parts']}) != len(d['parts']): raise ValueError('Duplicate part ID')
    for p in d['parts']: uuid.UUID(p['id'])
    for p in d['parameters'].values():
        if not all(type(p[k]) in (int,float) and math.isfinite(p[k]) and abs(p[k])<=10000 for k in ('value','min','max')) or not p['min']<=p['value']<=p['max']: raise ValueError('Parameter range')
    return task, d

def worker(task_path, out):
    import importlib.metadata
    if importlib.metadata.version('nlopt') != '2.9.0' or importlib.metadata.version('casadi') != '3.8.0': raise ValueError('Required compatible solver wheels: nlopt 2.9.0 / casadi 3.8.0')
    import cadquery as cq
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
    from OCP.Interface import Interface_Static
    import importlib.metadata
    if cq.__version__ != '2.8.0' or importlib.metadata.version('cadquery-ocp') != '7.9.3.1.1': raise ValueError('Required runtime: CadQuery 2.8.0 / cadquery-ocp 7.9.3.1.1')
    task,d = read_task(task_path); out=pathlib.Path(out)
    def n(v):
        if type(v) in (int,float): r=v
        elif isinstance(v,dict) and set(v)<= {'param','scale','offset'} and 'param' in v: r=d['parameters'][v['param']]['value']*v.get('scale',1)+v.get('offset',0)
        else: raise ValueError('Only numbers or parameter references permitted')
        if type(r) not in (int,float) or not math.isfinite(r) or abs(r)>10000: raise ValueError('Dimension invalid')
        return float(r)
    def vec(v):
        if not isinstance(v,list) or len(v)!=3: raise ValueError('Vector invalid')
        return tuple(n(x) for x in v)
    def positive(v):
        r=n(v)
        if r<.05: raise ValueError('Positive dimension below 0.05 mm')
        return r
    def boolean(op,a,b):
        alg={'union':BRepAlgoAPI_Fuse,'subtract':BRepAlgoAPI_Cut,'intersect':BRepAlgoAPI_Common}[op](a.wrapped,b.wrapped)
        alg.Build()
        # OCP binding exposes IsDone; null/invalid outputs are explicit failures.
        if not alg.IsDone() or (hasattr(alg,'HasErrors') and alg.HasErrors()): raise ValueError('Boolean kernel failure: '+op)
        sh=cq.Shape.cast(alg.Shape())
        if sh.isNull() or not sh.isValid(): raise ValueError('Invalid Boolean result: '+op)
        return sh
    def common_volume(a,b):
        sh=boolean('intersect',a,b)
        return sum(s.Volume() for s in sh.Solids())
    built={}; records=[]; trace=[]
    for part in d['parts']:
        if not 1<=len(part['features'])<=32: raise ValueError('Feature budget')
        features={}
        for f in part['features']:
            fid=f['id']; op=f['op']
            if fid in features: raise ValueError('Duplicate feature ID')
            if op=='box': sh=cq.Solid.makeBox(*(positive(v) for v in f['size']),pnt=vec(f['origin']))
            elif op=='cylinder': sh=cq.Solid.makeCylinder(positive(f['radius']),positive(f['height']),pnt=vec(f['origin']),dir={'X':(1,0,0),'Y':(0,1,0),'Z':(0,0,1)}[f['axis']])
            elif op=='sphere': sh=cq.Solid.makeSphere(positive(f['radius']),pnt=vec(f['origin']),angleDegrees1=-90,angleDegrees2=90)
            elif op=='profile_extrude':
                if f.get('plane') not in ('XY','XZ','YZ') or not isinstance(f.get('points'),list) or not 3<=len(f['points'])<=24: raise ValueError('Profile definition invalid')
                points=[]
                for point in f['points']:
                    if not isinstance(point,list) or len(point)!=2: raise ValueError('Profile point invalid')
                    points.append(tuple(n(v) for v in point))
                if any(points[i]==points[(i+1)%len(points)] for i in range(len(points))): raise ValueError('Profile has duplicate adjacent points')
                area=sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))
                if abs(area)<.01: raise ValueError('Profile area too small or degenerate')
                sh=cq.Workplane(f['plane'],origin=vec(f['origin'])).polyline(points).close().extrude(positive(f['depth'])).val()
            elif op in ('union','subtract','intersect'): sh=boolean(op,features[f['left']],features[f['right']])
            elif op=='fillet_all': sh=features[f['input']].fillet(positive(f['radius']),features[f['input']].Edges())
            elif op=='fillet_edges':
                direction={'X':cq.Vector(1,0,0),'Y':cq.Vector(0,1,0),'Z':cq.Vector(0,0,1)}[f['axis']]
                edges=cq.selectors.ParallelDirSelector(direction).filter(features[f['input']].Edges())
                if not edges: raise ValueError('No edges match requested fillet axis')
                sh=features[f['input']].fillet(positive(f['radius']),edges)
            else: raise ValueError('Operation not in approved CAD vocabulary')
            if sh.isNull() or not sh.isValid(): raise ValueError('Invalid feature '+fid)
            features[fid]=sh; trace.append({'partId':part['id'],'featureId':fid,'operation':op,'kernelValid':True})
        sh=features[part['result']]
        if len(sh.Solids())!=1 or sh.Volume()<=1e-6: raise ValueError('Each logical part must contain one positive-volume solid')
        built[part['id']]=sh; bbox=sh.BoundingBox()
        stem=part['id']; step=out/(stem+'.step'); brep=out/(stem+'.brep'); stl=out/(stem+'.stl')
        cq.exporters.export(sh,str(step),exportType='STEP'); sh.exportBrep(str(brep))
        if not sh.exportStl(str(stl),tolerance=.05,angularTolerance=.1,ascii=False,relative=False): raise ValueError('STL export failed')
        clean_stl_degenerate(stl)
        reimport=cq.importers.importStep(str(step)).val()
        if not reimport.isValid() or len(reimport.Solids())!=1 or abs(reimport.Volume()-sh.Volume())>max(1e-5,sh.Volume()*1e-8): raise ValueError('STEP roundtrip failed')
        records.append({'id':stem,'name':part['name'],'position':vec(part['placement']),'dimensions':[bbox.xlen,bbox.ylen,bbox.zlen],'volumeMm3':sh.Volume(),'kernelValid':True,'stepRoundtrip':'valid_volume_checked'})
    gauges=[]
    for i in d['interfaces']:
        if i['kind']!='straight_bore_z': raise ValueError('Unsupported interface')
        p=next(p for p in d['parts'] if p['id']==i['partId']); f=next(f for f in p['features'] if f['id']==i['featureId'])
        if f['op']!='cylinder' or f['axis']!='Z': raise ValueError('Interface binding invalid')
        x,y=(n(v) for v in i['center']); z=n(i['zStart']); h=positive(i['length']); r=positive(i['radius']); eps=.01
        if r<=.1 or h<=.05: raise ValueError('Gauge too small')
        # Remove cap coincidence; inner void + thin outer annulus over declared span.
        origin=(x,y,z+eps); length=h-2*eps
        core=cq.Solid.makeCylinder(r-eps,length,origin)
        outer=cq.Solid.makeCylinder(r+.06,length,origin); inner=cq.Solid.makeCylinder(r+eps,length,origin)
        ring=boolean('subtract',outer,inner)
        core_volume=common_volume(built[i['partId']],core)
        ring_volume=common_volume(built[i['partId']],ring)
        passed=core_volume<=1e-6 and abs(ring_volume-ring.Volume())<=max(1e-6,ring.Volume()*1e-6)
        gauges.append({'id':i['id'],'passed':passed,'coreIntersectionMm3':core_volume,'ringMissingMm3':ring.Volume()-ring_volume,'toleranceMm':eps,'scope':'declared_straight_bore_span_only'})
        if not passed: raise ValueError('Declared bore gauge failed: '+i['id'])
    assembly=cq.Assembly(name='assembly'); placed={}
    for p in d['parts']:
        placement=vec(p['placement']); placed[p['id']]=built[p['id']].translate(placement)
        assembly.add(built[p['id']],name='part_'+p['id'].replace('-','_'),loc=cq.Location(cq.Vector(*placement)))
    assembly.export(str(out/'assembly.step'),exportType='STEP',unit='MM')
    interference=[]; ids=list(placed)
    for ix,a in enumerate(ids):
        for b in ids[ix+1:]:
            v=common_volume(placed[a],placed[b]); interference.append({'partA':a,'partB':b,'overlapVolumeMm3':v,'overlapDetected':v>1e-6})
    files={p.name:{'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size} for p in out.iterdir() if p.is_file()}
    files['design.json']={'sha256':task['designSha256'],'bytes':len(task['designJson'].encode())}; (out/'design.json').write_bytes(task['designJson'].encode())
    report={'schema':'cad-result-v1','jobId':task['jobId'],'projectId':task['projectId'],'projectRevision':task['projectRevision'],'designSha256':task['designSha256'],'executor':VERSION,'runtime':{'cadquery':cq.__version__,'ocp':importlib.metadata.version('cadquery-ocp'),'python':sys.version.split()[0],'nlopt':importlib.metadata.version('nlopt'),'casadi':importlib.metadata.version('casadi')},'files':files,'parts':records,'features':trace,'interfaces':gauges,'interference':interference,'stl':{'linearToleranceMm':.05,'relative':False,'angularToleranceRadians':.1},'verification':'unsigned_local_report','productionReady':False,'physicalValidation':'not_run','notChecked':['strength','wall_thickness','assembly_clearance','thread_fit','support_strategy','printability','actual_machine_calibration']}
    report['runtime']['exitPolicy']='normal_interpreter_shutdown'
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    for p in out.iterdir():
        with p.open('r+b') as f: os.fsync(f.fileno())

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('task'); ap.add_argument('--output',default='cad-result.zip'); ap.add_argument('--worker-output',help=argparse.SUPPRESS); args=ap.parse_args()
    if args.worker_output:
        worker(args.task,args.worker_output)
        return
    task=pathlib.Path(args.task).resolve(); read_task(task); output=pathlib.Path(args.output).resolve()
    if output.exists(): raise ValueError('Output exists; choose a new filename to preserve history')
    with tempfile.TemporaryDirectory(prefix='ai3d-cad-') as temp:
        out=pathlib.Path(temp)/'artifacts'; out.mkdir()
        result=subprocess.run([sys.executable,str(pathlib.Path(__file__).resolve()),str(task),'--worker-output',str(out)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
        if result.returncode: raise RuntimeError('CAD build failed; no result attached.\n'+result.stderr[-6000:])
        packed=pathlib.Path(temp)/'result.zip'
        with zipfile.ZipFile(packed,'w',zipfile.ZIP_DEFLATED) as z:
            for p in out.iterdir(): z.write(p,p.name)
        if packed.stat().st_size>8*1024*1024 or sum(p.stat().st_size for p in out.iterdir())>24*1024*1024: raise ValueError('Result exceeds online import budget')
        with output.open('xb') as f: f.write(packed.read_bytes())
    print(json.dumps({'result':str(output),'status':'built_not_production_validated'},ensure_ascii=False))
if __name__=='__main__':
    try: main()
    except Exception as e: print(str(e),file=sys.stderr); sys.exit(1)
