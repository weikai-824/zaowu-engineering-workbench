import {spawn} from 'node:child_process';

const checks=[
 'validation/glb-fixtures.cjs',
 'validation/glb-region-edit.cjs',
 'validation/tripo-submit.cjs',
 'validation/tripo-bridge.mjs',
 'validation/tripo-webhook.cjs',
 'validation/topology.cjs',
 'validation/slice-geometry.cjs',
 'validation/agent-contract.ts',
 'validation/agent-tool-gateway.mjs',
];

for(const file of checks){
 console.log(`[core-test] ${file}`);
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,file.endsWith('.ts')?['--experimental-strip-types',file]:[file],{stdio:'inherit'});
  child.once('error',reject);
  child.once('exit',(code,signal)=>{
   if(code===0)return resolve();
   reject(new Error(`${file} failed${signal?` with signal ${signal}`:` with exit code ${code}`}`));
  });
 });
}

console.log(`[core-test] ${checks.length} validation suites passed`);
