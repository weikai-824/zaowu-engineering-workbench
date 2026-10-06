'use client';

import Image from 'next/image';
import {useMemo,useState} from 'react';
import {Check,Factory,LockKeyhole} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {processLabels} from '@/lib/engineering';
import {machinePhotos,privateProcessSet,profiles} from '@/lib/private-process-library';

type PickerMode='machine'|'material';
type OutputProcessPickerProps={
  partName:string;
  currentProfileId?:string;
  mode:PickerMode;
  open:boolean;
  onOpenChange:(open:boolean)=>void;
  onConfirm:(profileId:string)=>Promise<void>;
};

function unique(values:string[]){return Array.from(new Set(values));}

export default function OutputProcessPicker({partName,currentProfileId,mode,open,onOpenChange,onConfirm}:OutputProcessPickerProps){
  const fallback=profiles.find(profile=>profile.id===currentProfileId)??profiles[0];
  const[draftId,setDraftId]=useState(fallback.id);
  const[busy,setBusy]=useState(false);
  const draft=profiles.find(profile=>profile.id===draftId)??fallback;
  const machines=useMemo(()=>unique(profiles.map(profile=>profile.machine)),[]);
  const materials=profiles.filter(profile=>profile.machine===draft.machine&&profile.process===draft.process);
  const privateSet=privateProcessSet(draft)!;
  const chooseMachine=(machine:string)=>{
    const options=profiles.filter(profile=>profile.machine===machine);
    const next=options.find(profile=>profile.material===fallback.material)??options[0];
    if(next)setDraftId(next.id);
  };
  const confirm=async()=>{setBusy(true);try{await onConfirm(draft.id);onOpenChange(false);}finally{setBusy(false);}};

  return <Dialog open={open} onOpenChange={value=>{if(busy)return;if(!value)setDraftId(fallback.id);onOpenChange(value);}}>
    <DialogContent className="output-picker-dialog" data-output-process-picker={mode}>
      <DialogHeader className="output-picker-head">
        <span className="output-picker-lock"><LockKeyhole size={15}/> 企业私有工艺库</span>
        <DialogTitle>{mode==='machine'?'选择制造设备':'选择适用耗材'}</DialogTitle>
        <DialogDescription>为“{partName}”单选一项；确认后同步绑定对应工艺与私有参数集。</DialogDescription>
      </DialogHeader>
      <div className="output-picker-body">
        {mode==='machine'?<RadioGroup className="output-machine-options" value={draft.machine} onValueChange={chooseMachine} aria-label="制造设备单选">
          {machines.map(machine=>{const options=profiles.filter(profile=>profile.machine===machine),processes=unique(options.map(profile=>processLabels[profile.process]??profile.process)),checked=machine===draft.machine;return <label className={'output-machine-option'+(checked?' active':'')} key={machine}>
            <RadioGroupItem value={machine}/>
            <span className="output-machine-option-image">{machinePhotos[machine]?<Image src={machinePhotos[machine]} alt="" width={72} height={56}/>:<Factory size={26}/>}</span>
            <span><strong>{machine}</strong><small>{processes.join(' / ')} · {options.length} 套兼容耗材</small></span>
            {checked&&<Check size={17}/>}
          </label>;})}
        </RadioGroup>:<RadioGroup className="output-material-options" value={draft.id} onValueChange={setDraftId} aria-label="适用耗材单选">
          {materials.map((profile,index)=>{const metadata=privateProcessSet(profile)!;return <label className={'output-material-option'+(profile.id===draft.id?' active':'')} key={profile.id}>
            <RadioGroupItem value={profile.id}/>
            <span className="output-material-swatch" style={{background:['#d9e8dc','#252a2c','#d5d1c8','#8ecfc1','#d8a6a0'][index%5]}}/>
            <span><strong>{profile.material}</strong><small>{metadata.name} · {metadata.version}</small></span>
            {profile.id===fallback.id?<em>当前</em>:index===0?<em>推荐</em>:null}
          </label>;})}
        </RadioGroup>}
        <aside className="output-picker-summary">
          <span>将要绑定</span>
          <strong>{privateSet.name}</strong>
          <dl><div><dt>机器</dt><dd>{draft.machine}</dd></div><div><dt>工艺</dt><dd>{processLabels[draft.process]??draft.process}</dd></div><div><dt>耗材</dt><dd>{draft.material}</dd></div><div><dt>参数集</dt><dd>{privateSet.id} · {privateSet.version}</dd></div></dl>
          <p><LockKeyhole size={13}/> {privateSet.status} · 仅当前工作区可用</p>
        </aside>
      </div>
      <DialogFooter className="output-picker-footer">
        <DialogClose asChild><Button variant="outline" disabled={busy}>取消</Button></DialogClose>
        <Button onClick={()=>void confirm()} disabled={busy||draft.id===currentProfileId}>{busy?'正在保存…':'应用到该零件'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
