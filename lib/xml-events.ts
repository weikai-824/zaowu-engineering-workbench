/** Bounded XML events for the fixed slicer's 3MF dialect; never loads entities or URLs. */
export type XmlTag={name:string;local:string;ns:string;attrs:Record<string,string>;expanded:Record<string,string>;namespaces:Record<string,string>};
const xmlNs='http://www.w3.org/XML/1998/namespace';
function entities(value:string){return value.replace(/&([^;]*);|&/g,(whole,key:string)=>{if(!key)throw Error('XML 实体无效。');const fixed:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(Object.hasOwn(fixed,key))return fixed[key];if(!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(key))throw Error('XML 不支持外部或命名实体。');const n=key[1]==='x'?parseInt(key.slice(2),16):Number(key.slice(1));if(!Number.isSafeInteger(n)||n<1||n>0x10ffff||(n>=0xd800&&n<=0xdfff)||(n<32&&![9,10,13].includes(n)))throw Error('XML 字符无效。');return String.fromCodePoint(n);});}
export function xmlEvents(text:string,open:(tag:XmlTag,parents:XmlTag[])=>void,close:(tag:XmlTag,parents:XmlTag[])=>void=()=>{}){
 if(text.length>12*1024*1024||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw Error('XML 大小或字符无效。');
 const stack:XmlTag[]=[];let cursor=0,roots=0,tokens=0;
 while(cursor<text.length){
  const start=text.indexOf('<',cursor),endText=start<0?text.length:start,raw=text.slice(cursor,endText);entities(raw);
  if(!stack.length&&raw.trim()&&raw!=='\ufeff')throw Error('XML 根节点外有文本。');
  if(start<0){cursor=text.length;break;}
  if(++tokens>700000)throw Error('XML 节点数超出预算。');
  if(text.startsWith('<!--',start)){const end=text.indexOf('-->',start+4);if(end<0||text.slice(start+4,end).includes('--'))throw Error('XML 注释无效。');cursor=end+3;continue;}
  if(text.startsWith('<?',start)){const end=text.indexOf('?>',start+2);if(start>1||end<0||!/^<\?xml\s+version=([\"'])1\.0\1\s+encoding=([\"'])[Uu][Tt][Ff]-8\2(?:\s+standalone=([\"'])(?:yes|no)\3)?\s*\?>$/.test(text.slice(start,end+2)))throw Error('XML 声明必须为受支持的 UTF-8 / XML 1.0 格式。');cursor=end+2;continue;}
  if(text.startsWith('<!',start))throw Error('XML DTD、实体声明或 CDATA 不在当前切片格式支持范围。');
  let end=start+1,quote='';for(;end<text.length;end++){const ch=text[end];if(quote){if(ch===quote)quote='';}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break;else if(ch==='<')throw Error('XML 标签无效。');}
  if(end===text.length||quote)throw Error('XML 标签未闭合。');let body=text.slice(start+1,end);cursor=end+1;
  if(body.startsWith('/')){const name=body.slice(1).trim(),tag=stack.pop();if(!tag||tag.name!==name)throw Error('XML 结束标签不匹配。');close(tag,stack);continue;}
  const empty=body.endsWith('/');if(empty)body=body.slice(0,-1);
  const head=body.match(/^([A-Za-z_][\w.:-]*)/);if(!head)throw Error('XML 标签名无效。');const name=head[1],attrs:Record<string,string>=Object.create(null);let pos=name.length;
  while(pos<body.length){if(!/\s/.test(body[pos]))throw Error('XML 属性缺少分隔。');const rest=body.slice(pos);if(!rest.trim())break;const match=rest.match(/^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/);if(!match)throw Error('XML 属性无效。');if(Object.hasOwn(attrs,match[1]))throw Error('XML 属性重复。');attrs[match[1]]=entities(match[2]??match[3]);pos+=match[0].length;}
  const namespaces={...(stack.at(-1)?.namespaces??{xml:xmlNs})};for(const [key,value] of Object.entries(attrs)){if(key==='xmlns')namespaces['']=value;else if(key.startsWith('xmlns:'))namespaces[key.slice(6)]=value;}
  const expandedName=(key:string,attribute=false)=>{const bits=key.split(':');if(bits.length>2||bits.some(x=>!x))throw Error('XML 命名空间名称无效。');const ns=bits.length===2?namespaces[bits[0]]:attribute?'':namespaces['']??'';if(ns===undefined)throw Error('XML 使用未声明的命名空间。');return {ns,local:bits.at(-1)!};};
  const expanded:Record<string,string>=Object.create(null);for(const [key,value] of Object.entries(attrs)){if(key==='xmlns'||key.startsWith('xmlns:'))continue;const x=expandedName(key,true),e=x.ns+'|'+x.local;if(Object.hasOwn(expanded,e))throw Error('XML 展开属性重复。');expanded[e]=value;}
  const x=expandedName(name),tag={name,...x,attrs,expanded,namespaces};if(!stack.length&&++roots!==1)throw Error('XML 有多个根节点。');if(stack.length>=32)throw Error('XML 嵌套过深。');open(tag,stack);if(empty)close(tag,stack);else stack.push(tag);
 }
 if(stack.length||roots!==1)throw Error('XML 文档不完整。');
}
