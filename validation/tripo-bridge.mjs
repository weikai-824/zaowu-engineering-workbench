import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const vite=await createServer({root,configFile:false,resolve:{alias:{'@':root}},optimizeDeps:{noDiscovery:true},server:{middlewareMode:true},appType:'custom',logLevel:'error'});
const originalFetch=globalThis.fetch;
const originalRequest=globalThis.Request;
try{
 globalThis.Request=class extends originalRequest{
  constructor(input,init){assert.notEqual(init?.redirect,'error','Workers does not support redirect:error');super(input,init);}
 };
 const {tripoFetcher}=await vite.ssrLoadModule('/lib/tripo-provider.ts');
 const captured=[];
 globalThis.fetch=async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:17890/fetch');
  captured.push(JSON.parse(init.body));
  return Response.json({code:0,data:{file_token:'test-token'}});
 };
 const fetcher=tripoFetcher(undefined,'http://127.0.0.1:17890');
 const form=new FormData();
 form.append('file',new Blob([new Uint8Array([0,128,255,10])],{type:'image/png'}),'reference.png');
 await fetcher('https://openapi.tripo3d.ai/v3/files',{method:'POST',headers:{Authorization:'Bearer test'},body:form});
 const request=captured[0];
 const multipart=new Response(Buffer.from(request.bodyBase64,'base64'),{headers:request.headers});
 const decoded=(await multipart.formData()).get('file');
 assert.equal(decoded.name,'reference.png');
 assert.deepEqual([...new Uint8Array(await decoded.arrayBuffer())],[0,128,255,10]);
 assert.equal(request.headers.authorization,'Bearer test');
 await fetcher('https://openapi.tripo3d.ai/v3/generation/text-to-model',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'桌面外壳'})});
 assert.equal(JSON.parse(Buffer.from(captured[1].bodyBase64,'base64').toString('utf8')).prompt,'桌面外壳');
 await fetcher('https://cdn.tripo3d.ai/result.glb');
 assert.equal(captured[2].bodyBase64,undefined);
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://example.com'}});
 await assert.rejects(()=>fetcher('https://openapi.tripo3d.ai/v3/account/balance',{redirect:'error'}),error=>error.code==='provider_redirect_rejected');
 globalThis.fetch=async()=>new Response('{}',{status:502,headers:{'x-tripo-bridge-error':'1'}});
 await assert.rejects(()=>fetcher('https://openapi.tripo3d.ai/v3/account/balance'),error=>error.code==='provider_unreachable');
 const {createLlmProvider}=await vite.ssrLoadModule('/lib/llm-provider.ts');
 globalThis.fetch=async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:17890/fetch');
  const forwarded=JSON.parse(init.body);
  assert.equal(forwarded.url,'https://example.ai/v1/chat/completions');
  assert.equal(forwarded.method,'POST');
  assert.equal(forwarded.headers.authorization,'Bearer test-key');
  assert.equal(JSON.parse(Buffer.from(forwarded.bodyBase64,'base64').toString('utf8')).model,'test-model');
  return Response.json({id:'completion-1',model:'test-model',choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]});
 };
 const ai=createLlmProvider({apiKey:'test-key',baseUrl:'https://example.ai/v1',model:'test-model',bridgeUrl:'http://127.0.0.1:17890'});
 assert.equal((await ai.completeJson({system:'test',user:'test'})).content,'{"ok":true}');
 console.log('Provider bridge: Tripo multipart, JSON, GET, upstream failure, and AI completion passed.');
}finally{
 globalThis.fetch=originalFetch;
 globalThis.Request=originalRequest;
 await vite.close();
}
