import profiles from '@/data/processes.json';

export type ProcessValue = number | boolean;
export type ProcessConfiguration = {
  profileId: string;
  values: Record<string, ProcessValue>;
};

export type ProcessField = {
  key: string;
  label: string;
  group: '质量' | '强度' | '速度' | '支撑' | '其他';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  initial: ProcessValue;
  help: string;
};

const fdmFields: ProcessField[] = [
  {key:'layerHeight',label:'层高',group:'质量',unit:'mm',min:.05,max:.3,step:.05,initial:.2,help:'较小层高有利于细节表达；实际可用档位取决于喷嘴、材料与设备。'},
  {key:'firstLayerHeight',label:'首层层高',group:'质量',unit:'mm',min:.05,max:.4,step:.05,initial:.2,help:'首层附着需结合平台状态和实机试打确认。'},
  {key:'lineWidth',label:'默认线宽',group:'质量',unit:'mm',min:.2,max:1.2,step:.01,initial:.42,help:'线宽应与实际喷嘴直径和切片预设核对。'},
  {key:'outerWallWidth',label:'外墙线宽',group:'质量',unit:'mm',min:.2,max:1.2,step:.01,initial:.42,help:'影响外表面尺寸与细节，不能替代实测尺寸补偿。'},
  {key:'wallThickness',label:'目标壁厚',group:'强度',unit:'mm',min:.4,max:12,step:.05,initial:1.2,help:'建模阶段的壁厚目标，仍需几何检测和材料试验。'},
  {key:'wallLoops',label:'墙层数',group:'强度',min:1,max:12,step:1,initial:3,help:'与线宽共同影响壳体厚度。'},
  {key:'infillDensity',label:'内部填充',group:'强度',unit:'%',min:0,max:100,step:1,initial:20,help:'填充率影响质量、耗材与承载表现；强度还受方向和壁层影响。'},
  {key:'topLayers',label:'顶层层数',group:'强度',min:0,max:20,step:1,initial:5,help:'顶层封闭效果还取决于填充和材料。'},
  {key:'printSpeed',label:'主体速度',group:'速度',unit:'mm/s',min:5,max:500,step:1,initial:80,help:'这里只是项目草稿，实际速度需由设备和材料配置决定。'},
  {key:'outerWallSpeed',label:'外墙速度',group:'速度',unit:'mm/s',min:5,max:300,step:1,initial:50,help:'外墙速度影响表面质量与尺寸稳定性。'},
  {key:'nozzleTemperature',label:'喷嘴温度',group:'其他',unit:'°C',min:150,max:350,step:1,initial:220,help:'演示起点；使用前必须按具体耗材料号和设备校准。'},
  {key:'bedTemperature',label:'热床温度',group:'其他',unit:'°C',min:0,max:150,step:1,initial:55,help:'演示起点；与平台材质和耗材要求一同确认。'},
  {key:'supportEnabled',label:'启用支撑',group:'支撑',initial:false,help:'是否需要支撑取决于实际几何、方向与切片结果。'},
  {key:'supportAngle',label:'支撑触发角',group:'支撑',unit:'°',min:10,max:89,step:1,initial:45,help:'仅在支撑启用时作为试切起点。'},
];

const resinFields: ProcessField[] = [
  {key:'layerHeight',label:'层高',group:'质量',unit:'mm',min:.025,max:.2,step:.025,initial:.05,help:'可用层高需与树脂、曝光配置和机器能力核对。'},
  {key:'wallThickness',label:'目标壁厚',group:'强度',unit:'mm',min:.3,max:12,step:.05,initial:1.5,help:'中空与排液设计需另行检查，不能仅凭该值放行。'},
  {key:'infillDensity',label:'内部填充目标',group:'强度',unit:'%',min:0,max:100,step:1,initial:100,help:'树脂件常需结合实心、中空和排液方案判断；此值是建模意图。'},
  {key:'exposureTime',label:'普通层曝光',group:'速度',unit:'s',min:.5,max:60,step:.1,initial:3,help:'仅供草稿编辑，必须由具体树脂与设备的合格工艺包确定。'},
  {key:'bottomExposure',label:'底层曝光',group:'速度',unit:'s',min:1,max:180,step:.1,initial:30,help:'与离型膜、平台及树脂批次相关。'},
  {key:'liftSpeed',label:'抬升速度',group:'速度',unit:'mm/min',min:5,max:600,step:1,initial:60,help:'需按设备和工艺包校准。'},
  {key:'supportEnabled',label:'启用支撑',group:'支撑',initial:true,help:'支撑结构与方向仍需在专用切片软件中确认。'},
  {key:'supportDensity',label:'支撑密度',group:'支撑',unit:'%',min:0,max:100,step:1,initial:60,help:'仅表示支撑规划意图，不等于已生成支撑。'},
];

