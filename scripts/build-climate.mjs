import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const result = spawnSync(process.execPath, [vite, 'build', '--config', 'vite.climate.config.js', '--configLoader', 'native'], {stdio: 'inherit'});
if (result.error || result.status !== 0) process.exit(result.status || 1);
