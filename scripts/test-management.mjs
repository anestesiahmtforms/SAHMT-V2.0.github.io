import {readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = (await readdir(resolve(root, 'tests')))
  .filter(name => /^management-[a-z0-9-]+\.test\.js$/.test(name) && !name.endsWith('.rules.test.js'))
  .sort().map(name => resolve(root, 'tests', name));
files.push(...['firestore-snapshot-capture.test.js', 'performance-consolidation.test.js',
  'windows-protected-json.test.js'].map(name => resolve(root, 'tests', name)));
if (!files.length) throw Error('MANAGEMENT_TESTS_MISSING');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files],
  {cwd:root, stdio:'inherit', shell:false});
if (result.error) {
  console.error('MANAGEMENT_TEST_PROCESS_FAILED');
  process.exitCode = 1;
} else {
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}