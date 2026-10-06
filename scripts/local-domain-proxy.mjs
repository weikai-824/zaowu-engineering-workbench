import http from 'node:http';
import net from 'node:net';

const domain='www.3dprinthub.cn';
const upstreamPort=Number(process.env.LOCAL_APP_PORT||8787);
const listenPort=Number(process.env.LOCAL_DOMAIN_PORT||80);
const executorPort=8837;
const executorPrefix='/__local-cad-executor';
const executorOrigin='http://127.0.0.1';
const demoIdentity={
  'oai-authenticated-user-id':'local_seedy',
  'oai-authenticated-user-email':'seedy@sites.test',
  'oai-authenticated-user-full-name':'Seedy',
  'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8',
};

function validHost(request){return request.headers.host===domain || request.headers.host===`${domain}:${listenPort}`;}
function unavailable(response){if(response.headersSent){response.destroy();return;}response.writeHead(502,{'content-type':'text/plain; charset=utf-8'});response.end(`本地工程台尚未启动。请确认 127.0.0.1:${upstreamPort} 正在运行。`);}
function upstreamHeaders(headers){return {...headers,...demoIdentity};}
function executorPath(request){
  const url=new URL(request.url||'/',`http://${domain}`);
  if(!url.pathname.startsWith(`${executorPrefix}/`))return null;
  return url.pathname.slice(executorPrefix.length)+url.search;
}
function executorHeaders(headers){
  const result={host:`127.0.0.1:${executorPort}`,origin:executorOrigin};
  for(const name of ['accept','content-type','content-length','x-executor-token']){
    const value=headers[name];
    if(typeof value==='string')result[name]=value;
  }
  return result;
}
function executorUnavailable(response){
  if(response.headersSent){response.destroy();return;}
  const data=Buffer.from(JSON.stringify({error:`本机执行器未在 127.0.0.1:${executorPort} 运行，请启动执行器后使用新配对码。`}));
  response.writeHead(502,{'content-type':'application/json; charset=utf-8','content-length':data.length,'cache-control':'no-store'});
  response.end(data);
}
function proxyExecutor(request,response,path){
  const upstream=http.request({hostname:'127.0.0.1',port:executorPort,method:request.method,path,headers:executorHeaders(request.headers)},incoming=>{
    response.writeHead(incoming.statusCode||502,incoming.headers);
    incoming.pipe(response);
  });
  upstream.on('error',()=>executorUnavailable(response));
  request.pipe(upstream);
}

const server=http.createServer((request,response)=>{
  if(!validHost(request)){response.writeHead(421);response.end('Unknown local demo host');return;}
  const localExecutorPath=executorPath(request);
  if(localExecutorPath){proxyExecutor(request,response,localExecutorPath);return;}
  const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,method:request.method,path:request.url,headers:upstreamHeaders(request.headers)},incoming=>{
    response.writeHead(incoming.statusCode||502,incoming.headers);
    incoming.pipe(response);
  });
  upstream.on('error',()=>unavailable(response));
  request.pipe(upstream);
});

server.on('upgrade',(request,socket,head)=>{
  if(!validHost(request)){socket.destroy();return;}
  const upstream=net.connect(upstreamPort,'127.0.0.1');
  upstream.once('connect',()=>{
    const rawHeaders=[];
    for(const [name,value] of Object.entries(upstreamHeaders(request.headers)))rawHeaders.push(`${name}: ${value}`);
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${rawHeaders.join('\r\n')}\r\n\r\n`);
    if(head.length)upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error',()=>socket.destroy());
  socket.on('error',()=>upstream.destroy());
});

server.listen(listenPort,'127.0.0.1',()=>console.log(`Local demo: http://${domain}/ → http://127.0.0.1:${upstreamPort}/`));
