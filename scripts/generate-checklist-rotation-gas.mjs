import {readFile, writeFile} from 'node:fs/promises';

const sourcePath = new URL('../src/checklist-rotation-core.js', import.meta.url);
const targetPath = new URL('../apps-script-v2/ChecklistRotationCore.gs', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
if (/^\s*import\s/m.test(source)) throw new Error('Shared rotation source must stay dependency-free.');
const generated = source.replace(/^export function /gm, 'function ');
if (process.argv.includes('--check')) {
  if ((await readFile(targetPath, 'utf8')).replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n')) throw new Error('Generated rotation is stale. Run the generator before publishing.');
  process.stdout.write('CHECKLIST_ROTATION_GAS_MATCHED\n');
} else {
  await writeFile(targetPath, generated, 'utf8');
  process.stdout.write('CHECKLIST_ROTATION_GAS_GENERATED\n');
}
