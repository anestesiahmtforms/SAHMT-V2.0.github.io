import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {validChannelEndpoint} from '../src/provisional-channel-client.js';
const directory=path.resolve('.local-preview/provisional-channel-package');fs.mkdirSync(directory,{recursive:true});
if(!process.argv.includes('--skip-tests')){
 const result=spawnSync(process.execPath,['--test','tests/provisional-channel.test.js','tests/provisional-channel-workerd.test.js'],{stdio:['ignore',fs.openSync(path.join(directory,'tests.log'),'w'),'pipe']});
 if(result.status!==0){console.log(JSON.stringify({code:'CHANNEL_LOCAL_VALIDATION_FAILED',report:'.local-preview/provisional-channel-package/tests.log'}));process.exit(1);}
}
await build({entryPoints:['worker-operational-channel/worker.js'],outfile:path.join(directory,'worker.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',tsconfigRaw:{}});
const config=fs.readFileSync('worker-operational-channel/wrangler.toml','utf8');
if(!config.includes('OPERATIONAL_CHANNEL_ENABLED = "false"')||!config.includes('new_sqlite_classes'))throw Error('CHANNEL_UNSAFE_PACKAGE_CONFIGURATION');
fs.writeFileSync(path.join(directory,'wrangler.toml'),config.replace('main = "worker.js"','main = "worker.mjs"'));
fs.copyFileSync('worker-operational-channel/README.md',path.join(directory,'README.md'));
const configured=Boolean(process.env.VITE_OPERATIONAL_CHANNEL_ENDPOINT),valid=configured&&validChannelEndpoint(process.env.VITE_OPERATIONAL_CHANNEL_ENDPOINT);
const report={schemaVersion:1,code:'CHANNEL_LOCAL_PACKAGE_READY',workerEnabled:false,frontendEndpoint:configured?(valid?'FORMAT_VALID_NOT_REMOTELY_VERIFIED':'FORMAT_INVALID'):'NOT_CONFIGURED',
 collections:['checklists','events','labels','scheduleReleases'],sqliteBindings:['OPERATIONAL_CHANNEL_STATE','OPERATIONAL_CHANNEL_AUTHORIZATION'],
 auth:'FIREBASE_AUTH_FA_SERVER_VERIFIED',bootstrap:'SERVER_VERIFIED_PROFILE_REQUIRED',pollingSeconds:60,grantMaxHours:24,
 productionFirestoreReads:0,productionFirestoreWrites:0,deployed:false,secretsIncluded:false,
 externalRequirements:['CLOUDFLARE_FREE_ACCOUNT_AND_SQLITE_BINDINGS','FA_WEB_API_KEY_RESTRICTIONS_CHECK','FRESH_SERVER_AUTHORIZATION','WORKER_ENDPOINT_AND_PWA_BUILD_VARIABLE']};
fs.writeFileSync(path.join(directory,'readiness.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
