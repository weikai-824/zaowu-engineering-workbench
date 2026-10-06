// Container checks and dimensions only. Browser decoding is a separate required step.
export function imageDimensions(bytes:Uint8Array,mime?:string){
 const fail=(message:string):never=>{throw Error(message);};let width=0,height=0;
 if(bytes.length>=33&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
  if(mime&&mime!=='image/png')fail('贴图内容与 MIME 不符。');const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let p=8,header=false,image=false,end=false,chunks=0;
  while(p<bytes.length){if(p+12>bytes.length||++chunks>10000)fail('PNG 分块不完整或过多。');const length=d.getUint32(p),type=String.fromCharCode(...bytes.subarray(p+4,p+8));if(p+12+length>bytes.length)fail('PNG 分块越界。');let crc=0xffffffff;for(let i=p+4;i<p+8+length;i++)crc=(crc>>>8)^table[(crc^bytes[i])&255];if(((crc^0xffffffff)>>>0)!==d.getUint32(p+8+length))fail('PNG CRC 校验失败。');
   if(!header){if(type!=='IHDR'||length!==13)fail('PNG 缺少完整 IHDR。');header=true;width=d.getUint32(p+8);height=d.getUint32(p+12);const depth=bytes[p+16],color=bytes[p+17];const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};if(!depths[color]?.includes(depth)||bytes[p+18]!==0||bytes[p+19]!==0||bytes[p+20]>1)fail('PNG 图像编码字段无效。');}
   else if(type==='IHDR')fail('PNG IHDR 重复。');if(type==='IDAT'&&length>0)image=true;if(type==='IEND'){if(length!==0||!image||p+12!==bytes.length)fail('PNG 结束块或图像数据无效。');end=true;}p+=12+length;
  }if(!end)fail('PNG 缺少完整 IEND。');
 }else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
  if(mime&&mime!=='image/jpeg')fail('贴图内容与 MIME 不符。');if(bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)fail('JPEG 缺少结束标记。');let p=2;
  while(p+4<=bytes.length){if(bytes[p++]!==255)fail('JPEG 标记无效。');while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;const length=(bytes[p]<<8)|bytes[p+1];if(length<2||p+length>bytes.length)fail('JPEG 分段不完整。');if([0xc0,0xc1,0xc2].includes(marker)){if(length<8)fail('JPEG 尺寸段无效。');height=(bytes[p+3]<<8)|bytes[p+4];width=(bytes[p+5]<<8)|bytes[p+6];}p+=length;}
 }else fail('贴图不是完整的 PNG/JPEG。');if(!width||!height)fail('贴图尺寸无效。');return{width,height};
}
const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