export const processGroups = ['质量','强度','速度','支撑','其他'] as const;
export function editableProcessFields(process:string):ProcessField[]{
  return process==='FDM'?fdmFields:process==='SLA_LASER'||process==='LCD_MSLA'?resinFields:[];
}
export function initialProcessConfiguration(profileId:string):ProcessConfiguration{
  const profile=profiles.find(value=>value.id===profileId);
  if(!profile)throw Error('找不到私有工艺组合。');
  const fields=editableProcessFields(profile.process);
  const values=Object.fromEntries(fields.map(field=>[field.key,field.initial])) as Record<string,ProcessValue>;
  const controlledNumber=(name:RegExp):number|undefined=>{
    const value:unknown=profile.parameters.find(parameter=>name.test(parameter.name))?.value;
    if(typeof value==='number')return value;
    if(Array.isArray(value)&&typeof value[0]==='number')return value[0];
    if(value&&typeof value==='object'&&'min' in value&&typeof value.min==='number')return value.min;
    return undefined;
  };
  const references=profile.process==='FDM'?{
    layerHeight:controlledNumber(/标准预设继承层高/),wallLoops:controlledNumber(/壁圈数/),infillDensity:controlledNumber(/填充密度/),nozzleTemperature:controlledNumber(/普通层喷嘴温度/),
  }:profile.process==='SLA_LASER'||profile.process==='LCD_MSLA'?{
    layerHeight:controlledNumber(/参考层厚|公开支持层厚|公布层厚范围/),exposureTime:controlledNumber(/普通层曝光参考范围/),bottomExposure:controlledNumber(/底层曝光参考范围/),
  }:{};
  for(const [key,value] of Object.entries(references)){
    const field=fields.find(item=>item.key===key);
    if(typeof value==='number'&&field&&value>=(field.min??-Infinity)&&value<=(field.max??Infinity))values[key]=value;
  }
  return {profileId,values};
}
export function validateProcessConfiguration(configuration:ProcessConfiguration):string|null{
  const profile=profiles.find(value=>value.id===configuration.profileId);
  if(!profile)return '私有工艺组合不存在。';
  const fields=editableProcessFields(profile.process),known=new Set(fields.map(field=>field.key));
  if(Object.keys(configuration.values).some(key=>!known.has(key)))return '参数集中包含当前工艺不支持的字段。';
  for(const field of fields){
    const value=configuration.values[field.key];
    if(typeof field.initial==='boolean'){
      if(typeof value!=='boolean')return `${field.label} 必须选择开启或关闭。`;
    }else if(typeof value!=='number'||!Number.isFinite(value)||value<(field.min??-Infinity)||value>(field.max??Infinity)){
      return `${field.label} 超出可编辑范围。`;
    }
  }
  if(profile.process==='FDM'&&Number(configuration.values.wallThickness)<Number(configuration.values.lineWidth))return '目标壁厚不能小于默认线宽。';
  return null;
}
export function processConfigurationSummary(configuration?:ProcessConfiguration):string{
  if(!configuration)return '未设置项目工艺参数集';
  const profile=profiles.find(value=>value.id===configuration.profileId);
  if(!profile)return '工艺组合已失效';
  const fields=editableProcessFields(profile.process);
  const values=fields.filter(field=>['layerHeight','wallThickness','infillDensity','supportEnabled'].includes(field.key)).map(field=>`${field.label} ${String(configuration.values[field.key])}${field.unit??''}`).join(' · ');
  return `${profile.machine} · ${profile.process} · ${profile.material}${values?' · '+values:''}`;
}
