import {spawnSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const rootBase = '/SAHMT-V2.0.github.io/', fbBase = rootBase + 'gestao/';
const faOnly=process.argv.includes('--fa-only');
for (const target of faOnly?['FA']:['FA', 'FB']) {
  const env = {...process.env, SAHMT_DEPLOYMENT_TARGET:target};
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

// Publish surveys on the app origin so Firebase can restore the existing sessions.
const surveys=spawnSync(process.execPath,[vite,'build','--config','vite.climate.config.js','--configLoader','native'],{
  stdio:'inherit',env:{...process.env,SAHMT_SURVEY_BASE:rootBase+'enquetes/',SAHMT_SURVEY_OUT_DIR:'../dist/enquetes'}
});
if(surveys.error||surveys.status!==0)process.exit(surveys.status||1);
