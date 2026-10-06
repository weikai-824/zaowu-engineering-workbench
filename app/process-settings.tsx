'use client';
import {useMemo,useState} from 'react';
import {BookOpen,Check,ChevronRight,Download,Factory,ImageOff,LockKeyhole,Search,Settings2,Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Switch} from '@/components/ui/switch';
import {processLabels,formatParameter,type Part,type Project} from '@/lib/engineering';
import {editableProcessFields,initialProcessConfiguration,processGroups,validateProcessConfiguration,type ProcessConfiguration} from '@/lib/process-configuration';
import {machinePhotos,privateBoundaryNotes,privateParameterName,privateProcessSet,profiles} from '@/lib/private-process-library';

type Recommendation = {profileId:string;summary:string;reasons:string[];checks:string[];basis:'ai'|'rules'};
type ProcessSettingsProps={project:Project;selectedPart?:Part;busy:boolean;onSave:(configuration:ProcessConfiguration)=>Promise<void>;onAssignPart:(profileId:string)=>void;onDownload:()=>void;onNavigateCad:()=>void};
const internalParameterCount=profiles.reduce((count,profile)=>count+profile.parameters.length,0);

function processFamily(process:string){return process==='FDM'?'熔融挤出':process==='SLA_LASER'||process==='LCD_MSLA'?'光固化':process==='SLS'||process==='MJF'?'聚合物粉末床':process==='LPBF'?'金属粉末床':'材料喷射';}
function unique(values:string[]){return Array.from(new Set(values));}
function fallbackRecommendation(project:Project):Recommendation{
  const text=`${project.brief} ${project.domain}`.toLowerCase();
  const preferred=profiles.find(profile=>profile.id===project.processConfiguration?.profileId);
  const candidate=/透明|精细|微小|细节|光滑|高精度/.test(text)?profiles.find(profile=>profile.process==='LCD_MSLA'):/强度|承载|机械|结构/.test(text)?profiles.find(profile=>profile.process==='SLS'):preferred??profiles.find(profile=>profile.process==='FDM');
  const target=candidate??profiles[0];
  return {profileId:target.id,basis:'rules',summary:'基于需求关键词与当前参数集的初步匹配，尚未完成材料和设备验证。',reasons:[`项目需求：${project.brief.trim().slice(0,80)||'尚未填写详细设计要求'}`,`候选组合：${processLabels[target.process]??target.process} · ${target.machine} · ${target.material}`,preferred?'已读取当前项目保存的工艺参数集。':'项目尚未保存工艺参数集，先以资料库组合初筛。'],checks:['核对零件实际尺寸、壁厚与设备成型空间。','核对材料批次、设备工艺包和试制记录。']};
}

