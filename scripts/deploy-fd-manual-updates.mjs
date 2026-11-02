import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fdManualCloudflare} from './lib/fd-manual-cloudflare.js';
import {sealPrivateJson} from './lib/windows-protected-json.js';
const {request,schedulerRequest}=await fdManualCloudflare(),dir='.local-preview/fd-manual-updates';await mkdir(dir,{recursive:true});
const [before,settings,schedules]=await Promise.all([request('',{raw:true}),request('/settings'),request('/schedules')]);
const bundle=await build({entryPoints:['worker-indicators/worker.js'],bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*'],write:false}),source=bundle.outputFiles[0].text;
const sha=text=>createHash('sha256').update(text).digest('hex');
async function sourceDigest(raw){const form=await new Response(raw.content,{headers:{'Content-Type':raw.contentType}}).formData(),parts=[];for(const [name,value]of form)parts.push([name,typeof value==='string'?value:await value.text()]);return sha(JSON.stringify(parts.sort((a,b)=>a[0].localeCompare(b[0]))));}
await writeFile(dir+'/before-'+Date.now()+'.dpapi.json',JSON.stringify(await sealPrivateJson({before,settings,schedules})));
if(!process.argv.includes('--apply')){console.log(JSON.stringify({code:'FD_MANUAL_DEPLOY_READY',sourceSha256:sha(source),currentSchedules:schedules.schedules||schedules,apply:false}));process.exit(0);}
const fresh=await request('',{raw:true}),freshSettings=await request('/settings');if(await sourceDigest(fresh)!==await sourceDigest(before)||JSON.stringify(freshSettings.bindings)!==JSON.stringify(settings.bindings))throw Error('FD_REMOTE_DRIFT');
// Disable existing triggers before deploying the no-op scheduled handler.
await request('/schedules',{method:'PUT',body:[]});
const fixed=await schedulerRequest('/settings');if(fixed)await schedulerRequest('/schedules',{method:'PUT',body:[]});
const metadata={main_module:'index.js',compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags,keep_bindings:['secret_text'],bindings:[...settings.bindings.filter(b=>b.type!=='secret_text'&&b.name!=='FD_FIXED_REFRESH_ENABLED'),{type:'plain_text',name:'FD_FIXED_REFRESH_ENABLED',text:'false'}]};
for(const key of ['usage_model','logpush','placement','tags','tail_consumers','observability','limits'])if(settings[key]!==undefined)metadata[key]=settings[key];
const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('index.js',new Blob([source],{type:'application/javascript+module'}),'index.js');await request('',{method:'PUT',body:form});
const [after,finalSchedules,download]=await Promise.all([request('/settings'),request('/schedules'),request('',{raw:true})]);
const oldNames=settings.bindings.map(b=>b.name).sort(),newNames=after.bindings.filter(b=>b.name!=='FD_FIXED_REFRESH_ENABLED'||oldNames.includes(b.name)).map(b=>b.name).sort();if(JSON.stringify(oldNames)!==JSON.stringify(newNames)||!after.bindings.some(b=>b.name==='INDICATOR_SERVICE_ACCOUNT_JSON'&&b.type==='secret_text'))throw Error('FD_BINDING_READBACK_FAILED');
const scheduled=finalSchedules.schedules||finalSchedules;if(!Array.isArray(scheduled)||scheduled.length)throw Error('FD_SCHEDULES_NOT_DISABLED');
const modules=await new Response(download.content,{headers:{'Content-Type':download.contentType}}).formData();const module=modules.get('index.js');if(!module||sha(typeof module==='string'?module:await module.text())!==sha(source))throw Error('FD_SOURCE_READBACK_FAILED');
const report={code:'FD_MANUAL_UPDATES_ACTIVE',account:'434b7325287b58f36d214c9403819db2',worker:'sahmt-indicators',automaticSchedules:0,sourceSha256:sha(source),bindingsPreserved:true,manualActivityRequired:true,faQueriesFilteredByYear:true,otherInstances:['FA','FB','FC','FE'],businessWrites:0,billingChanges:0,at:new Date().toISOString()};await writeFile(dir+'/deployed.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
