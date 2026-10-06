import JSZip from 'jszip';
// Inspect ZIP32 directory before any decompression. JSZip otherwise allocates from untrusted sizes.
export async function boundedZip(data:ArrayBuffer|Uint8Array,maxExpanded=16*1024*1024,maxEntries=48){
 const bytes=new Uint8Array(data);if(bytes.length>8*1024*1024)throw Error('压缩文件上限 8 MB。');
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(d.getUint32(p,true)===0x06054b50&&p+22+d.getUint16(p+20,true)===bytes.length){end=p;break;}}
 if(end<0||d.getUint16(end+4,true)||d.getUint16(end+6,true))throw Error('ZIP 格式无效或分卷。');
 const count=d.getUint16(end+10,true),start=d.getUint32(end+16,true),length=d.getUint32(end+12,true);
 if(!count||count>maxEntries||d.getUint16(end+8,true)!==count||start+length!==end)throw Error('ZIP 目录超限或不完整。');
 const names=new Set<string>();const entries:{name:string;offset:number;compressed:number;expanded:number;method:number;crc:number}[]=[];let p=start,total=0;
 for(let i=0;i<count;i++){
  if(p+46>end||d.getUint32(p,true)!==0x02014b50)throw Error('ZIP 目录无效。');
  const flags=d.getUint16(p+8,true),method=d.getUint16(p+10,true),compressed=d.getUint32(p+20,true),expanded=d.getUint32(p+24,true),nl=d.getUint16(p+28,true),el=d.getUint16(p+30,true),cl=d.getUint16(p+32,true),local=d.getUint32(p+42,true),mode=d.getUint32(p+38,true)>>>16;
  if((flags&1)||![0,8].includes(method)||p+46+nl+el+cl>end||local+30>start||(mode&0xf000)===0xa000)throw Error('不支持加密、链接或异常 ZIP 条目。');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(p+46,p+46+nl));
  if(!name||name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').some(s=>s==='..'||s==='.')||/[\x00-\x1f]/.test(name)||names.has(name.toLowerCase()))throw Error('ZIP 路径不安全或重复。');
  names.add(name.toLowerCase());total+=expanded;if(total>maxExpanded||expanded>maxExpanded||compressed>bytes.length)throw Error('ZIP 解压大小超限。');
  if(d.getUint32(local,true)!==0x04034b50||d.getUint16(local+6,true)!==flags||d.getUint16(local+8,true)!==method||local+30+d.getUint16(local+26,true)+d.getUint16(local+28,true)+compressed>start)throw Error('ZIP 数据范围无效。');
  const localName=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(local+30,local+30+d.getUint16(local+26,true)));
  if(localName!==name)throw Error('ZIP 本地路径与目录不一致。');
  entries.push({name,offset:local+30+d.getUint16(local+26,true)+d.getUint16(local+28,true),compressed,expanded,method,crc:d.getUint32(p+16,true)});
  p+=46+nl+el+cl;
 }
 if(p!==end)throw Error('ZIP 目录长度不一致。');
 // Never pass untrusted compressed entries to JSZip: its CRC check inflates before enforcing size.
 const zip=new JSZip();
 for(const e of entries){
  let output:Uint8Array;
  if(e.method===0){if(e.compressed!==e.expanded)throw Error('ZIP 储存长度不一致。');output=bytes.subarray(e.offset,e.offset+e.compressed);}
  else{
   let cursor=0;const source=new ReadableStream<Uint8Array>({pull(controller){if(cursor>=e.compressed){controller.close();return;}const next=Math.min(cursor+256,e.compressed);controller.enqueue(bytes.subarray(e.offset+cursor,e.offset+next));cursor=next;}});
   const decoder=new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array,Uint8Array>;
   const reader=source.pipeThrough(decoder).getReader();output=new Uint8Array(e.expanded);let used=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;if(used+value.byteLength>e.expanded)throw Error('ZIP 实际解压长度超过声明或预算。');output.set(value,used);used+=value.byteLength;}if(used!==e.expanded)throw Error('ZIP 解压长度不一致。');}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  }
  let crc=0xffffffff;for(const b of output)crc=(crc>>>8)^crcTable[(crc^b)&255];if(((crc^0xffffffff)>>>0)!==e.crc)throw Error('ZIP CRC 校验失败。');
  zip.file(e.name,output,{binary:true,createFolders:false,dir:e.name.endsWith('/')});
 }
 return zip;
}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
