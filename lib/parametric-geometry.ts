import * as THREE from 'three';
import type {Part} from './engineering';
export function parametric(part:Part):THREE.Object3D{
 const p=part.params;let geometry:THREE.BufferGeometry;
 if(part.kind==='base'){
  if(!(p.diameter>0&&p.height>0&&p.holeDiameter>=0&&p.holeDiameter<p.diameter))throw Error('底座尺寸必须为正，孔径必须小于外径。');
  const shape=new THREE.Shape();shape.absarc(0,0,p.diameter/2,0,Math.PI*2,false);
  if(p.holeDiameter>0){const hole=new THREE.Path();hole.absarc(0,0,p.holeDiameter/2,0,Math.PI*2,true);shape.holes.push(hole);}
  geometry=new THREE.ExtrudeGeometry(shape,{depth:p.height,bevelEnabled:false,curveSegments:96});
 }else{if(!(p.width>0&&p.depth>0&&p.height>0))throw Error('零件尺寸必须大于零。');geometry=new THREE.BoxGeometry(p.width,p.depth,p.height);geometry.translate(0,0,p.height/2);}
 const obj=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:part.color,roughness:.5,metalness:.08}));obj.name=part.name;return obj;
}
