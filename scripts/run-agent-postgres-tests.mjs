import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const composeFile=resolve(repositoryRoot,'services','agent','compose.test.yml');
const composeArgs=['compose','-p','zaowu-agent-stage2-test','-f',composeFile];

function run(command,args,options={}){
 return new Promise((resolvePromise,reject)=>{
  const child=spawn(command,args,{cwd:repositoryRoot,stdio:'inherit',...options});
  child.once('error',reject);
  child.once('exit',(code,signal)=>{
   if(code===0)return resolvePromise();
   reject(new Error(`${command} failed${signal?` with signal ${signal}`:` with exit code ${code}`}`));
  });
 });
}

let containerStarted=false;
try{
 await run('docker',['info']);
 await run('docker',[...composeArgs,'up','-d','--wait']);
 containerStarted=true;
 await run(
  'uv',
  ['run','--project','services/agent','pytest','-m','integration','--no-cov','services/agent/tests'],
  {env:{...process.env,AGENT_TEST_DATABASE_URL:'postgresql://agent:agent_test@127.0.0.1:55433/zaowu_agent_test?sslmode=disable'}},
 );
}finally{
 if(containerStarted)await run('docker',[...composeArgs,'down','--volumes','--remove-orphans']);
}
