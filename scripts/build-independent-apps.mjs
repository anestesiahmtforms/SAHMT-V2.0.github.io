import {spawnSync} from 'node:child_process';
import {readFile, writeFile, cp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {stampShellRelease} from './lib/shell-release.js';
import {APP_VERSION} from '../src/app-version.js';
import {validateAppPublication} from './lib/app-publication.js';
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const rootBase = '/SAHMT-V2.0.github.io/', fbBase = rootBase + 'gestao/';
const faOnly=process.argv.includes('--fa-only');
const publication=process.env.SAHMT_PUBLICATION_FILE?validateAppPublication(JSON.parse(await readFile(process.env.SAHMT_PUBLICATION_FILE,'utf8'))):null;
if(process.env.CI==='true'&&process.env.GITHUB_REF==='refs/heads/main'&&['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)&&!publication)throw Error('APP_PUBLICATION_PLAN_REQUIRED');
if(publication&&process.env.GITHUB_SHA&&publication.sourceRevision!==process.env.GITHUB_SHA)throw Error('APP_PUBLICATION_SOURCE_MISMATCH');
const shellRelease=publication?.release||Date.now(),appVersion=publication?.appVersion||APP_VERSION;
for (const target of faOnly?['FA']:['FA', 'FB']) {
  const env = {...process.env, SAHMT_DEPLOYMENT_TARGET:target, VITE_APP_RELEASE:String(shellRelease),VITE_APP_VERSION:appVersion};
  if (target === 'FB') Object.assign(env, {
    VITE_MANAGEMENT_FIREBASE_ENABLED:'false', VITE_INDICATORS_FIREBASE_ENABLED:'false',
    VITE_FIREBASE_PROJECT_AUTH_ENABLED:'false', VITE_FIREBASE_PROJECT_AUTH_AUTO_CONNECT_ENABLED:'false',
    VITE_OPERATIONAL_CONTINUITY_ENABLED:'false', VITE_OPERATIONAL_CHANNEL_REALTIME_ENABLED:'false',
    VITE_OPERATIONAL_CHANNEL_ENDPOINT:'', VITE_LABEL_AI_ENABLED:'false',
    VITE_MANAGEMENT_FA_FIRST_LOGIN_ENABLED:'false',
    VITE_GOOGLE_PROJECT_AUTH_ENABLED:'false'
  });
  const result = spawnSync(process.execPath, [vite, 'build'], {stdio:'inherit', env});
  if (result.error || result.status !== 0) process.exit(result.status || 1);
  const workerPath=new URL(target==='FB'?'../dist/gestao/service-worker.js':'../dist/service-worker.js',import.meta.url);
  await writeFile(workerPath,stampShellRelease(await readFile(workerPath,'utf8'),shellRelease));
}
// FB owns a narrower service-worker scope and a separate cache namespace.
if(!faOnly){
const swPath = new URL('../dist/gestao/service-worker.js', import.meta.url);
let sw = await readFile(swPath, 'utf8');
sw = sw.replaceAll(rootBase, fbBase).replaceAll('sahmt-v2-', 'sahmt-fb-v2-');
await writeFile(swPath, sw);
const manifestPath = new URL('../dist/gestao/manifest.webmanifest', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
Object.assign(manifest, {id:fbBase, name:'SAHMT · Gestão e Desempenho', short_name:'SAHMT Gestão', start_url:fbBase, scope:fbBase});
manifest.icons = manifest.icons.map(icon => ({...icon, src:icon.src.replace(rootBase, fbBase)}));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
console.log(faOnly?'FA_ONLY_BUILD_READY':'INDEPENDENT_FA_FB_BUILDS_READY');
// Outside the installed shell's cache: administrators select the published
// release, while device receipts use the independently embedded JS release.
await writeFile(new URL('../dist/tools/app-release.json',import.meta.url),JSON.stringify({
  schema:1,appVersion,...(publication?{sourceRevision:publication.sourceRevision}:{}),targets:faOnly?{FA:shellRelease}:{FA:shellRelease,FB:shellRelease}
}));

// Publish surveys on the app origin so Firebase can restore the existing sessions.
const surveys=spawnSync(process.execPath,[vite,'build','--config','vite.climate.config.js','--configLoader','native'],{
  stdio:'inherit',env:{...process.env,SAHMT_SURVEY_BASE:rootBase+'enquetes/',SAHMT_SURVEY_OUT_DIR:'../dist/enquetes'}
});
if(surveys.error||surveys.status!==0)process.exit(surveys.status||1);

// Legacy installed shells already exclude tools/ from their navigation cache.
// Keep this entry available without requiring a cache reset or another login.
await cp(new URL('../dist/enquetes/',import.meta.url),new URL('../dist/tools/enquetes/',import.meta.url),{recursive:true});

