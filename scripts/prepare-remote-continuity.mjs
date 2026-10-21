import fs from 'node:fs/promises';import path from 'node:path';import{build}from'esbuild';
const directory=path.resolve('.local-preview/remote-continuity/package');await fs.mkdir(directory,{recursive:true});
await build({entryPoints:['worker-operational-channel/worker.js'],outfile:path.join(directory,'worker.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',tsconfigRaw:{}});
await build({entryPoints:['src/remote-continuity-reconciliation.js'],outfile:'apps-script-v2/OperationalContinuityCore.gs',bundle:true,format:'iife',globalName:'SahmtContinuity',platform:'browser',target:'es2020',tsconfigRaw:{}});
for(const name of ['OperationalContinuitySync.gs','OperationalContinuityCore.gs'])await fs.copyFile('apps-script-v2/'+name,path.join(directory,name));
const config=await fs.readFile('worker-operational-channel/wrangler.toml','utf8');if(!config.includes('OPERATIONAL_CONTINUITY_ENABLED = "false"'))throw Error('CONTINUITY_PACKAGE_FLAG_UNSAFE');
await fs.writeFile(path.join(directory,'readiness.json'),JSON.stringify({code:'CONTINUITY_LOCAL_PACKAGE_READY',productionFirestoreReads:0,productionFirestoreWrites:0,workerDefaultEnabled:false,automaticAfterLiveValidation:true,emptyQueueFirestoreReads:0,maxOperationsPerServerRun:20,fullSeedRuns:1,profileMaxDays:7},null,2));
console.log('CONTINUITY_LOCAL_PACKAGE_READY');
