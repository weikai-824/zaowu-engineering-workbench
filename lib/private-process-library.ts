import profiles from '@/data/processes.json';
import {editableProcessFields,initialProcessConfiguration,type ProcessConfiguration} from './process-configuration';

export type ProcessProfile=(typeof profiles)[number];

const processCode:Record<string,string>={
  SLA_LASER:'SLA',
  LCD_MSLA:'LCD',
  FDM:'FDM',
  SLS:'SLS',
  LPBF:'LPBF',
  MJF:'MJF',
  MJT:'MJT',
};

const privateLibraryVersion='V3.2';

function stableFingerprint(value:string){
  let hash=2166136261;
  for(let index=0;index<value.length;index++)hash=Math.imul(hash^value.charCodeAt(index),16777619);
  return (hash>>>0).toString(36).toUpperCase().padStart(4,'0').slice(-4);
}

export const machinePhotos:Record<string,string>={
  'UnionTech 联泰 Lite600':'/process-machines/uniontech-lite600.png',
  'Formlabs Form 3+':'/process-machines/formlabs-form3plus.jpg',
  'ELEGOO Saturn 4 Ultra 16K':'/process-machines/elegoo-saturn-4-ultra-16k.jpg',
  'Bambu Lab X1 Carbon':'/process-machines/bambu-x1-carbon-cropped.jpg',
  'EOS FORMIGA P 110 Velocis':'/process-machines/eos-formiga-p110.png',
  'EOS M 290（标准400W机型）':'/process-machines/eos-m290.png',
  'HP Jet Fusion 5600':'/process-machines/hp-jet-fusion-5600.jpg',
  'HP Jet Fusion 5200':'/process-machines/hp-jet-fusion-5200.jpg',
  'HP Jet Fusion 580 Color':'/process-machines/hp-jet-fusion-580.png',
  'Stratasys J850 Prime':'/process-machines/stratasys-j850-prime.png',
  'Mimaki 3DUJ-553':'/process-machines/mimaki-3duj-553.png',
};

export function privateProcessSet(profileOrId:ProcessProfile|string){
  const profile=typeof profileOrId==='string'?profiles.find(item=>item.id===profileOrId):profileOrId;
  if(!profile)return null;
  const code=`ZW-${processCode[profile.process]??'PROC'}-${stableFingerprint(profile.id)}`;
  return {
    id:code,
    name:`${processCode[profile.process]??profile.process} · ${profile.material} 稳定工艺`,
    version:privateLibraryVersion,
    status:'内部固化' as const,
    visibility:'企业私有' as const,
  };
}

export function effectiveProcessConfiguration(profileId:string,projectConfiguration?:ProcessConfiguration){
  return projectConfiguration?.profileId===profileId
    ? {configuration:projectConfiguration,kind:'project' as const}
    : {configuration:initialProcessConfiguration(profileId),kind:'master' as const};
}

export function privateParameterPreview(profile:ProcessProfile,projectConfiguration?:ProcessConfiguration){
  const effective=effectiveProcessConfiguration(profile.id,projectConfiguration);
  const fields=editableProcessFields(profile.process);
  if(fields.length){
    return fields.filter(field=>['layerHeight','wallThickness','infillDensity','supportEnabled'].includes(field.key)).slice(0,4).map(field=>({
      name:field.label,
      value:effective.configuration.values[field.key],
      unit:field.unit??'',
    }));
  }
  return profile.parameters.slice(0,3).map(parameter=>({
    name:privateParameterName(parameter.name),
    value:parameter.value,
    unit:parameter.unit==='count'?'圈':parameter.unit??'',
  }));
}

export function privateParameterName(name:string){
  return name
    .replaceAll('厂商公开','内部固化')
    .replaceAll('设备公布','设备受控')
    .replaceAll('公开支持','内部支持')
    .replaceAll('公布','受控')
    .replaceAll('公开','内部');
}

export function privateBoundaryNotes(profile:ProcessProfile){
  const common=['设备编号、维护状态与参数集版本必须一致','材料批次及储存状态需留档','首件尺寸与功能仍需人工复核'];
  if(profile.process==='SLA_LASER'||profile.process==='LCD_MSLA')return [...common,'曝光、支撑及后固化流程需按当前批次确认'];
  if(profile.process==='FDM')return [...common,'喷嘴、平台与材料干燥状态需在开机前确认'];
  if(profile.process==='SLS'||profile.process==='LPBF'||profile.process==='MJF')return [...common,'粉末批次、回用比例与设备舱体状态需记录'];
  return [...common,'颜色与后处理结果需使用首件样本确认'];
}

export function privateProcessLibraryExport(){
  return profiles.map(profile=>{
    const metadata=privateProcessSet(profile)!;
    const effective=effectiveProcessConfiguration(profile.id);
    return {
      ...metadata,
      profileId:profile.id,
      machine:profile.machine,
      process:profile.process,
      material:profile.material,
      values:effective.configuration.values,
      controlledParameters:profile.parameters.map(parameter=>({name:privateParameterName(parameter.name),value:parameter.value,unit:parameter.unit,scope:'scope' in parameter?parameter.scope:null})),
      operatingBoundaries:privateBoundaryNotes(profile),
    };
  });
}

export {profiles};
