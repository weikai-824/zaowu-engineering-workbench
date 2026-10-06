'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {isJsonObject} from '@/lib/json-value';

type Identity={deviceId:string;publicKey:string;label:string;registrationSignature:string};
type Session={port:number;sessionToken:string;expiresAt:string;identity:Identity};
type Envelope={runId:string;attempt:number;leaseId:string;jobId:string;deviceId:string;inputSha256:string;runnerSha256:string;taskJson:string};
export type LocalRun={id:string;job_id:string;device_id:string;device_label:string;status:string;attempt:number;error:string|null;receipt_json:string|null;signature:string|null;updated_at:string};
type LocalState={status:string;receiptJson:string|null;signature:string|null};
const sessionKey='ai3d:local-cad-session:v1';
const localDemoOrigin='http://www.3dprinthub.cn';
const localDemoExecutorPrefix='/__local-cad-executor';
export const runLabels:Record<string,string>={queued:'等待本机领取',leased:'本机执行 / 等待回传',succeeded:'已计算并归档',failed:'计算失败',interrupted:'执行中断',canceled:'已取消回传'};
async function request<T>(url:string,init?:RequestInit):Promise<T>{const r=await fetch(url,init);let data:unknown;try{data=await r.json();}catch{throw Error('服务未返回有效结果，请检查登录与连接。');}if(!r.ok)throw Error(isJsonObject(data)&&typeof data.error==='string'?data.error:'请求未完成');return data as T;}
function post<T>(path:string,data:unknown,signal?:AbortSignal){return request<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal});}
function loadRuns(projectId:string){return request<LocalRun[]>('/api/execution/runs?projectId='+projectId);}
function receiptHeader(text:string){return btoa(String.fromCharCode(...new TextEncoder().encode(text))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function executorUrl(port:number,path:string){
 if(typeof window!=='undefined'&&window.location.origin===localDemoOrigin&&port===8837)return localDemoExecutorPrefix+path;
 return `http://127.0.0.1:${port}${path}`;
}
function pairingError(cause:unknown){
 const message=cause instanceof Error?cause.message:String(cause);
 const known:Record<string,string>={
  'Pairing code already used':'这个配对码已使用。请重启本机执行器，再输入新显示的 8 位配对码。',
  'Pairing code expired; restart the controller':'配对码已过期。请重启本机执行器，再输入新显示的 8 位配对码。',
  'Pairing code rejected':'配对码不正确，请核对执行器启动窗口中的 8 位数字。',
  'Pairing attempts limited; wait or restart the controller':'配对尝试次数过多。请重启本机执行器后再连接。',
 };
 if(known[message])return Error(known[message]);
 if(cause instanceof DOMException&&cause.name==='TimeoutError')return Error('连接本机执行器超时。请确认执行器仍在运行，然后重试。');
 return cause instanceof Error?cause:Error(message);
}
export function useLocalExecutor(projectId?:string){
 const [session,setSession]=useState<Session|null>(null),[runsByProject,setRunsByProject]=useState<Record<string,LocalRun[]>>({}),[message,setMessage]=useState('未连接本机'),[error,setError]=useState(''),[changed,setChanged]=useState(0),[hasSession,setHasSession]=useState(()=>{if(typeof window==='undefined')return false;try{return !!sessionStorage.getItem(sessionKey);}catch{return false;}});
 const active=useRef<Envelope|null>(null),restoring=useRef(false);
 const runs=projectId?runsByProject[projectId]??[]:[];
 const refresh=useCallback(async()=>{const id=projectId;if(!id)return;const rows=await loadRuns(id);setRunsByProject(current=>({...current,[id]:rows}));},[projectId]);
 useEffect(()=>{const id=projectId;if(!id)return;let active=true;loadRuns(id).then(rows=>{if(active)setRunsByProject(current=>({...current,[id]:rows}));}).catch(error=>{if(active)setError(error instanceof Error?error.message:String(error));});return()=>{active=false;};},[projectId]);
 const local=useCallback((s:Session,path:string,init:RequestInit={})=>fetch(executorUrl(s.port,path),{...init,credentials:'omit',headers:{...init.headers,'X-Executor-Token':s.sessionToken}}),[]);
 const connect=useCallback(async(port:number,code:string)=>{
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('请输入 1024–65535 的本机端口。');
  let s:Session;
  if(code){if(!/^\d{8}$/.test(code))throw Error('请输入执行器启动时显示的 8 位配对码。');let paired:Omit<Session,'port'>;try{paired=await request<Omit<Session,'port'>>(executorUrl(port,'/pair'),{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({code}),signal:AbortSignal.timeout(15000)});}catch(cause){throw pairingError(cause);}s={...paired,port};try{sessionStorage.setItem(sessionKey,JSON.stringify(s));setHasSession(true);}catch{ /* Session can still run in memory. */ }}
  else{let saved:string|null=null;try{saved=sessionStorage.getItem(sessionKey);}catch{}if(!saved)throw Error('本页没有连接记录，请输入新的配对码。');s=JSON.parse(saved);if(!s.identity?.deviceId||!s.sessionToken||!Number.isInteger(s.port))throw Error('连接记录无效，请重新配对。');}
  if(Date.parse(s.expiresAt)<=Date.now())throw Error('本机连接已过期，请重启执行器并使用新的配对码。');
  const check=await local(s,'/status',{signal:AbortSignal.timeout(10000)});if(!check.ok)throw Error('本机连接已失效，请重启执行器并重新配对。');const state=await check.json() as {identity:Identity};if(state.identity.deviceId!==s.identity.deviceId||state.identity.publicKey!==s.identity.publicKey)throw Error('本机身份已改变，请重新配对。');
  await post('/api/execution/devices',{deviceId:s.identity.deviceId,publicKey:s.identity.publicKey,label:s.identity.label,registrationSignature:s.identity.registrationSignature});
  active.current=null;setError('');setMessage('已连接，等待建模任务');setSession(s);await refresh();
  },[local,refresh]);
 useEffect(()=>{
  if(session||!hasSession||restoring.current)return;
  let stopped=false;restoring.current=true;
  void connect(8837,'').catch(cause=>{
   if(stopped)return;
   setError(cause instanceof Error?cause.message:'本机连接自动恢复失败，请重新配对。');
  }).finally(()=>{restoring.current=false;});
  return()=>{stopped=true;};
 },[connect,hasSession,session]);
  const disconnect=()=>{setSession(null);active.current=null;setMessage('回传已暂停；本机计算可能继续');};
  const diagnose=async()=>{
   if(!session)return{connected:false,detail:hasSession?'本页保存了可恢复会话，但当前尚未恢复连接。':'尚未与本机执行器配对；任务通道仍可独立检查。'};
   const response=await local(session,'/status',{signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('本机执行器状态接口未通过检查，请重新配对。');
   const state=await response.json() as {identity?:Identity};
   if(state.identity?.deviceId!==session.identity.deviceId||state.identity.publicKey!==session.identity.publicKey)throw Error('本机执行器身份与当前会话不一致，请重新配对。');
   return{connected:true,deviceLabel:session.identity.label,detail:`${session.identity.label} · 本机状态接口与设备身份已验证。`};
  };
 useEffect(()=>{
  if(!session)return;const controller=new AbortController();let stopped=false,timer:ReturnType<typeof setTimeout>,lastBeat=0;
  const signal=()=>AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]);
  const tick=async()=>{let delay=3000;try{
   if(Date.parse(session.expiresAt)<=Date.now())throw Error('本机连接已过期，请重新配对。');
   if(!active.current){const claim=await post<{run:Envelope|null}>('/api/execution/runs',{action:'claim',deviceId:session.identity.deviceId},signal());if(stopped)return;active.current=claim.run;lastBeat=0;if(claim.run)await refresh();}
   const task=active.current;
   if(!task){setMessage('已连接，等待建模任务');setError('');delay=5000;return;}
   if(Date.now()-lastBeat>20000){await post('/api/execution/runs',{action:'heartbeat',runId:task.runId,deviceId:task.deviceId,leaseId:task.leaseId},signal());lastBeat=Date.now();}
   const submitted=await local(session,'/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(task),signal:signal()});
   if(!submitted.ok){const d=await submitted.json() as {error?:string};throw Error(d.error??'本机未接受任务');}
   const path=`/runs/${task.runId}/${task.attempt}/${task.leaseId}`,response=await local(session,path,{signal:signal()});if(!response.ok)throw Error('本机任务状态读取失败');const state=await response.json() as LocalState;
   if(stopped)return;
   setMessage(`任务 ${task.jobId.slice(0,8)} · ${state.status==='running'?'正在生成实体':'正在回传结果'}`);setError('');
   if(state.status==='running')return;
   if(!state.receiptJson||!state.signature)throw Error('执行器没有返回签名记录，不能归档。');
   if(state.status==='succeeded'){
    const file=await local(session,path+'/result',{signal:signal()});if(!file.ok)throw Error('结果文件读取失败');const bytes=await file.arrayBuffer();if(bytes.byteLength>8*1024*1024)throw Error('CAD 结果超过 8 MB');
    await request('/api/execution/results',{method:'POST',headers:{'Content-Type':'application/zip','x-execution-id':task.runId,'x-execution-receipt':receiptHeader(state.receiptJson),'x-execution-signature':state.signature},body:bytes,signal:signal()});
   }else if(state.status==='failed'||state.status==='interrupted')await post('/api/execution/runs',{action:'finish_failure',runId:task.runId,receiptJson:state.receiptJson,signature:state.signature},signal());
   else throw Error('执行器返回未知状态');
   if(stopped)return;active.current=null;setChanged(x=>x+1);setMessage(state.status==='succeeded'?'实体已归档，可加入当前设计':'本机计算未成功，请查看执行记录');await refresh();
  }catch(e){if(stopped)return;setError(e instanceof Error?e.message:String(e));setMessage('回传暂未完成，稍后重试');active.current=null;delay=15000;await refresh().catch(()=>{});}
  finally{if(!stopped)timer=setTimeout(()=>void tick(),delay);}};
  void tick();return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[session,local,refresh]);
 const enqueue=async(jobId:string)=>{if(!session)throw Error('请先连接本机执行器。');await post('/api/execution/runs',{action:'enqueue',jobId,deviceId:session.identity.deviceId});await refresh();};
 const command=async(action:'retry'|'cancel',runId:string)=>{await post('/api/execution/runs',{action,runId});if(active.current?.runId===runId)active.current=null;await refresh();};
 const revoke=async()=>{if(!session)return;await request('/api/execution/devices?id='+session.identity.deviceId,{method:'DELETE'});disconnect();try{sessionStorage.removeItem(sessionKey);}catch{}setHasSession(false);await refresh();};
  return{connected:!!session,deviceLabel:session?.identity.label??'',runs,message,error,changed,hasSession,connect,disconnect,diagnose,enqueue,command,revoke,refresh};
}
export type LocalExecutor=ReturnType<typeof useLocalExecutor>;
