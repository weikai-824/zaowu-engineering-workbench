/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

async function main() {
  const root = path.resolve(__dirname, '..');
  const dir = path.join(root, 'work', 'validation', 'p1i');
  const task = JSON.parse(fs.readFileSync(path.join(dir, 'created-task.json'), 'utf8'));
  const zip = new JSZip();
  zip.file('manifest.json', task.manifestJson);
  zip.file('manifest.sha256', `${task.manifestSha256}\n`);
  for (const name of Object.keys(task.manifest.files)) {
    const source = name === 'input.stl'
      ? path.join(dir, 'current-input.stl')
      : path.join(root, 'public', 'offline-bambu', name);
    const data = fs.readFileSync(source);
    zip.file(name, data);
  }
  const output = path.join(dir, `${task.id}-task.zip`);
  fs.writeFileSync(output, await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
  console.log(JSON.stringify({taskId: task.id, manifestSha256: task.manifestSha256, output, bytes: fs.statSync(output).size}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
