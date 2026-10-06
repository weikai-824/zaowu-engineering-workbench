"""Run one fixed Bambu reference job without sending a job to a printer.
Python 3.10+, standard library only. Usage: python run_offline.py task.zip
The result is an unsigned local execution record, never a production approval.
"""
from pathlib import Path
import argparse, hashlib, json, math, os, re, struct, subprocess, time, uuid, zipfile
from datetime import datetime, timezone
from io import BytesIO

ENGINE={'name':'Bambu Studio','version':'02.08.02.60','executableSha256':'fb04b22d21d2dd77e223c68e56b0f36302fd7b860040d553aed2608694017749','dllSha256':'d6aa10044d11d9b3fcba0d6b52ed3154b4b02897764c270c0fdcbe2cf812f85b'}
PINS={'machine.expanded.json':'06224dd580798eef8f5a72a50d9da336b6ecf01e6b37946de7e30ea23354d102','process.expanded.json':'15624f94266951c0385809163367e255184e46f259e3c307b1b7e062703d76d5','filament.expanded.json':'6173bffe81d737c62fe4eb093c6ef79a979fd0d4f28d111d9cfaa522a663ae65'}
RECIPE='bambu-x1c-pla-basic-020-cool-reference-v1'
def digest(data): return hashlib.sha256(data).hexdigest()
def now(): return datetime.now(timezone.utc).isoformat()
def require(ok,message):
    if not ok: raise ValueError(message)
def safe_zip(data,limit,entries=48):
    result={}
    with zipfile.ZipFile(BytesIO(data)) as z:
        infos=z.infolist(); require(0<len(infos)<=entries,'ZIP entry count exceeds limit')
        total=0;seen=set()
        for info in infos:
            name=info.filename
            require(name and not name.startswith('/') and '\\' not in name and ':' not in name and not any(x in ('.','..') for x in name.split('/')) and not any(ord(x)<32 for x in name),'Unsafe ZIP path')
            require(name.lower() not in seen,'Duplicate ZIP path');seen.add(name.lower())
            require(not info.flag_bits&1 and info.compress_type in (0,8) and ((info.external_attr>>16)&0xf000)!=0xa000,'Unsupported ZIP entry')
            total+=info.file_size; require(total<=limit,'ZIP expanded size exceeds limit')
            if info.is_dir(): continue
            with z.open(info) as src:
                content=bytearray()
                while True:
                    chunk=src.read(min(65536,limit-len(content)+1))
                    if not chunk: break
                    require(len(content)+len(chunk)<=info.file_size and len(content)+len(chunk)<=limit,'ZIP actual size exceeds limit')
                    content.extend(chunk)
                require(len(content)==info.file_size,'ZIP entry size mismatch')
                result[name]=bytes(content)
    return result
def binary_stl(data):
    require(134<=len(data)<=20*1024*1024,'STL file size exceeds limit')
    count=struct.unpack_from('<I',data,80)[0];require(84+50*count==len(data) and count>0,'Invalid binary STL')
    minimum=[math.inf]*3;maximum=[-math.inf]*3
    for i in range(count):
        for v in range(3):
            for k,x in enumerate(struct.unpack_from('<3f',data,84+50*i+12+12*v)):
                require(math.isfinite(x) and abs(x)<=100000,'Invalid STL coordinate')
                minimum[k]=min(minimum[k],x);maximum[k]=max(maximum[k],x)
    dimensions=[maximum[k]-minimum[k] for k in range(3)]
    require(all(0<x<=240 for x in dimensions),'Reference job dimensions must be within 240 mm')
    return count,dimensions
