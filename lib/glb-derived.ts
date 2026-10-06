const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const ENGINEERING_INTAKE_METHOD = 'embedded-texture-strip-v1' as const;

export {ENGINEERING_INTAKE_METHOD};

type JsonObject = Record<string, unknown>;

function alignedLength(length: number) {
 return (length + 3) & ~3;
}

function cloneJson(data: ArrayBuffer) {
 const view = new DataView(data);
 if(data.byteLength<28||view.getUint32(0,true)!==GLB_MAGIC||view.getUint32(4,true)!==2||view.getUint32(8,true)!==data.byteLength)throw Error('只能对完整的 GLB 2 文件建立工程化派生资产。');
 let cursor=12,json:JsonObject|undefined,bin:Uint8Array|undefined;
 while(cursor<data.byteLength){
  if(cursor+8>data.byteLength)throw Error('GLB 分块头不完整。');
  const length=view.getUint32(cursor,true),type=view.getUint32(cursor+4,true);cursor+=8;
  if(length%4||cursor+length>data.byteLength)throw Error('GLB 分块长度无效。');
  if(type===JSON_CHUNK){
   if(json)throw Error('GLB JSON 分块重复。');
   try{const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(data,cursor,length))) as unknown;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();json=parsed as JsonObject;}catch{throw Error('GLB JSON 不能解析。');}
  }else if(type===BIN_CHUNK){
   if(bin)throw Error('GLB BIN 分块重复。');
   bin=new Uint8Array(data,cursor,length);
  }
  cursor+=length;
 }
 if(!json||!bin||json.asset&&typeof json.asset==='object'&&((json.asset as JsonObject).version!=='2.0'))throw Error('GLB 缺少可用的 glTF 2.0 数据。');
 return{json,bin};
}

function stripTextures(json: JsonObject) {
 const meshes=Array.isArray(json.meshes)?json.meshes as unknown[]:[];
 for(const mesh of meshes)if(mesh&&typeof mesh==='object'){
  const primitives=Array.isArray((mesh as JsonObject).primitives)?(mesh as JsonObject).primitives as unknown[]:[];
  for(const primitive of primitives)if(primitive&&typeof primitive==='object')delete (primitive as JsonObject).material;
 }
 const stripped:JsonObject={...json,extras:{...(json.extras&&typeof json.extras==='object'?json.extras:{}),engineeringIntake:{method:ENGINEERING_INTAKE_METHOD}}};
 delete stripped.images;
 delete stripped.samplers;
 delete stripped.textures;
 delete stripped.materials;
 if(Array.isArray(stripped.extensionsUsed))stripped.extensionsUsed=stripped.extensionsUsed.filter((name)=>typeof name==='string'&&!/^KHR_(materials_|texture_transform)/.test(name));
 if(Array.isArray(stripped.extensionsRequired))stripped.extensionsRequired=stripped.extensionsRequired.filter((name)=>typeof name==='string'&&!/^KHR_(materials_|texture_transform)/.test(name));
 return stripped;
}

/** Create a geometry-only GLB while retaining the original bytes as provenance. */
export function deriveEngineeringGlb(data: ArrayBuffer): ArrayBuffer {
 const{json,bin}=cloneJson(data),derived=stripTextures(json);
 const jsonBytes=new TextEncoder().encode(JSON.stringify(derived));
 const paddedJsonLength=alignedLength(jsonBytes.byteLength),totalLength=12+8+paddedJsonLength+8+bin.byteLength;
 const output=new ArrayBuffer(totalLength),view=new DataView(output),bytes=new Uint8Array(output);
 view.setUint32(0,GLB_MAGIC,true);view.setUint32(4,2,true);view.setUint32(8,totalLength,true);
 let cursor=12;view.setUint32(cursor,paddedJsonLength,true);view.setUint32(cursor+4,JSON_CHUNK,true);cursor+=8;bytes.set(jsonBytes,cursor);bytes.fill(0x20,cursor+jsonBytes.byteLength,cursor+paddedJsonLength);cursor+=paddedJsonLength;
 view.setUint32(cursor,bin.byteLength,true);view.setUint32(cursor+4,BIN_CHUNK,true);cursor+=8;bytes.set(bin,cursor);
 return output;
}
