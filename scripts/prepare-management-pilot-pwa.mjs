import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadEnv} from 'vite';
import {managementPilotPwaConfig, managementPilotManifest, managementPilotServiceWorker,
  managementPilotAssetsConfig, validateManagementPilotFirebaseConfig} from './lib/management-pilot-pwa.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] !== '--endpoint' || args.length > 3 || args[2] !== undefined && args[2] !== '--enabled')
    throw Error('PILOT_ARGUMENTS_INVALID');
  const flags = managementPilotPwaConfig({endpoint: args[1], enabled: args[2] === '--enabled'});
  validateManagementPilotFirebaseConfig({...loadEnv('management-pilot', root), ...process.env});
  const output = resolve(root, '.local-preview/management-auth-pilot');
  const dist = resolve(output, 'dist');
  await mkdir(output, {recursive: true});
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--base', '/',
    '--outDir', dist, '--mode', 'management-pilot'], {cwd: root, shell: false, stdio: 'inherit', env: {...process.env, ...flags}});
  if (result.error || result.status !== 0) throw Error('PILOT_BUILD_FAILED');
  const manifest = managementPilotManifest(JSON.parse(await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8')));
  await writeFile(resolve(dist, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(resolve(dist, 'service-worker.js'), managementPilotServiceWorker(await readFile(resolve(dist, 'service-worker.js'), 'utf8')));
  const config = managementPilotAssetsConfig();
  await writeFile(resolve(output, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
  const report = {code: 'PILOT_PWA_BUILD_READY', deployed: false, secondaryAuthEnabled: args[2] === '--enabled',
    firstLoginEnabled: false, adminCohortUiEnabled: false, diagnosticsEnabled: true, workerName: config.name, flags,
    prerequisites: ['BROKER_SINGLE_UID_ALLOWLIST', 'BROKER_PILOT_ORIGIN_MATCHES_HOST', 'FA_AUTHORIZED_DOMAIN_MATCHES_HOST'],
    sha256: {}};
  for (const file of ['index.html', 'manifest.webmanifest', 'service-worker.js', 'assets-manifest.json'])
    report.sha256[file] = createHash('sha256').update(await readFile(resolve(dist, file))).digest('hex');
  await writeFile(resolve(output, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({code: report.code, deployed: false, secondaryAuthEnabled: report.secondaryAuthEnabled,
    firstLoginEnabled: false, diagnosticsEnabled: true, sourceEnvironmentChanged: false, publicPwaChanged: false}));
} catch (error) {
  console.error(JSON.stringify({code: /^PILOT_[A-Z_]+$/.test(error?.message) ? error.message : 'PILOT_PREPARATION_FAILED'}));
  process.exitCode = 1;
}