function ProcessSettingsEditor({project,selectedPart,busy,onSave,onAssignPart,onDownload,onNavigateCad}:ProcessSettingsProps){
  const [profileId,setProfileId]=useState(project.processConfiguration?.profileId??profiles.find(profile=>profile.process===project.preferredProcess)?.id??profiles[0].id);
  const [draft,setDraft]=useState<ProcessConfiguration>(project.processConfiguration??initialProcessConfiguration(profileId));
  const [activeGroup,setActiveGroup]=useState<(typeof processGroups)[number]>('质量');
  const [search,setSearch]=useState('');
  const [showSources,setShowSources]=useState(false);
  const [recommendation,setRecommendation]=useState<Recommendation|null>(null);
  const [thinking,setThinking]=useState(false);
  const [message,setMessage]=useState('');
  const profile=profiles.find(value=>value.id===profileId)??profiles[0];
  const fields=editableProcessFields(profile.process);
  const dirty=JSON.stringify(draft)!==JSON.stringify(project.processConfiguration);
  const issue=validateProcessConfiguration(draft);
  const machines=useMemo(()=>unique(profiles.map(value=>value.machine)),[]);
  const processChoices=profiles.filter(value=>value.machine===profile.machine);
  const materialChoices=processChoices.filter(value=>value.process===profile.process);
  const visibleMachines=machines.filter(machine=>profiles.some(value=>value.machine===machine&&`${value.machine} ${value.material} ${processLabels[value.process]??value.process}`.toLowerCase().includes(search.toLowerCase())));
  const selectedPhoto=machinePhotos[profile.machine];
  const privateSet=privateProcessSet(profile)!;
  const saved=project.processConfiguration?.profileId===profileId&&!dirty;

  function selectProfile(nextId:string){const next=profiles.find(value=>value.id===nextId);if(!next)return;setProfileId(next.id);setDraft(project.processConfiguration?.profileId===next.id?project.processConfiguration:initialProcessConfiguration(next.id));setActiveGroup('质量');setRecommendation(null);setMessage('');}
  function selectMachine(machine:string){const choices=profiles.filter(item=>item.machine===machine),next=choices.find(item=>item.process===profile.process&&item.material===profile.material)??choices.find(item=>item.process===profile.process)??choices[0];if(next)selectProfile(next.id);}
  function selectProcess(process:string){const choices=profiles.filter(item=>item.machine===profile.machine&&item.process===process),next=choices.find(item=>item.material===profile.material)??choices[0];if(next)selectProfile(next.id);}
  function edit(key:string,value:number|boolean){setDraft(current=>({...current,values:{...current.values,[key]:value}}));setRecommendation(null);}
  async function getRecommendation(){setThinking(true);setMessage('');try{
    const response=await fetch('/api/ai/process-match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id})});
    const result=await response.json() as Recommendation&{error?:string};
    if(!response.ok)throw Error(result.error??'AI 匹配未完成');
    setRecommendation({...result,basis:'ai'});
  }catch(error){setRecommendation(fallbackRecommendation(project));setMessage((error instanceof Error?error.message:'AI 暂不可用')+'；已显示规则初筛。');}finally{setThinking(false);}}

  return <section className="process-settings">
    <div className="process-page-heading"><div><span className="process-eyebrow">PRIVATE PROCESS LIBRARY / PROJECT CONFIGURATION</span><h1>工艺资料集设置</h1><p>{profiles.length} 套私有工艺组合 · {internalParameterCount} 项内部参数。按机器、工艺、耗材选择并生成项目参数副本。</p></div><Button variant="outline" onClick={onDownload}><Download size={16}/>导出私有参数包</Button></div>
    <div className="process-private-banner"><span><LockKeyhole size={17}/></span><div><strong>企业私有工艺库</strong><p>稳定母版受控保存；项目调整不会覆盖原始参数集。</p></div><em>PRIVATE · CONTROLLED</em></div>
    <div className="process-flow"><div className="process-flow-title"><span>01 / 组合选择</span><strong>机器 → 工艺 → 耗材</strong></div><label><span>机器</span><Select value={profile.machine} onValueChange={selectMachine}><SelectTrigger aria-label="选择机器"><SelectValue/></SelectTrigger><SelectContent>{machines.map(value=><SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label><ChevronRight className="process-flow-arrow" size={20}/><label><span>工艺</span><Select value={profile.process} onValueChange={selectProcess}><SelectTrigger aria-label="选择工艺"><SelectValue/></SelectTrigger><SelectContent>{unique(processChoices.map(value=>value.process)).map(value=><SelectItem key={value} value={value}>{processLabels[value]??value}</SelectItem>)}</SelectContent></Select></label><ChevronRight className="process-flow-arrow" size={20}/><label><span>耗材</span><Select value={profile.material} onValueChange={value=>selectProfile(materialChoices.find(item=>item.material===value)?.id??profile.id)}><SelectTrigger aria-label="选择耗材"><SelectValue/></SelectTrigger><SelectContent>{materialChoices.map(value=><SelectItem key={value.id} value={value.material}>{value.material}</SelectItem>)}</SelectContent></Select></label></div>
    <div className="process-layout"><aside className="process-library"><div className="process-library-head"><div><span>02 / 私有机型库</span><strong>{machines.length} 款机器 · {profiles.length} 套受控组合</strong></div><LockKeyhole size={20}/></div><div className="process-search"><Search size={16}/><Input aria-label="搜索机型或耗材" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索机型、耗材或工艺"/></div><div className="process-machine-list">{visibleMachines.map(machine=>{const combinations=profiles.filter(value=>value.machine===machine),active=machine===profile.machine;return <section className={'process-machine-card'+(active?' active':'')} key={machine}><button onClick={()=>selectMachine(machine)}><span className="process-machine-thumb">{machinePhotos[machine]?<img src={machinePhotos[machine]} alt={machine+' 设备照片'} onError={event=>{event.currentTarget.style.display='none';}}/>:<Factory size={26}/>}</span><span><strong>{machine}</strong><small>{processFamily(combinations[0].process)} · {combinations.length} 套私有参数集</small></span></button>{active&&<div className="process-machine-combos">{combinations.map(item=><button className={item.id===profile.id?'active':''} key={item.id} onClick={()=>selectProfile(item.id)}>{item.material}</button>)}</div>}</section>;})}{!visibleMachines.length&&<p className="process-empty">没有匹配机型。</p>}</div></aside>
    <main className="process-main"><div className="process-hero"><div className="process-hero-media">{selectedPhoto?<img src={selectedPhoto} alt={profile.machine+' 设备照片'} onError={event=>{event.currentTarget.style.display='none';}}/>:<div className="process-no-photo"><ImageOff size={30}/><span>设备照片待补充</span></div>}</div><div className="process-hero-info"><div className="process-hero-tags"><span>{processLabels[profile.process]??profile.process}</span><span><LockKeyhole size={11}/> 企业私有</span><span>{privateSet.status}</span></div><h2>{profile.machine}</h2><p>{profile.material}</p><div className="process-hero-meta"><span><b>{profile.parameters.length}</b> 项内部参数</span><span><b>{fields.length}</b> 项项目设置</span><span><b>{saved?'已保存':'待保存'}</b> 项目副本</span></div><small>内部编号 {privateSet.id} · {privateSet.version} · 仅当前工作区可用</small></div></div>
    <div className="process-editor"><div className="process-editor-heading"><div><span>03 / 参数设置</span><h3>{privateSet.name} · {privateSet.version}</h3><p>内部固化母版保持只读；当前编辑内容保存为项目副本，不会覆盖企业参数资产。</p></div><span className="process-editor-status">{fields.length?(saved?'项目副本已保存':'内部母版 · 可创建项目副本'):'内部边界资料'}</span></div>{fields.length?<><div className="process-group-tabs" role="tablist" aria-label="工艺参数分类">{processGroups.filter(group=>fields.some(field=>field.group===group)).map(group=><button role="tab" aria-selected={activeGroup===group} className={activeGroup===group?'active':''} key={group} onClick={()=>setActiveGroup(group)}>{group}<span>{fields.filter(field=>field.group===group).length}</span></button>)}</div><div className="process-parameter-list">{fields.filter(field=>field.group===activeGroup).map(field=><label className="process-parameter" key={field.key}><span><strong>{field.label}</strong><small>{field.help}</small></span>{typeof field.initial==='boolean'?<Switch checked={Boolean(draft.values[field.key])} onCheckedChange={value=>edit(field.key,value)} aria-label={field.label}/>:<span className="process-number"><Input aria-label={field.label} type="number" min={field.min} max={field.max} step={field.step} value={Number.isNaN(draft.values[field.key] as number)?'':draft.values[field.key] as number} onChange={event=>edit(field.key,event.target.value===''?NaN:Number(event.target.value))}/><em>{field.unit??'档'}</em></span>}</label>)}</div><div className="process-editor-footer"><p>{issue?<span className="process-error">{issue}</span>:'保存后生成当前项目的受控参数副本，并进入版本记录。'}</p><Button disabled={busy||!!issue||!dirty} onClick={()=>void onSave(draft)}><Check size={16}/>保存项目参数副本</Button></div></>:<div className="process-reference-only"><BookOpen size={25}/><div><strong>该工艺使用受控边界参数集</strong><p>当前组合可绑定到项目；完整执行参数由对应设备工艺包管理，生产前仍需首件复核。</p><Button disabled={busy||!dirty} onClick={()=>void onSave(draft)}>保存目标组合</Button></div></div>}</div>
    <div className="process-bottom-grid"><section className="process-ai-card"><div className="process-card-title"><Sparkles size={19}/><div><span>04 / 建模前匹配</span><h3>AI 私有工艺匹配</h3></div></div><p>AI 只读取当前工作区的项目需求和私有参数集，比较精度、强度与材料适用性；结论由你确认。</p><Button variant="outline" disabled={thinking||busy||!project.revision||dirty} onClick={()=>void getRecommendation()}>{thinking?'正在分析…':'分析当前项目'}</Button>{dirty&&<small>先保存当前参数副本，再让 AI 读取。</small>}{message&&<small className="process-error">{message}</small>}{recommendation&&<div className="process-recommendation"><span>{recommendation.basis==='ai'?'AI 建议':'规则初筛'}</span><strong>{recommendation.summary}</strong><ul>{recommendation.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul><p>仍需核对：{recommendation.checks.join('；')}</p>{recommendation.profileId!==profile.id&&<Button size="sm" variant="outline" onClick={()=>selectProfile(recommendation.profileId)}>查看建议组合</Button>}</div>}</section><section className="process-actions-card"><div className="process-card-title"><Settings2 size={19}/><div><span>05 / 项目使用</span><h3>当前配置去向</h3></div></div><p>项目参数副本已纳入版本记录和 AI 上下文。你可以继续进入参数化 CAD，或给当前零件绑定同一套私有参数集。</p><div className="process-action-buttons"><Button variant="outline" onClick={onNavigateCad}>进入 CAD 建模</Button>{selectedPart&&<Button variant="outline" disabled={busy||!saved} onClick={()=>onAssignPart(profile.id)}>用于当前零件</Button>}</div><small>参数集已绑定不等于切片成功或实机验证。</small></section></div>
    <details className="process-sources" open={showSources} onToggle={event=>setShowSources(event.currentTarget.open)}><summary>私有参数依据与适用边界 <span>{privateSet.id} · {privateSet.version}</span></summary><div className="process-source-table"><div className="process-source-header"><strong>内部参数</strong><strong>受控值</strong><strong>版本</strong></div>{profile.parameters.map((item,index)=><div className="process-source-row" key={index}><span>{privateParameterName(item.name)}<small>适用于 {profile.machine} · {profile.material}</small></span><span>{formatParameter(item.value)} {item.unit}</span><span className="process-source-version">{privateSet.version}</span></div>)}</div><div className="process-unknown"><strong>使用边界</strong><ul>{privateBoundaryNotes(profile).map((item,index)=><li key={index}>{item}</li>)}</ul></div></details>
    </main></div>
  </section>;
}

export default function ProcessSettings(props:ProcessSettingsProps){
 const configurationKey=JSON.stringify(props.project.processConfiguration??null);
 return <ProcessSettingsEditor key={`${props.project.id}:${configurationKey}`} {...props}/>;
}