def execute(packet,output_dir,slicer):
    require(os.name=='nt','This pinned runner currently supports Windows only')
    require(packet.stat().st_size<=24*1024*1024,'Task ZIP exceeds 24 MB')
    files=safe_zip(packet.read_bytes(),24*1024*1024,12)
    require(set(files)=={'manifest.json','manifest.sha256','input.stl',*PINS},'Unexpected task files')
    manifest_bytes=files['manifest.json'];manifest=json.loads(manifest_bytes)
    require(files['manifest.sha256'].decode().strip()==digest(manifest_bytes),'Manifest hash mismatch')
    require(str(uuid.UUID(manifest['jobId']))==manifest['jobId'],'Invalid task ID')
    require(manifest['schemaVersion']==1 and manifest['purpose']=='reference_offline' and manifest['productionReady'] is False and manifest['recipeId']==RECIPE,'Unsupported recipe or execution purpose')
    require(manifest['machineInstanceId'] is None and manifest['materialLot'] is None,'Reference runner cannot attest factory bindings')
    require(manifest['engine']==ENGINE,'Engine contract mismatch')
    for name in ['input.stl',*PINS]:
        require(digest(files[name])==manifest['files'][name]['sha256'] and len(files[name])==manifest['files'][name]['bytes'],'Task file hash/length mismatch: '+name)
    for name,pin in PINS.items(): require(digest(files[name])==pin,'Unapproved preset: '+name)
    triangles,dimensions=binary_stl(files['input.stl'])
    require(manifest['geometry']['units']=='mm' and manifest['geometry']['upAxis']=='Z' and manifest['geometry']['triangles']==triangles,'Geometry contract mismatch')
    require(all(abs(x-y)<0.0001 for x,y in zip(dimensions,manifest['geometry']['dimensionsMm'])),'Geometry dimension mismatch')
    slicer=slicer.resolve(strict=True);dll=slicer.with_name('BambuStudio.dll')
    require(digest(slicer.read_bytes())==ENGINE['executableSha256'] and digest(dll.read_bytes())==ENGINE['dllSha256'],'Installed Bambu Studio differs from pinned 02.08.02.60; revalidate before updating pins')
    run_dir=(output_dir.resolve()/f"{manifest['jobId']}-{uuid.uuid4()}")
    run_dir.mkdir(parents=True,exist_ok=False)
    for name,data in files.items(): (run_dir/name).write_bytes(data)
    state=run_dir/'state';out=run_dir/'output';state.mkdir();out.mkdir()
    args=[str(slicer),'--datadir',str(state),'--load-settings',str(run_dir/'machine.expanded.json')+';'+str(run_dir/'process.expanded.json'),'--load-filaments',str(run_dir/'filament.expanded.json'),'--check-preset','--arrange','1','--allow-rotations=0','--ensure-on-bed','--slice','0','--debug','2','--mstpp','120','--outputdir',str(out),'--export-settings',str(out/'effective-settings.json'),'--export-3mf','sliced.3mf',str(run_dir/'input.stl')]
    started=now();manifest_sha=digest(manifest_bytes);dll_path=dll.resolve();(run_dir/'command.json').write_text(json.dumps({'argv':args,'startedAt':started,'action':'offline slice only','runtime':{'executablePath':str(slicer),'executableSha256':digest(slicer.read_bytes()),'dllPath':str(dll_path),'dllSha256':digest(dll.read_bytes()),'inputStlSha256':digest(files['input.stl']),'manifestSha256':manifest_sha,'presetSha256':{name:digest(files[name]) for name in PINS}}},ensure_ascii=False,indent=2),encoding='utf-8')
    log=run_dir/'process-log.txt'
    with log.open('wb') as stream:
        process=subprocess.Popen(args,cwd=run_dir,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        try: exit_code=process.wait(timeout=240)
        except subprocess.TimeoutExpired:
            process.kill();process.wait();raise RuntimeError('Slicer timeout; no successful result was emitted')
    finished=now();require(exit_code==0,'Slicer process returned nonzero; inspect local process-log.txt')
    require((out/'result.json').exists() and (out/'sliced.3mf').exists(),'Slicer did not complete expected output; no result was emitted')
    summary=json.loads((out/'result.json').read_text(encoding='utf-8-sig'))
    require(summary.get('return_code')==0 and len(summary.get('sliced_plates',[]))==1,'Slicer did not report one successful plate')
    plate=summary['sliced_plates'][0];require(len(plate.get('objects',[]))==1,'Expected one object')
    obj=plate['objects'][0]
    require(obj['triangle_count']==triangles and all(abs(obj['bbox'][key]-dimensions[i])<.15 for i,key in enumerate(('width','depth','height'))),'Slicer geometry summary differs from input')
    require((out/'sliced.3mf').stat().st_size<=8*1024*1024,'3MF exceeds current import limit');archive=(out/'sliced.3mf').read_bytes()
    inner=safe_zip(archive,12*1024*1024)
    require('Metadata/plate_1.gcode' in inner and 'Metadata/project_settings.config' in inner,'3MF lacks G-code or settings')
    effective=(out/'effective-settings.json').read_bytes()
    require(json.loads(effective)==json.loads(inner['Metadata/project_settings.config']),'Embedded and exported effective settings differ')
    gcode=inner['Metadata/plate_1.gcode'].decode('utf-8')
    layers=re.search(r'; total layer number:\s*(\d+)',gcode)
    require(layers and int(layers[1])>0 and '; BambuStudio '+ENGINE['version'] in gcode,'Invalid G-code layer/header')
    artifacts={'sliced.3mf':archive,'effective-settings.json':effective,'slicer-result.json':(out/'result.json').read_bytes()}
    with log.open('rb') as stream:
        stream.seek(-min(log.stat().st_size,500000),os.SEEK_END);rawlog=stream.read(500000)
    runtime_evidence={'schemaVersion':1,'executablePath':str(slicer),'executableSha256':digest(slicer.read_bytes()),'dllPath':str(dll_path),'dllSha256':digest(dll.read_bytes()),'inputStlSha256':digest(files['input.stl']),'manifestSha256':manifest_sha,'presetSha256':{name:digest(files[name]) for name in PINS},'argv':args,'startedAt':started,'finishedAt':finished,'exitCode':exit_code,'consoleCapture':'stdout+stderr combined; the Windows launcher emitted no bytes to the redirected stream' if not rawlog else 'stdout+stderr combined','capturedConsoleBytes':len(rawlog),'generatedFiles':{'sliced.3mf':{'path':str(out/'sliced.3mf'),'sha256':digest(archive),'bytes':len(archive)},'effective-settings.json':{'path':str(out/'effective-settings.json'),'sha256':digest(effective),'bytes':len(effective)},'slicer-result.json':{'path':str(out/'result.json'),'sha256':digest(artifacts['slicer-result.json']),'bytes':len(artifacts['slicer-result.json'])},'Metadata/plate_1.gcode':{'path':'sliced.3mf!Metadata/plate_1.gcode','sha256':digest(inner['Metadata/plate_1.gcode']),'bytes':len(inner['Metadata/plate_1.gcode'])},'Metadata/project_settings.config':{'path':'sliced.3mf!Metadata/project_settings.config','sha256':digest(inner['Metadata/project_settings.config']),'bytes':len(inner['Metadata/project_settings.config'])}}}
    artifacts['process-log.txt']=(json.dumps({'runtimeEvidence':runtime_evidence},ensure_ascii=False,indent=2)+'\n--- redirected stdout+stderr ---\n').encode('utf-8')+rawlog
    report={'schemaVersion':1,'jobId':manifest['jobId'],'manifestSha256':manifest_sha,'inputSha256':digest(files['input.stl']),'engine':ENGINE,'exitCode':exit_code,'startedAt':started,'finishedAt':finished,'files':{n:{'sha256':digest(b),'bytes':len(b)} for n,b in artifacts.items()},'runtimeEvidence':runtime_evidence,'executionAttestation':'unsigned_local_report','productionReady':False,'physicalValidation':'not_run'}
    artifacts['report.json']=json.dumps(report,ensure_ascii=False,indent=2).encode('utf-8')
    result=run_dir/'offline-result.zip'
    with zipfile.ZipFile(result,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name,data in artifacts.items(): z.writestr(name,data)
    require(result.stat().st_size<=8*1024*1024,'Result exceeds current import limit; retained locally')
    print(json.dumps({'result':str(result),'jobId':manifest['jobId'],'layers':int(layers[1]),'estimatedSeconds':plate['total_predication'],'physicalValidation':'not_run','productionReady':False},ensure_ascii=False))
    return result
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('packet',type=Path);parser.add_argument('--output-dir',type=Path,default=Path.cwd()/'offline-runs');parser.add_argument('--slicer',type=Path,default=Path('C:/Program Files/Bambu Studio/bambu-studio.exe'))
    a=parser.parse_args()
    try: execute(a.packet,a.output_dir,a.slicer)
    except Exception as error: parser.exit(1,'Offline slice failed: '+str(error)+'\n')
