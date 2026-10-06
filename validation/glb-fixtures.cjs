const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {createRequire}=require('node:module');const {pathToFileURL}=require('node:url');
const project=path.resolve(__dirname,'..');const req=createRequire(path.join(project,'package.json'));const esbuild=req('esbuild');
const directory=path.join(project,'work/validation/glb-fixtures');fs.mkdirSync(directory,{recursive:true});
const source=path.join(project,'lib/glb-inspect.ts');const sourceSha=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
esbuild.buildSync({entryPoints:[source],outfile:path.join(directory,'inspector.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const {inspectGlb}=require(path.join(directory,'inspector.cjs'));
function seed(){
 const p=[0,0,0,.02,0,0,.02,.03,0,0,.03,0,0,0,.04,.02,0,.04,.02,.03,.04,0,.03,.04];
 const i=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5];
 const bin=Buffer.alloc(168);p.forEach((v,n)=>bin.writeFloatLE(v,n*4));i.forEach((v,n)=>bin.writeUInt16LE(v,96+n*2));
 return{json:{asset:{version:'2.0'},buffers:[{byteLength:168}],bufferViews:[{buffer:0,byteOffset:0,byteLength:96},{buffer:0,byteOffset:96,byteLength:72}],accessors:[{bufferView:0,componentType:5126,count:8,type:'VEC3',min:[0,0,0],max:[.02,.03,.04]},{bufferView:1,componentType:5123,count:36,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{name:'Part',mesh:0}],scenes:[{nodes:[0]}],scene:0},bin};
}
function pack(s){const j=Buffer.from(JSON.stringify(s.json));const jl=(j.length+3)&~3;const bl=(s.bin.length+3)&~3;const b=Buffer.alloc(12+8+jl+8+bl);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(jl,12);b.writeUInt32LE(0x4e4f534a,16);b.fill(32,20,20+jl);j.copy(b,20);b.writeUInt32LE(bl,20+jl);b.writeUInt32LE(0x004e4942,24+jl);s.bin.copy(b,28+jl);return b;}
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function pngChunk(type,data){const code=Buffer.from(type),b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length,0);code.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc32(Buffer.concat([code,data])),8+data.length);return b;}
function png(){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=6;const rgba=Buffer.from([0,255,0,0,255,0,255,0,255,0,0,0,255,255,255,255,255,255]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',require('node:zlib').deflateSync(rgba)),pngChunk('IEND',Buffer.alloc(0))]);}
const cases=[];
function add(id,expected,mutate,options={}){const s=seed();mutate?.(s);let b=pack(s);if(options.byteMutation)b=options.byteMutation(b);cases.push({id,expected,bytes:b,...options});}
add('G01_box','accept');
add('G02_bad_length','reject',null,{byteMutation:b=>{b.writeUInt32LE(b.length+4,8);return b;}});
add('G04_view_overrun','reject',s=>s.json.bufferViews[0].byteLength=169);
add('G05_index_overrun','reject',s=>s.bin.writeUInt16LE(8,96));
add('G06_nan_position','reject',s=>s.bin.writeFloatLE(NaN,0));
add('G09_cycle','reject',s=>s.json.nodes[0].children=[0]);
add('G10_shared_mesh','accept',s=>{s.json.nodes.push({name:'Part',mesh:0,translation:[.05,0,0]});s.json.scenes[0].nodes=[0,1];});
add('G11_two_primitives','accept',s=>{s.json.accessors[1].count=18;s.json.accessors.push({bufferView:1,byteOffset:36,componentType:5123,count:18,type:'SCALAR'});s.json.materials=[{pbrMetallicRoughness:{baseColorFactor:[1,0,0,1]}},{pbrMetallicRoughness:{baseColorFactor:[0,0,1,1]}}];s.json.meshes[0].primitives=[{attributes:{POSITION:0},indices:1,material:0},{attributes:{POSITION:0},indices:2,material:1}];});
add('G14_unlit','accept',s=>{s.json.extensionsUsed=['KHR_materials_unlit'];s.json.extensionsRequired=['KHR_materials_unlit'];s.json.materials=[{extensions:{KHR_materials_unlit:{}}}];s.json.meshes[0].primitives[0].material=0;});
add('G15_draco_required','reject',s=>{s.json.extensionsUsed=['KHR_draco_mesh_compression'];s.json.extensionsRequired=['KHR_draco_mesh_compression'];});
add('G07_png_embedded_valid','accept',s=>{const image=png(),uv=Buffer.alloc(64);[0,0,1,0,1,1,0,1,0,0,1,0,1,1,0,1].forEach((x,n)=>uv.writeFloatLE(x,n*4));const offset=s.bin.length;s.bin=Buffer.concat([s.bin,uv,image]);s.json.buffers[0].byteLength=s.bin.length;s.json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:64},{buffer:0,byteOffset:offset+64,byteLength:image.length});s.json.accessors.push({bufferView:2,componentType:5126,count:8,type:'VEC2'});s.json.images=[{bufferView:3,mimeType:'image/png'}];s.json.textures=[{source:0}];s.json.materials=[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}];s.json.meshes[0].primitives[0].material=0;s.json.meshes[0].primitives[0].attributes.TEXCOORD_0=2;},{loader:false});
add('G08_external_image','reject',s=>{s.json.images=[{uri:'https://example.invalid/never-fetch.png'}];},{loader:false});
add('R1_truncated_png','reject',s=>{const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(2,16);png.writeUInt32BE(2,20);const uv=Buffer.alloc(64);[0,0,1,0,1,1,0,1,0,0,1,0,1,1,0,1].forEach((x,n)=>uv.writeFloatLE(x,n*4));const offset=s.bin.length;s.bin=Buffer.concat([s.bin,uv,png]);s.json.buffers[0].byteLength=s.bin.length;s.json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:64},{buffer:0,byteOffset:offset+64,byteLength:png.length});s.json.accessors.push({bufferView:2,componentType:5126,count:8,type:'VEC2'});s.json.images=[{bufferView:3,mimeType:'image/png'}];s.json.textures=[{source:0}];s.json.materials=[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}];s.json.meshes[0].primitives[0].material=0;s.json.meshes[0].primitives[0].attributes.TEXCOORD_0=2;},{loader:false});
add('R2_unselected_scene_invalid_accessor','reject',s=>{s.json.accessors.push({...s.json.accessors[0],bufferView:99});s.json.meshes.push({primitives:[{attributes:{POSITION:2},indices:1}]});s.json.nodes.push({mesh:1});s.json.scenes.push({nodes:[1]});});
add('R3_reverse_depth_140','reject',s=>{s.json.nodes=[{mesh:0}];for(let n=1;n<140;n++)s.json.nodes.push({children:[n-1]});s.json.scenes[0].nodes=[139];});
add('R4_scalar_normal','reject',s=>{s.json.accessors.push({bufferView:0,componentType:5126,count:8,type:'SCALAR'});s.json.meshes[0].primitives[0].attributes.NORMAL=2;});
add('R5_min_version_future','reject',s=>s.json.asset.minVersion='2.1');
add('R6_unknown_optional','accept_with_warning',s=>{s.json.extensionsUsed=['VENDOR_appearance'];s.json.materials=[{extensions:{VENDOR_appearance:{color:[1,0,0]}}}];s.json.meshes[0].primitives[0].material=0;});
add('R7_false_position_bounds','reject',s=>s.json.accessors[0].max=[.2,.3,.4]);
(async()=>{
 const {GLTFLoader}=await import(pathToFileURL(path.join(project,'node_modules/three/examples/jsm/loaders/GLTFLoader.js')).href);
 const {Box3,Vector3}=await import(pathToFileURL(path.join(project,'node_modules/three/build/three.module.js')).href);
 const results=[];
 for(const c of cases){fs.writeFileSync(path.join(directory,c.id+'.glb'),c.bytes);const ab=c.bytes.buffer.slice(c.bytes.byteOffset,c.bytes.byteOffset+c.bytes.byteLength);const r={id:c.id,expected:c.expected,bytes:c.bytes.length,sha256:crypto.createHash('sha256').update(c.bytes).digest('hex')};
  try{r.summary=inspectGlb(ab);r.actual='accept';}catch(e){r.actual='reject';r.errorCode=e.code??'untyped';r.error=e.message;}
  if(c.loader!==false){try{const loaded=await new GLTFLoader().parseAsync(ab,'');let meshes=0;const normalSizes=[];loaded.scene.traverse(o=>{if(o.isMesh){meshes++;if(o.geometry.attributes.normal)normalSizes.push(o.geometry.attributes.normal.itemSize);}});const size=new Box3().setFromObject(loaded.scene).getSize(new Vector3());r.loader={accepted:true,meshCount:meshes,sceneCount:loaded.scenes.length,normalItemSizes:normalSizes,dimensionsMmZUp:[size.x*1000,size.z*1000,size.y*1000]};}catch(e){r.loader={accepted:false,error:e.message};}}
  r.mismatch=(c.expected==='reject'&&r.actual==='accept')||(c.expected.startsWith('accept')&&r.actual==='reject')||(c.expected==='accept_with_warning'&&r.actual==='accept'&&!r.summary.warnings?.length);
  results.push(r);console.log(JSON.stringify({id:r.id,expected:r.expected,actual:r.actual,mismatch:r.mismatch,error:r.error,loader:r.loader,dimensions:r.summary?.dimensionsMm}));
 }
 const resultsPath=path.join(directory,'results.json');if(fs.existsSync(resultsPath))fs.copyFileSync(resultsPath,path.join(directory,'results-previous.json'));
 if(results.some(r=>r.mismatch))process.exitCode=1;
 fs.writeFileSync(resultsPath,JSON.stringify({executedAt:new Date().toISOString(),inspectorSha256:sourceSha,scope:'Local synthetic GLB fixtures only. No Tripo call or manufacturing validation.',results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
