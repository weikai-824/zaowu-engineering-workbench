'use client';

import {useEffect,useState,type ReactNode} from 'react';
import {AlertCircle,BrainCircuit,Cable,Check,CheckCircle2,Clock3,Cpu,Layers3,Loader2,Play,RotateCcw,Workflow,XCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import './connection-showcase.css';

export type ConnectionState={
  localDemo?:boolean;
  agent?:{configured:boolean;state:string};
  ai:{configured:boolean;model:string|null;provider?:string;state?:string;previouslyVerified?:boolean};
  tripo:{configured:boolean;version?:string;region?:string;model?:string;capabilities?:string[]};
  engineering:{configured:boolean;executor:string;state:string;currentlyConnected?:boolean;previouslyVerified?:boolean};
  slicing:{configured:boolean;engine:string;version:string;executable:boolean;state:string;currentlyConnected?:boolean;previouslyVerified?:boolean;currentStatus?:string};
};

type TripoDiagnostic={baseUrl:string;model:string;balance:number;frozen:number;usage?:{tasks:number;credits:number;source:string};checkedAt:string};
type AiDiagnostic={provider:string;model:string;responseModel:string|null;latencyMs:number;checkedAt:string};
type ExecutorDiagnostic={connected:boolean;deviceLabel?:string;detail:string};
type TestTone='passed'|'ready'|'history'|'pending'|'failed';
type TestItem={id:string;name:string;tone:TestTone;detail:string};
type TestReport={checkedAt:string;items:TestItem[]};

type Props={
  connections:ConnectionState|null;
  connectionError:string;
  executorConnected:boolean;
  busy:boolean;
  onCheckExecutor:()=>Promise<ExecutorDiagnostic>;
};

type Tool={id:string;name:string};
const modeling:Array<{label:string;tools:Tool[]}>= [
  {label:'贴图与布线',tools:[{id:'blender',name:'Blender'},{id:'3ds-max-routing',name:'3ds Max'}]},
  {label:'硬表面建模',tools:[{id:'creo',name:'Creo'},{id:'fusion-360',name:'Fusion 360'},{id:'solidworks',name:'SolidWorks'}]},
  {label:'软表面建模',tools:[{id:'zbrush',name:'ZBrush'},{id:'3ds-max-surface',name:'3ds Max'},{id:'maya',name:'Maya'}]},
  {label:'打印预处理',tools:[{id:'magics',name:'Materialise Magics 24.0'}]},
];

const slicing:Array<{label:string;tools:Tool[]}>= [
  {label:'FDM 切片',tools:[{id:'bambu-studio',name:'Bambu Studio'},{id:'orca-slicer',name:'Orca Slicer'}]},
  {label:'SLA 切片',tools:[{id:'uniontech-slicer',name:'联泰 Slicer'}]},
  {label:'金属 / 全彩切片',tools:[{id:'device-matched-slicer',name:'按设备型号匹配'}]},
];
const namedIndustrialTools=[...modeling,...slicing].flatMap(group=>group.tools);
const coreVersions=[
  {version:'12.3',scope:'新项目目标'},
  {version:'11.0',scope:'现有项目目标'},
  {version:'10.0.3',scope:'旧工程目标'},
] as const;
type CoreVersion=(typeof coreVersions)[number]['version'];
const coreStorageKey='3dprinthub.targetCoreVersion';

const toneLabels:Record<TestTone,string>={passed:'已通过',ready:'可用',history:'历史验证',pending:'待接入',failed:'未通过'};

async function connectionApi<T>(url:string,init?:RequestInit):Promise<T>{
  const response=await fetch(url,init);
  const body=await response.json().catch(()=>({})) as {error?:unknown};
  if(!response.ok)throw Error(typeof body.error==='string'?body.error:'连接测试未完成。');
  return body as T;
}

async function settled<T>(promise:Promise<T>):Promise<{ok:true;value:T}|{ok:false;error:string}>{
  try{return {ok:true,value:await promise};}catch(error){return {ok:false,error:error instanceof Error?error.message:String(error)};}
}

function Status({kind,children}:{kind:'live'|'history'|'ready'|'plan';children:ReactNode}){
  return <span className={'connection-status connection-status-'+kind}><span className="connection-status-dot"/>{children}</span>;
}

function ToneBadge({tone}:{tone:TestTone}){
  return <span className={'connection-result-badge '+tone}>{tone==='passed'?<CheckCircle2 size={13}/>:tone==='failed'?<XCircle size={13}/>:tone==='pending'?<Clock3 size={13}/>:<AlertCircle size={13}/>} {toneLabels[tone]}</span>;
}

function IntegrationReport({report,running}:{report:TestReport|null;running:boolean}){
  if(running)return <div className="connection-report running" role="status"><Loader2 size={17}/><div><strong>正在逐项检查连接链路</strong><p>测试结果返回后会在这里按连接器展示。</p></div></div>;
  if(!report)return null;
  const passed=report.items.filter(item=>item.tone==='passed').length;
  const available=report.items.filter(item=>item.tone==='ready'||item.tone==='history').length;
  const pending=report.items.filter(item=>item.tone==='pending').length;
  const failed=report.items.filter(item=>item.tone==='failed').length;
  return <div className="connection-report" role="status" aria-live="polite">
    <div className="connection-report-head"><div><strong>集成测试结果</strong><p>{passed} 项通过 · {available} 项可用或已验证 · {pending} 项待接入{failed?` · ${failed} 项未通过`:''}</p></div><time>{new Date(report.checkedAt).toLocaleString()}</time></div>
    <div className="connection-report-grid">{report.items.map(item=><div className={'connection-report-item '+item.tone} key={item.id}><ToneBadge tone={item.tone}/><strong>{item.name}</strong><p>{item.detail}</p></div>)}</div>
  </div>;
}

function pendingTool(tool:Tool):TestItem{return {id:tool.id,name:tool.name,tone:'pending',detail:'连接适配器尚未接入，当前可先选择并查看规划状态。'};}

export default function ConnectionShowcase({connections,connectionError,executorConnected,busy,onCheckExecutor}:Props){
  const[selectedCore,setSelectedCore]=useState<CoreVersion>('12.3');
  const[selectedIndustrial,setSelectedIndustrial]=useState('cad-executor');
  const[selectedAi,setSelectedAi]=useState('ai-3d');
  const[refreshedConnections,setRefreshedConnections]=useState<ConnectionState|null>(null);
  const[testing,setTesting]=useState<'ai'|'industrial'|null>(null);
  const[aiReport,setAiReport]=useState<TestReport|null>(null);
  const[industrialReport,setIndustrialReport]=useState<TestReport|null>(null);
  useEffect(()=>{let frame=0;try{const saved=localStorage.getItem(coreStorageKey);if(coreVersions.some(item=>item.version===saved))frame=requestAnimationFrame(()=>setSelectedCore(saved as CoreVersion));}catch{}return()=>cancelAnimationFrame(frame);},[]);
  const chooseCore=(version:CoreVersion)=>{setSelectedCore(version);try{localStorage.setItem(coreStorageKey,version);}catch{}};
  const currentConnections=refreshedConnections??connections;
  const ai=currentConnections?.ai;
  const tripo=currentConnections?.tripo;
  const engineering=currentConnections?.engineering;
  const slice=currentConnections?.slicing;
  const cadState=executorConnected?'当前已连接':engineering?.previouslyVerified?'历史已验证':'可本机配对';
  const sliceState=slice?.executable?'当前可执行':slice?.previouslyVerified?'历史已验证':'可导入离线结果';

  const runAiTest=async()=>{
    setTesting('ai');
    try{
      let snapshot=currentConnections,matrixError='';
      try{snapshot=await connectionApi<ConnectionState>('/api/connections');setRefreshedConnections(snapshot);}catch(error){matrixError=error instanceof Error?error.message:String(error);}
      const[generic,tripoTest]=await Promise.all([
        snapshot?.ai.configured?settled(connectionApi<AiDiagnostic>('/api/ai/diagnostics',{method:'POST'})):Promise.resolve(null),
        snapshot?.tripo.configured?settled(connectionApi<TripoDiagnostic>('/api/tripo/diagnostics')):Promise.resolve(null),
      ]);
      const genericItem=(id:string,name:string,shared=false):TestItem=>!snapshot?{id,name,tone:'failed',detail:matrixError||'无法读取连接配置。'}:!snapshot.ai.configured?{id,name,tone:'pending',detail:'尚未配置通用 AI 接口、模型或服务端密钥。'}:generic?.ok?{id,name,tone:'passed',detail:`${shared?'共享推理链路':'最小响应探测'}已通过 · ${generic.value.provider} · ${generic.value.responseModel??generic.value.model} · ${generic.value.latencyMs} ms`}:{id,name,tone:'failed',detail:generic?.error??'通用 AI 探测失败。'};
      const tripoItem:TestItem=!snapshot?{id:'ai-3d',name:'三维方案生成',tone:'failed',detail:matrixError||'无法读取连接配置。'}:!snapshot.tripo.configured?{id:'ai-3d',name:'三维方案生成',tone:'pending',detail:'Tripo API Key 尚未配置。'}:tripoTest?.ok?{id:'ai-3d',name:'三维方案生成',tone:'passed',detail:`Tripo ${tripoTest.value.model} · 可用额度 ${tripoTest.value.balance.toFixed(2)} · ${tripoTest.value.baseUrl}`}:{id:'ai-3d',name:'三维方案生成',tone:'failed',detail:tripoTest?.error??'Tripo 连接探测失败。'};
      setAiReport({checkedAt:new Date().toISOString(),items:[genericItem('ai-multimodal','多模态输入识别'),tripoItem,genericItem('ai-process','工艺选型推理',true)]});
    }finally{setTesting(null);}
  };

  const runIndustrialTest=async()=>{
    setTesting('industrial');
    try{
      const[matrix,executor]=await Promise.all([settled(connectionApi<ConnectionState>('/api/connections')),settled(onCheckExecutor())]);
      const snapshot=matrix.ok?matrix.value:currentConnections;
      if(matrix.ok)setRefreshedConnections(matrix.value);
      const executorItem:TestItem=executor.ok?{id:'cad-executor',name:'CAD 本机执行器',tone:executor.value.connected?'passed':'ready',detail:executor.value.detail}:{id:'cad-executor',name:'CAD 本机执行器',tone:'failed',detail:executor.error};
      const gatewayItem:TestItem=matrix.ok?{id:'cad-task-channel',name:'CAD 任务通道',tone:'passed',detail:'服务端连接矩阵与任务状态通道响应正常。'}:{id:'cad-task-channel',name:'CAD 任务通道',tone:'failed',detail:matrix.error};
      const bambuItem:TestItem=!snapshot?.slicing.configured?{id:'bambu-studio',name:'Bambu Studio',tone:'pending',detail:'离线切片连接器尚未配置。'}:snapshot.slicing.executable?{id:'bambu-studio',name:'Bambu Studio',tone:'passed',detail:`${snapshot.slicing.version} 当前可执行。`}:snapshot.slicing.previouslyVerified?{id:'bambu-studio',name:'Bambu Studio',tone:'history',detail:`${snapshot.slicing.version} 已有离线一致性验证记录。`}:{id:'bambu-studio',name:'Bambu Studio',tone:'ready',detail:`${snapshot.slicing.version} 离线任务包可用，需在本机运行后回传结果。`};
      const tools=namedIndustrialTools.map(tool=>tool.id==='bambu-studio'?bambuItem:pendingTool(tool));
      setIndustrialReport({checkedAt:new Date().toISOString(),items:[executorItem,gatewayItem,...tools]});
    }finally{setTesting(null);}
  };

  const selectedIndustrialItem=industrialReport?.items.find(item=>item.id===selectedIndustrial)??(selectedIndustrial==='cad-executor'?{id:'cad-executor',name:'CAD 本机执行器',tone:executorConnected?'passed':engineering?.previouslyVerified?'history':'ready',detail:executorConnected?'本页已连接本机执行器，可进行实时状态检查。':engineering?.previouslyVerified?'已有成功执行记录；本页当前未连接。':'等待通过配对码连接本机执行器。'}:selectedIndustrial==='bambu-studio'?{id:'bambu-studio',name:'Bambu Studio',tone:slice?.previouslyVerified?'history':'ready',detail:`${slice?.version??'02.08.02.60'} 离线切片链路。`}:pendingTool(namedIndustrialTools.find(tool=>tool.id===selectedIndustrial)??{id:selectedIndustrial,name:'工业工具'}));
  const aiSelections={
    'ai-multimodal':{name:'多模态输入识别',detail:'文字、图片与工程约束的统一输入链路。'},
    'ai-3d':{name:'三维方案生成',detail:'Tripo 三维候选生成与任务追踪链路。'},
    'ai-process':{name:'工艺选型推理',detail:'设备、材料与成形工艺的工程推理链路。'},
  } as const;
  const selectedAiItem=aiReport?.items.find(item=>item.id===selectedAi);

  return <div className="connection-showcase">
    <header className="connection-hero">
      <div className="connection-hero-copy"><span className="connection-eyebrow">INTEGRATION MATRIX · 01 / 03</span><h1>连接设置</h1><p>从 3DPrintHub Core 到工业建模、切片和 AI 服务，按制造链路查看当前能力与扩展方向。</p></div>
      <div className="connection-hero-mark" aria-hidden="true"><Workflow size={56} strokeWidth={1.25}/><span>3D<span>PRINT</span>HUB</span></div>
    </header>

    {connectionError&&<div className="connection-alert"><p>{connectionError}</p><a href="/signin-with-chatgpt?return_to=/" target="_top">登录工作区</a></div>}

    <section className="connection-section connection-core">
      <div className="connection-section-heading"><span className="connection-section-num">01</span><div><span className="connection-eyebrow">PLATFORM FOUNDATION</span><h2 className="connection-core-title"><span className="connection-core-brand"><b>3D</b>PrintHub</span><span className="connection-core-word">Core</span><span className="connection-core-cn">版本</span></h2><p>统一项目、几何资产、工艺资料与执行证据的核心底座</p></div><Cpu size={28}/></div>
      <div className="connection-version-grid" role="group" aria-label="选择目标 3DPrintHub Core 版本">
        {coreVersions.map((item,index)=><button type="button" className={'connection-version'+(selectedCore===item.version?' selected':'')} key={item.version} aria-pressed={selectedCore===item.version} onClick={()=>chooseCore(item.version)}><span className="connection-version-top"><span className="connection-version-rail">CORE / 0{index+1}</span><span className="connection-version-check"><Check size={13}/></span></span><strong>{item.version}</strong><h3>3DPrintHub Core</h3><p>{item.scope}</p></button>)}
      </div>
      <div className="connection-core-selection"><span className="connection-core-selection-icon"><Check size={15}/></span><span>目标版本 <strong>{selectedCore}</strong></span><small>选择保存在此浏览器；实际服务状态以连接诊断为准。</small></div>
    </section>

    <section className="connection-section">
      <div className="connection-section-heading"><span className="connection-section-num">02</span><div><span className="connection-eyebrow">INDUSTRIAL TOOLCHAIN</span><h2>工业建模与切片工具连接器</h2><p>单击选择工具，并对当前真实可用链路执行集成测试</p></div><Layers3 size={28}/></div>
      <div className="connection-tool-columns">
        <div className="connection-tool-panel"><div className="connection-tool-title"><span>建模与预处理</span><small>MODEL / PREPARE</small></div>{modeling.map(item=><div className="connection-tool-row" key={item.label}><span>{item.label}</span><div>{item.tools.map(tool=><button type="button" className={'connection-tool-chip'+(selectedIndustrial===tool.id?' selected':'')} key={tool.id} aria-pressed={selectedIndustrial===tool.id} onClick={()=>setSelectedIndustrial(tool.id)}>{tool.name}{selectedIndustrial===tool.id&&<Check size={11}/>}</button>)}</div><Status kind="plan">待接入</Status></div>)}</div>
        <div className="connection-tool-panel"><div className="connection-tool-title"><span>切片与制造</span><small>SLICE / PRODUCE</small></div>{slicing.map(item=><div className="connection-tool-row" key={item.label}><span>{item.label}</span><div>{item.tools.map(tool=><button type="button" className={'connection-tool-chip'+(selectedIndustrial===tool.id?' selected':'')} key={tool.id} aria-pressed={selectedIndustrial===tool.id} onClick={()=>setSelectedIndustrial(tool.id)}>{tool.name}{selectedIndustrial===tool.id&&<Check size={11}/>}</button>)}</div><Status kind={item.tools.some(tool=>tool.id==='bambu-studio')?'ready':'plan'}>{item.tools.some(tool=>tool.id==='bambu-studio')?'可测试':'待接入'}</Status></div>)}</div>
      </div>
      <div className="connection-reality-bar"><div><Cable size={19}/><strong>当前可用路径</strong></div><div className="connection-reality-actions"><button type="button" className={selectedIndustrial==='cad-executor'?'selected':''} aria-pressed={selectedIndustrial==='cad-executor'} onClick={()=>setSelectedIndustrial('cad-executor')}>CAD 本机执行器 <b>{cadState}</b></button><span>·</span><button type="button" className={selectedIndustrial==='bambu-studio'?'selected':''} aria-pressed={selectedIndustrial==='bambu-studio'} onClick={()=>setSelectedIndustrial('bambu-studio')}>Bambu Studio {slice?.version??'02.08.02.60'} <b>{sliceState}</b></button></div></div>
      <div className="connection-selected" aria-live="polite"><div><span>当前选择</span><strong>{selectedIndustrialItem.name}</strong><p>{selectedIndustrialItem.detail}</p></div><ToneBadge tone={selectedIndustrialItem.tone}/></div>
      <div className="connection-test"><div><strong>工业工具链集成测试</strong><p>检查本机 CAD 状态、服务端任务通道、Bambu 离线链路，并标明尚未接入的工具。</p></div><Button variant="outline" size="sm" disabled={busy||testing!==null} onClick={()=>void runIndustrialTest()}>{testing==='industrial'?<Loader2 className="connection-spin" size={14}/>:industrialReport?<RotateCcw size={14}/>:<Play size={14}/>} {industrialReport?'重新测试':'开始测试'}</Button></div>
      <IntegrationReport report={industrialReport} running={testing==='industrial'}/>
    </section>

    <section className="connection-section">
      <div className="connection-section-heading"><span className="connection-section-num">03</span><div><span className="connection-eyebrow">INTELLIGENCE LAYER</span><h2>AI 连接器</h2><p>单击选择 AI 能力，并通过一次集成测试核对共享服务链路</p></div><BrainCircuit size={28}/></div>
      <div className="connection-ai-grid" role="group" aria-label="选择 AI 连接器">
        <button type="button" className={'connection-ai-card'+(selectedAi==='ai-multimodal'?' selected':'')} aria-pressed={selectedAi==='ai-multimodal'} onClick={()=>setSelectedAi('ai-multimodal')}><span className="connection-ai-card-top"><span className="connection-ai-index">AI / 01</span><span className="connection-ai-choice"><Check size={12}/></span></span><h3>多模态输入识别</h3><span className="connection-ai-description">理解文字、图片与设计约束，生成结构化工程建议。</span><span className="connection-ai-divider"/><span className="connection-ai-meta"><span>扩展模型</span><strong>GPT 6.0</strong><Status kind="plan">待接入</Status></span><span className="connection-ai-meta"><span>当前服务</span><strong>{ai?.configured?[ai.provider,ai.model].filter(Boolean).join(' · '):'尚未配置'}</strong><Status kind={ai?.previouslyVerified?'history':ai?.configured?'ready':'plan'}>{ai?.previouslyVerified?'历史已验证':ai?.configured?'已配置':'待接入'}</Status></span></button>
        <button type="button" className={'connection-ai-card'+(selectedAi==='ai-3d'?' selected':'')} aria-pressed={selectedAi==='ai-3d'} onClick={()=>setSelectedAi('ai-3d')}><span className="connection-ai-card-top"><span className="connection-ai-index">AI / 02</span><span className="connection-ai-choice"><Check size={12}/></span></span><h3>三维方案生成</h3><span className="connection-ai-description">把设计输入转为可比较的三维候选，并追踪生成任务。</span><span className="connection-ai-divider"/><span className="connection-ai-meta"><span>服务系列</span><strong>Tripo 3D</strong><Status kind={tripo?.configured?'ready':'plan'}>{tripo?.configured?'已配置':'待接入'}</Status></span><span className="connection-ai-meta"><span>当前模型</span><strong>{tripo?.configured?tripo.model??tripo.version??'v3':'尚未配置'}</strong><Status kind={tripo?.configured?'ready':'plan'}>{tripo?.configured?'已配置':'待接入'}</Status></span></button>
        <button type="button" className={'connection-ai-card'+(selectedAi==='ai-process'?' selected':'')} aria-pressed={selectedAi==='ai-process'} onClick={()=>setSelectedAi('ai-process')}><span className="connection-ai-card-top"><span className="connection-ai-index">AI / 03</span><span className="connection-ai-choice"><Check size={12}/></span></span><h3>工艺选型推理</h3><span className="connection-ai-description">结合项目需求与工艺参数集，给出设备、材料及成形工艺的匹配依据。</span><span className="connection-ai-divider"/><span className="connection-ai-meta"><span>分析引擎</span><strong>{ai?.configured?[ai.provider,ai.model].filter(Boolean).join(' · '):'尚未配置'}</strong><Status kind={ai?.configured?'ready':'plan'}>{ai?.configured?'已配置':'待接入'}</Status></span><span className="connection-ai-meta"><span>使用位置</span><strong>工艺资料集设置</strong><Status kind="ready">可查看</Status></span></button>
      </div>
      <div className="connection-selected" aria-live="polite"><div><span>当前选择</span><strong>{aiSelections[selectedAi as keyof typeof aiSelections].name}</strong><p>{selectedAiItem?.detail??aiSelections[selectedAi as keyof typeof aiSelections].detail}</p></div>{selectedAiItem?<ToneBadge tone={selectedAiItem.tone}/>:<Status kind="ready">单击已选中</Status>}</div>
      <div className="connection-test"><div><strong>AI 连接器集成测试</strong><p>验证通用 AI 最小响应、Tripo 模型与账户接口，以及工艺推理共享链路。通用 AI 探测会产生极少量 Token。</p></div><Button variant="outline" size="sm" disabled={busy||testing!==null} onClick={()=>void runAiTest()}>{testing==='ai'?<Loader2 className="connection-spin" size={14}/>:aiReport?<RotateCcw size={14}/>:<Play size={14}/>} {aiReport?'重新测试':'开始测试'}</Button></div>
      <IntegrationReport report={aiReport} running={testing==='ai'}/>
    </section>
  </div>;
}
