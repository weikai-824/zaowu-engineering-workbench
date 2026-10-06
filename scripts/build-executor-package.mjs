import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(repoRoot,'public/executor/cad-workstation.zip');
const packageDate=new Date('2026-01-01T00:00:00Z');
const files=new Map([
  ['cad/run_cad.py','public/cad/run_cad.py'],
  ['cad/requirements-windows-py312.txt','public/cad/requirements-windows-py312.txt'],
  ['cad/README.md','public/cad/README.md'],
  ['executor/local_cad_relay.py','public/executor/local_cad_relay.py'],
  ['executor/requirements-controller-windows-py312.txt','public/executor/requirements-controller-windows-py312.txt'],
  ['executor/README.md','public/executor/README.md'],
]);

const zip=new JSZip();
const hashes={};
for(const [archivePath,sourcePath] of files){
  const data=await readFile(path.join(repoRoot,sourcePath));
  hashes[archivePath]=createHash('sha256').update(data).digest('hex');
  zip.file(archivePath,data,{date:packageDate,createFolders:false});
}
zip.file('README.md','请先阅读 executor/README.md。包含自动连接控制器和 CAD 执行器；尚未实机生产验证。\n',{date:packageDate,createFolders:false});
zip.file('file-hashes.json',JSON.stringify(hashes,null,2)+'\n',{date:packageDate,createFolders:false});
const data=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:9},platform:'DOS'});
await writeFile(output,data);
console.log(`Executor package updated: ${path.relative(repoRoot,output)} (${data.length} bytes)`);
