'use client';
import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Box,ChevronDown,Focus,Layers3,LockKeyhole,Rotate3D,ScanLine} from 'lucide-react';
import {assembly,type ModelMap} from '@/lib/geometry';
import {manufacturingParts,processLabels,type Project} from '@/lib/engineering';
import {privateParameterPreview,privateProcessSet,profiles} from '@/lib/private-process-library';
import OutputProcessPicker from './output-process-picker';

type View='iso'|'front'|'top';
const accent=['#68e0bf','#e5ba76','#7bb7ee','#d0a8ee','#f39b8b','#a5d7a7'];
function displayValue(value:unknown){return typeof value==='boolean'?(value?'开启':'关闭'):Array.isArray(value)?value.join(' × '):value&&typeof value==='object'?Object.values(value as Record<string,unknown>).join(' – '):String(value??'—');}

export default function OutputDiagram({project,models,selected,onSelect,onAssignProfile}:{project:Project;models:ModelMap;selected:string;onSelect:(id:string)=>void;onAssignProfile:(partId:string,profileId:string)=>Promise<void>}){
 const parts=useMemo(()=>manufacturingParts(project),[project]),diagram=useRef<HTMLDivElement>(null),canvas=useRef<HTMLDivElement>(null),links=useRef<SVGSVGElement>(null),cameraRef=useRef<THREE.PerspectiveCamera|null>(null),controlsRef=useRef<OrbitControls|null>(null),centerRef=useRef(new THREE.Vector3()),spanRef=useRef(100),selectedRef=useRef(selected);
 const[exploded,setExploded]=useState(true),[view,setView]=useState<View>('iso'),[error,setError]=useState(''),[hovered,setHovered]=useState<string|null>(null),[picker,setPicker]=useState<{partId:string;mode:'machine'|'material'}|null>(null);
 const activePart=hovered??selected;
 useEffect(()=>{selectedRef.current=activePart;},[activePart]);
 useEffect(()=>{const list=diagram.current?.querySelector<HTMLElement>('.output-map-list'),card=list?.querySelector<HTMLElement>(`[data-output-part="${selected}"]`);if(!list||!card)return;const listRect=list.getBoundingClientRect(),cardRect=card.getBoundingClientRect();if(cardRect.top<listRect.top||cardRect.bottom>listRect.bottom){list.scrollTo({top:list.scrollTop+cardRect.top-listRect.top-(listRect.height-cardRect.height)/2,behavior:'smooth'});}},[selected]);
 useEffect(()=>{const camera=cameraRef.current,controls=controlsRef.current;if(!camera||!controls)return;const center=centerRef.current,span=spanRef.current;const direction=view==='front'?new THREE.Vector3(0,-2.25,.58):view==='top'?new THREE.Vector3(.01,-.01,2.6):new THREE.Vector3(1.2,-1.65,1.08);camera.position.copy(center).add(direction.normalize().multiplyScalar(span*2.35));controls.target.copy(center);controls.update();},[view,exploded]);
 useEffect(()=>{
  const surface=canvas.current,frame=diagram.current,overlay=links.current;if(!surface||!frame||!overlay||!parts.length)return;
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}catch{queueMicrotask(()=>setError('当前浏览器暂时无法显示三维模型，请检查硬件加速。'));return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.28;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;surface.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(31,1,.1,100000);camera.up.set(0,0,1);cameraRef.current=camera;
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.enablePan=false;controls.minDistance=8;controls.maxDistance=3000;controlsRef.current=controls;
  const body=new THREE.Group();let model:THREE.Group;
  try{model=assembly({...project,parts},models);body.add(model);scene.add(body);queueMicrotask(()=>setError(''));}catch(cause){queueMicrotask(()=>setError(cause instanceof Error?cause.message:String(cause)));controls.dispose();renderer.dispose();surface.replaceChildren();cameraRef.current=null;controlsRef.current=null;return;}
  const original=new THREE.Box3().setFromObject(model),originalSpan=Math.max(...original.getSize(new THREE.Vector3()).toArray(),25);
  const nodes=new Map<string,THREE.Object3D>(),partById=new Map(parts.map(part=>[part.id,part])),boxVolume=(node:THREE.Object3D)=>{const size=new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3());return size.x*size.y*size.z;},baseNode=model.children.reduce<THREE.Object3D|undefined>((largest,node)=>!largest||boxVolume(node)>boxVolume(largest)?node:largest,undefined),satellites=model.children.filter(node=>node!==baseNode);model.children.forEach(child=>{const id=String(child.userData.partId??'');nodes.set(id,child);if(!exploded||child===baseNode)return;const order=satellites.indexOf(child),name=(partById.get(id)?.name??'').toLowerCase();let offset:THREE.Vector3;if(/display|visor|front|glass/.test(name))offset=new THREE.Vector3(-.12,-.36,.42);else if(/service|rear|vent|cover|louver/.test(name))offset=new THREE.Vector3(.14,.3,.76);else if(/plinth|foot|feet|support|under/.test(name))offset=new THREE.Vector3(-.08,.08,-.44);else{const angle=-2.25+order*2.399,radius=.3+.06*(order%2);offset=new THREE.Vector3(Math.cos(angle)*radius,Math.sin(angle)*radius,.38+order*.24);}child.position.addScaledVector(offset,originalSpan);});
  model.updateMatrixWorld(true);const anchors=new Map([...nodes].map(([id,node])=>[id,new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3())]));const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3()),span=Math.max(...bounds.getSize(new THREE.Vector3()).toArray(),25);centerRef.current=center;spanRef.current=span;
  scene.add(new THREE.HemisphereLight(0xf3fcff,0x344957,2.3));const key=new THREE.DirectionalLight(0xffffff,5.5);key.position.copy(center).add(new THREE.Vector3(-span, -span*1.3,span*1.9));key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-span*2;key.shadow.camera.right=span*2;key.shadow.camera.top=span*2;key.shadow.camera.bottom=-span*2;key.shadow.bias=-.00012;scene.add(key);const rim=new THREE.DirectionalLight(0x93e8dd,2.2);rim.position.copy(center).add(new THREE.Vector3(span,span,span));scene.add(rim);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(span*4,span*4),new THREE.ShadowMaterial({opacity:.21}));floor.position.set(center.x,center.y,bounds.min.z-span*.26);floor.receiveShadow=true;scene.add(floor);
  const grid=new THREE.GridHelper(span*3,18,0x3b7675,0x31565e);grid.rotation.x=Math.PI/2;grid.position.set(center.x,center.y,bounds.min.z-span*.265);const gridMaterials=Array.isArray(grid.material)?grid.material:[grid.material];gridMaterials.forEach(material=>{material.transparent=true;material.opacity=.16;});scene.add(grid);
  const markers=new Map<string,{path:SVGPathElement;dot:SVGCircleElement;halo:SVGCircleElement;label:SVGTextElement}>();
  for(const [index,part] of parts.entries()){const group=document.createElementNS('http://www.w3.org/2000/svg','g'),path=document.createElementNS('http://www.w3.org/2000/svg','path'),halo=document.createElementNS('http://www.w3.org/2000/svg','circle'),dot=document.createElementNS('http://www.w3.org/2000/svg','circle'),label=document.createElementNS('http://www.w3.org/2000/svg','text');path.setAttribute('fill','none');halo.setAttribute('r','16');dot.setAttribute('r','4');label.textContent=String(index+1).padStart(2,'0');label.setAttribute('text-anchor','middle');label.setAttribute('dominant-baseline','middle');label.setAttribute('font-size','10');label.setAttribute('font-weight','800');group.appendChild(path);group.appendChild(halo);group.appendChild(dot);group.appendChild(label);overlay.appendChild(group);markers.set(part.id,{path,dot,halo,label});}
  const direction=new THREE.Vector3(view==='front'?0:view==='top'?.01:1.2,view==='front'?-2.25:view==='top'?-.01:-1.65,view==='front'?.58:view==='top'?2.6:1.08).normalize();camera.position.copy(center).add(direction.multiplyScalar(span*2.35));controls.target.copy(center);controls.update();
  const resize=()=>{const width=surface.clientWidth,height=surface.clientHeight;if(width&&height){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}overlay.setAttribute('viewBox',`0 0 ${frame.clientWidth} ${frame.clientHeight}`);};const observer=new ResizeObserver(resize);observer.observe(surface);observer.observe(frame);resize();
  let raf=0;
  const draw=()=>{
   controls.update();
   renderer.render(scene,camera);
   const sceneRect=surface.getBoundingClientRect(),frameRect=frame.getBoundingClientRect(),listRect=frame.querySelector('.output-map-list')?.getBoundingClientRect();
   const stageRight=sceneRect.right-frameRect.left;
   for(const [index,part] of parts.entries()){
    const marker=markers.get(part.id)!,node=nodes.get(part.id),card=frame.querySelector<HTMLElement>('[data-output-part="'+part.id+'"]');
    if(!node||!card){for(const element of Object.values(marker))element.style.display='none';continue;}
    const screen=anchors.get(part.id)!.clone().project(camera);
    const x=sceneRect.left-frameRect.left+(screen.x+1)*sceneRect.width/2;
    const y=sceneRect.top-frameRect.top+(1-screen.y)*sceneRect.height/2;
    const valid=screen.z<1&&x>0&&x<stageRight&&y>0&&y<sceneRect.bottom-frameRect.top;
    const active=selectedRef.current===part.id,color=accent[index%accent.length];
    marker.halo.style.display=valid?'':'none';
    marker.label.style.display=valid?'':'none';
    if(!valid){marker.path.style.display='none';marker.dot.style.display='none';continue;}
    marker.halo.setAttribute('cx',String(x));marker.halo.setAttribute('cy',String(y));
    marker.halo.setAttribute('fill',active?'#123d42':'#1c303b');
    marker.halo.setAttribute('stroke',color);marker.halo.setAttribute('stroke-width',active?'2':'1');
    marker.halo.setAttribute('opacity',active?'1':'.66');
    marker.label.setAttribute('x',String(x));marker.label.setAttribute('y',String(y));
    marker.label.setAttribute('fill','#f7ffff');marker.label.setAttribute('opacity',active?'1':'.72');
    const cardRect=card.getBoundingClientRect(),endX=cardRect.left-frameRect.left,endY=cardRect.top-frameRect.top+cardRect.height/2;
    const cardVisible=!!listRect&&endY>=listRect.top-frameRect.top&&endY<=listRect.bottom-frameRect.top;
    marker.path.style.display=active&&cardVisible?'':'none';
    marker.dot.style.display=active&&cardVisible?'':'none';
    if(!active||!cardVisible)continue;
    const laneX=stageRight+(endX-stageRight)/2,direction=endY>=y?1:-1,radius=Math.min(10,Math.abs(endY-y)/2);
    const route=Math.abs(endY-y)<12?'M '+x.toFixed(1)+' '+y.toFixed(1)+' L '+endX.toFixed(1)+' '+endY.toFixed(1):'M '+x.toFixed(1)+' '+y.toFixed(1)+' H '+(laneX-radius).toFixed(1)+' Q '+laneX.toFixed(1)+' '+y.toFixed(1)+' '+laneX.toFixed(1)+' '+(y+direction*radius).toFixed(1)+' V '+(endY-direction*radius).toFixed(1)+' Q '+laneX.toFixed(1)+' '+endY.toFixed(1)+' '+(laneX+radius).toFixed(1)+' '+endY.toFixed(1)+' H '+endX.toFixed(1);
    marker.path.setAttribute('d',route);marker.path.setAttribute('stroke',color);marker.path.setAttribute('stroke-width','2');marker.path.setAttribute('opacity','.94');
    marker.dot.setAttribute('cx',String(endX));marker.dot.setAttribute('cy',String(endY));marker.dot.setAttribute('fill',color);
   }
   raf=requestAnimationFrame(draw);
  };
  draw();
  const raycaster=new THREE.Raycaster();let start:[number,number]=[0,0];const pointerDown=(event:PointerEvent)=>{start=[event.clientX,event.clientY];};const pointerUp=(event:PointerEvent)=>{if(Math.hypot(event.clientX-start[0],event.clientY-start[1])>5)return;const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-((event.clientY-rect.top)/rect.height*2-1)),camera);const hit=raycaster.intersectObjects(model.children,true)[0];let owner:THREE.Object3D|null=hit?.object??null;while(owner&&!owner.userData.partId)owner=owner.parent;if(owner?.userData.partId)onSelect(String(owner.userData.partId));};renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
  return()=>{cancelAnimationFrame(raf);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);controls.dispose();renderer.dispose();scene.clear();surface.replaceChildren();overlay.replaceChildren();cameraRef.current=null;controlsRef.current=null;};
 },[project,models,parts,exploded,view,onSelect]);
 const assigned=parts.filter(part=>profiles.some(profile=>profile.id===part.profileId)).length;
 const pickerPart=picker?parts.find(part=>part.id===picker.partId):undefined;
 return <section className="output-diagram" ref={diagram} aria-label="零件与制造资源映射">
  <div className="output-stage"><div className="output-stage-top"><span><ScanLine size={16}/> ASSEMBLY / {exploded?'EXPLODED':'ASSEMBLED'}</span><span>{parts.length} PARTS · mm</span></div><div className="output-stage-canvas" ref={canvas}/><div className="output-stage-controls"><div className="output-view-switch"><button className={exploded?'active':''} onClick={()=>setExploded(!exploded)} type="button"><Layers3 size={14}/>{exploded?'爆炸视图':'装配视图'}</button><button onClick={()=>setView('iso')} className={view==='iso'?'active':''} type="button"><Rotate3D size={14}/>45°</button><button onClick={()=>setView('front')} className={view==='front'?'active':''} type="button">正面</button><button onClick={()=>setView('top')} className={view==='top'?'active':''} type="button">俯视</button></div><span>拖动旋转 · 点击零件 / 悬停卡片查看映射</span></div>{error&&<div className="output-view-error">{error}</div>}{!parts.length&&<div className="output-view-empty"><Box size={42}/><strong>等待制造零件</strong><span>先在设计工坊中添加可制造零件，再查看结构分解图。</span></div>}</div>
  <div className="output-map"><div className="output-map-head"><div><span className="output-kicker">PRIVATE PROCESS MAPPING</span><h2>零件制造映射</h2><p>逐件绑定设备、工艺、耗材与私有参数集</p></div><span className="output-map-count">{assigned}/{parts.length} 已绑定</span></div><div className="output-map-list">{parts.map((part,index)=>{const profile=profiles.find(item=>item.id===part.profileId),privateSet=profile?privateProcessSet(profile):null,parameters=profile?privateParameterPreview(profile,project.processConfiguration):[],projectCopy=profile&&project.processConfiguration?.profileId===profile.id;return <article key={part.id} data-output-part={part.id} onMouseEnter={()=>setHovered(part.id)} onMouseLeave={()=>setHovered(null)} className={'output-part-card'+(activePart===part.id?' active':'')} style={{'--part-accent':accent[index%accent.length]} as CSSProperties}><span className="output-part-index">{String(index+1).padStart(2,'0')}</span><span className="output-part-content"><button type="button" className="output-part-title" onClick={()=>onSelect(part.id)} onFocus={()=>setHovered(part.id)} onBlur={()=>setHovered(null)}><strong>{part.name}</strong><Focus size={15}/></button><span className="output-part-process">{profile?`${processLabels[profile.process]??profile.process} · ${privateSet?.id}`:'私有工艺组合待分配'}</span><span className="output-part-grid"><button type="button" className="output-part-choice" onClick={()=>{onSelect(part.id);setPicker({partId:part.id,mode:'machine'});}}><small>制造设备</small><b>{profile?.machine??'请选择'}</b><ChevronDown size={13}/></button><button type="button" className="output-part-choice" onClick={()=>{onSelect(part.id);setPicker({partId:part.id,mode:'material'});}}><small>适用耗材</small><b>{profile?.material??'请选择'}</b><ChevronDown size={13}/></button></span><span className="output-part-parameters"><small>私有参数集</small><LockKeyhole size={11}/><b>{privateSet?`${privateSet.name} · ${privateSet.version}`:'待绑定'}</b><em>{projectCopy?'项目副本':privateSet?.status??''}</em></span>{parameters.length>0&&<span className="output-part-chips">{parameters.map(parameter=><em key={parameter.name}>{parameter.name} {displayValue(parameter.value)}{parameter.unit}</em>)}</span>}</span></article>;})}{!parts.length&&<p className="output-map-empty">尚无可制造零件。外观参考资产不会加入制造映射。</p>}</div><p className="output-map-foot"><LockKeyhole size={12}/> 设备、耗材与参数集来自同一条私有组合；修改后会保存到项目版本。</p></div><svg ref={links} className="output-connectors" aria-hidden="true"/>
  {picker&&pickerPart&&<OutputProcessPicker partName={pickerPart.name} currentProfileId={pickerPart.profileId} mode={picker.mode} open onOpenChange={open=>{if(!open)setPicker(null);}} onConfirm={profileId=>onAssignProfile(pickerPart.id,profileId)}/>}
 </section>;
}
