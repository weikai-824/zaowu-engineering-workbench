import {parseCad,type CadDesign,CadScalar} from './cad-spec';
import type {Project} from './engineering';
import {randomUuid} from './crypto-portable';

const ref=(param:string,scale?:number,offset?:number):CadScalar=>({param,...(scale===undefined?{}:{scale}),...(offset===undefined?{}:{offset})});
const parameter=(label:string,value:number,min:number,max:number,locked=false)=>({label,value,min,max,locked});

/** Builds the controlled CAD reconstruction for the single Golden Scenario. */
export function goldenEnclosureCadDesign(project:Project):CadDesign{
 const width=project.targetSize,partId=randomUuid(),designId=randomUuid(),p={
  outer_width:parameter('主体外宽 / user target',width,80,240),outer_depth:parameter('主体外深 / assumption',100,60,220),outer_height:parameter('主体外高 / assumption',60,30,160),wall_thickness:parameter('壁厚 / assumption',4,2,8),floor_thickness:parameter('底板厚度 / assumption',8,4,16),usb_width:parameter('USB-C 开口宽 / assumption',20,10,50),usb_height:parameter('USB-C 开口高 / assumption',12,6,30),usb_z:parameter('USB-C 开口底标高 / assumption',24,8,50),vent_x:parameter('通风槽起点 X / assumption',94,20,180),vent_width:parameter('通风槽宽 / assumption',30,8,80),vent_height:parameter('通风槽高 / assumption',3,1,10),vent_z_1:parameter('第一通风槽底标高 / assumption',14,6,45),vent_z_2:parameter('第二通风槽底标高 / assumption',20,8,50),vent_z_3:parameter('第三通风槽底标高 / assumption',26,10,55),mount_offset:parameter('安装孔边距 / assumption',10,4,30),mount_radius:parameter('安装孔半径 / assumption',2.5,1,6),mount_height:parameter('安装孔工具高 / assumption',10,8,24)
 },w=ref('outer_width'),d=ref('outer_depth'),h=ref('outer_height'),wall=ref('wall_thickness'),floor=ref('floor_thickness'),usbW=ref('usb_width'),usbH=ref('usb_height'),usbZ=ref('usb_z'),ventX=ref('vent_x'),ventW=ref('vent_width'),ventH=ref('vent_height'),ventZ1=ref('vent_z_1'),ventZ2=ref('vent_z_2'),ventZ3=ref('vent_z_3'),offset=ref('mount_offset'),radius=ref('mount_radius'),mountHeight=ref('mount_height');
 const features=[
  {id:'outer_body',op:'box' as const,origin:[0,0,0] as [number,number,number],size:[w,d,h] as [CadScalar,CadScalar,CadScalar]},
  {id:'inner_cavity',op:'box' as const,origin:[wall,wall,floor] as [CadScalar,CadScalar,CadScalar],size:[ref('outer_width',1,-8),ref('outer_depth',1,-8),h] as [CadScalar,CadScalar,CadScalar]},
  {id:'open_shell',op:'subtract' as const,left:'outer_body',right:'inner_cavity'},
  {id:'usb_tool',op:'box' as const,origin:[ref('outer_width',.5,-10),-1,usbZ] as [CadScalar,CadScalar,CadScalar],size:[usbW,6,usbH] as [CadScalar,CadScalar,CadScalar]},
  {id:'usb_opening',op:'subtract' as const,left:'open_shell',right:'usb_tool'},
  {id:'vent_tool_1',op:'box' as const,origin:[ventX,-1,ventZ1] as [CadScalar,CadScalar,CadScalar],size:[ventW,6,ventH] as [CadScalar,CadScalar,CadScalar]},
  {id:'vent_opening_1',op:'subtract' as const,left:'usb_opening',right:'vent_tool_1'},
  {id:'vent_tool_2',op:'box' as const,origin:[ventX,-1,ventZ2] as [CadScalar,CadScalar,CadScalar],size:[ventW,6,ventH] as [CadScalar,CadScalar,CadScalar]},
  {id:'vent_opening_2',op:'subtract' as const,left:'vent_opening_1',right:'vent_tool_2'},
  {id:'vent_tool_3',op:'box' as const,origin:[ventX,-1,ventZ3] as [CadScalar,CadScalar,CadScalar],size:[ventW,6,ventH] as [CadScalar,CadScalar,CadScalar]},
  {id:'vent_opening_3',op:'subtract' as const,left:'vent_opening_2',right:'vent_tool_3'},
  {id:'mount_tool_fl',op:'cylinder' as const,origin:[offset,offset,-1] as [CadScalar,CadScalar,CadScalar],axis:'Z' as const,radius,height:mountHeight},
  {id:'mount_cut_fl',op:'subtract' as const,left:'vent_opening_3',right:'mount_tool_fl'},
  {id:'mount_tool_fr',op:'cylinder' as const,origin:[ref('outer_width',1,-10),offset,-1] as [CadScalar,CadScalar,CadScalar],axis:'Z' as const,radius,height:mountHeight},
  {id:'mount_cut_fr',op:'subtract' as const,left:'mount_cut_fl',right:'mount_tool_fr'},
  {id:'mount_tool_rl',op:'cylinder' as const,origin:[offset,ref('outer_depth',1,-10),-1] as [CadScalar,CadScalar,CadScalar],axis:'Z' as const,radius,height:mountHeight},
  {id:'mount_cut_rl',op:'subtract' as const,left:'mount_cut_fr',right:'mount_tool_rl'},
  {id:'mount_tool_rr',op:'cylinder' as const,origin:[ref('outer_width',1,-10),ref('outer_depth',1,-10),-1] as [CadScalar,CadScalar,CadScalar],axis:'Z' as const,radius,height:mountHeight},
  {id:'finished',op:'subtract' as const,left:'mount_cut_rl',right:'mount_tool_rr'}
 ];
 const visual=project.parts.find(part=>part.kind==='asset'&&part.source?.kind==='tripo'&&part.assetId),visualReference=visual?.source?.kind==='tripo'&&visual.assetId?{partId:visual.id,assetId:visual.assetId,assetSha256:visual.source.assetSha256,role:'visual_reference' as const}:undefined;
 return parseCad({schema:'cad-plan-v1',id:designId,name:'外壳参数设计',units:'mm',...(visualReference?{visualReference}:{}),parameters:p,parts:[{id:partId,name:'外壳工程实体',color:'#43b8a6',placement:[0,0,0],features,result:'finished'}],interfaces:[
  {id:'mount_hole_fl',partId,featureId:'mount_tool_fl',kind:'straight_bore_z',center:[offset,offset],zStart:0,length:floor,radius,locked:true},
  {id:'mount_hole_fr',partId,featureId:'mount_tool_fr',kind:'straight_bore_z',center:[ref('outer_width',1,-10),offset],zStart:0,length:floor,radius,locked:true},
  {id:'mount_hole_rl',partId,featureId:'mount_tool_rl',kind:'straight_bore_z',center:[offset,ref('outer_depth',1,-10)],zStart:0,length:floor,radius,locked:true},
  {id:'mount_hole_rr',partId,featureId:'mount_tool_rr',kind:'straight_bore_z',center:[ref('outer_width',1,-10),ref('outer_depth',1,-10)],zStart:0,length:floor,radius,locked:true}
 ]});
}

export const GOLDEN_ENCLOSURE_ASSUMPTIONS=[
 'outer_depth=100 mm、outer_height=60 mm：当前需求只明确目标最长尺寸，未提供另外两轴尺寸。',
 'wall_thickness=4 mm、floor_thickness=8 mm：按 FDM 工程重建的初始假设，需工程师确认。',
 'USB-C 开口 20 × 12 mm、位置及三条通风槽：需求只声明功能，不包含连接器实测包络和位置尺寸。',
 '四个安装孔半径 2.5 mm、边距 10 mm：由“安装脚/螺钉柱”需求形成的待确认接口假设。'
];
