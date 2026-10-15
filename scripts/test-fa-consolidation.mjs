import {readdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tests=(await readdir(new URL('../tests/',import.meta.url))).filter(name=>/^fa-consolidation-.*\.test\.js$/.test(name));
tests.push('firebase-cli-account-token.test.js');
const result=spawnSync(process.execPath,['--test',...tests.map(name=>fileURLToPath(new URL('../tests/'+name,import.meta.url)))],{stdio:'inherit',shell:false});
process.exitCode=result.error?1:result.status??1;
