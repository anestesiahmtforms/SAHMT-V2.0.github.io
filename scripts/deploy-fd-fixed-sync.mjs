import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';
import {feRelaySecret,smokeFeRelay,FE_PERFORMANCE_READ_URL} from './lib/fe-performance-relay-release.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fdManualCloudflare} from './lib/fd-manual-cloudflare.js';
import {sealPrivateJson,openPrivateJson} from './lib/windows-protected-json.js';
import {FD_FIXED_CRON} from '../worker-indicators/schedule-envelope.js';
import {SOURCE_READ_LIMITS} from '../worker-indicators/read-budget.js';
const cf=await fdManualCloudflare(),dir='.local-preview/fd-fixed-sync';await mkdir(dir,{recursive:true});
const [targetBefore,targetSettings,controllerBefore,controllerSettings,oldSchedule]=await Promise.all([cf.request('',{raw:true}),cf.request('/settings'),cf.schedulerRequest('',{raw:true}),cf.schedulerRequest('/settings'),cf.schedulerRequest('/schedules')]);
if(controllerSettings&&!controllerSettings.bindings.some(b=>b.name==='FD_INDICATOR_EXECUTOR'&&b.type==='service'&&b.service==='sahmt-indicators'))throw Error('FD_SCHEDULER_NAME_CONFLICT');
const hash=s=>createHash('sha256').update(s).digest('hex');
async function sourceHash(raw){if(!raw)return null;const form=await new Response(raw.content,{headers:{'Content-Type':raw.contentType}}).formData(),parts=[];for(const [name,value]of form)parts.push([name,typeof value==='string'?value:await value.text()]);return hash(JSON.stringify(parts.sort((a,b)=>a[0].localeCompare(b[0]))));}
const compile=async entry=>(await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*'],write:false})).outputFiles[0].text;
const [targetSource,controllerSource]=await Promise.all([compile('worker-indicators/worker.js'),compile('worker-fd-scheduler/worker.js')]);
if(GOOGLE_PROJECT_CONFIG.FD.config.projectId!=='rotinas-8a617'||!GOOGLE_PROJECT_CONFIG.FD.config.apiKey)throw Error('FD_WEB_CONFIG_INVALID');
const performanceEnabled=process.argv.includes('--enable-performance')||targetSettings.bindings.some(b=>b.name==='SAHMT_PERFORMANCE_ENABLED'&&b.text==='true');
const preflight={code:'FD_FIXED_SYNC_READY',cronUTC:FD_FIXED_CRON,timesBrasilia:['02:00'],sourceReadLimitPerProject:6000,sourceReadLimits:SOURCE_READ_LIMITS,performanceEnabled,legacyPlatformRemoved:true,paidChanges:0,targetSha256:hash(targetSource),schedulerSha256:hash(controllerSource)};
if(!process.argv.includes('--apply')){console.log(JSON.stringify(preflight));process.exit(0);}
// No remote mutation, including schedule suspension, occurs before relay proof.
if((controllerSettings?.bindings||[]).some(b=>['FE_PERFORMANCE_READ_SECRET','FE_PERFORMANCE_READ_URL'].includes(b.name)))throw Error('FE_RELAY_SCHEDULER_BINDING_FORBIDDEN');
const relaySecret=performanceEnabled?await feRelaySecret():null;
const relaySmoke=performanceEnabled?await smokeFeRelay({secret:relaySecret}):null;
await writeFile(dir+'/before-'+Date.now()+'.dpapi.json',JSON.stringify(await sealPrivateJson({targetBefore,targetSettings,controllerBefore,controllerSettings,oldSchedule})));
let protectedSecret;try{protectedSecret=await openPrivateJson(JSON.parse(await readFile(dir+'/schedule-secret.dpapi.json','utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
if(!protectedSecret){protectedSecret={secret:randomBytes(32).toString('base64url')};await writeFile(dir+'/schedule-secret.dpapi.json',JSON.stringify(await sealPrivateJson(protectedSecret)));}
const secret=protectedSecret.secret;if(!/^[A-Za-z0-9_-]{43}$/.test(secret))throw Error('FD_SCHEDULE_SECRET_INVALID');
const [freshTarget,freshController,freshSettings,freshControllerSettings]=await Promise.all([cf.request('',{raw:true}),cf.schedulerRequest('',{raw:true}),cf.request('/settings'),cf.schedulerRequest('/settings')]);
if(await sourceHash(freshTarget)!==await sourceHash(targetBefore)||await sourceHash(freshController)!==await sourceHash(controllerBefore)||JSON.stringify(freshSettings.bindings)!==JSON.stringify(targetSettings.bindings)||JSON.stringify(freshControllerSettings?.bindings)!==JSON.stringify(controllerSettings?.bindings))throw Error('FD_REMOTE_DRIFT');
if(controllerSettings)await cf.schedulerRequest('/schedules',{method:'PUT',body:[]});
await cf.request('/schedules',{method:'PUT',body:[]});
function form(source,metadata){const f=new FormData();f.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));f.set('index.js',new Blob([source],{type:'application/javascript+module'}),'index.js');return f;}
const managedBindings=['FD_FIXED_REFRESH_ENABLED','SAHMT_PERFORMANCE_ENABLED','FD_SCHEDULE_HMAC_SECRET','FE_PERFORMANCE_READ_URL','FE_PERFORMANCE_READ_SECRET','FD_WEB_API_KEY'];
const activationBindings=[{type:'plain_text',name:'FD_FIXED_REFRESH_ENABLED',text:'true'},{type:'plain_text',name:'SAHMT_PERFORMANCE_ENABLED',text:String(performanceEnabled)},{type:'secret_text',name:'FD_SCHEDULE_HMAC_SECRET',text:secret}];
const relayBindings=performanceEnabled?[{type:'plain_text',name:'FD_WEB_API_KEY',text:GOOGLE_PROJECT_CONFIG.FD.config.apiKey},{type:'plain_text',name:'FE_PERFORMANCE_READ_URL',text:FE_PERFORMANCE_READ_URL},{type:'secret_text',name:'FE_PERFORMANCE_READ_SECRET',text:relaySecret}]:targetSettings.bindings.filter(b=>b.type!=='secret_text'&&['FE_PERFORMANCE_READ_URL','FD_WEB_API_KEY'].includes(b.name));
const metadata={main_module:'index.js',compatibility_date:targetSettings.compatibility_date,compatibility_flags:targetSettings.compatibility_flags,keep_bindings:['secret_text'],bindings:[...targetSettings.bindings.filter(b=>b.type!=='secret_text'&&!managedBindings.includes(b.name)),...activationBindings,...relayBindings]};
for(const k of ['usage_model','logpush','placement','tags','tail_consumers','observability','limits'])if(targetSettings[k]!==undefined)metadata[k]=targetSettings[k];
await cf.request('',{method:'PUT',body:form(targetSource,metadata)});
const controllerMetadata={main_module:'index.js',compatibility_date:controllerSettings?.compatibility_date||'2026-11-02',compatibility_flags:controllerSettings?.compatibility_flags||['nodejs_compat'],keep_bindings:['secret_text'],bindings:[...(controllerSettings?.bindings||[]).filter(b=>b.type!=='secret_text'&&![...managedBindings,'FD_INDICATOR_EXECUTOR'].includes(b.name)),...activationBindings,{type:'service',name:'FD_INDICATOR_EXECUTOR',service:'sahmt-indicators'}],observability:{enabled:false}};
for(const k of ['usage_model','logpush','placement','tags','tail_consumers','observability','limits'])if(controllerSettings?.[k]!==undefined)controllerMetadata[k]=controllerSettings[k];
await cf.schedulerRequest('',{method:'PUT',body:form(controllerSource,controllerMetadata)});
await cf.schedulerRequest('/subdomain',{method:'POST',body:{enabled:false,previews_enabled:false}});
await cf.schedulerRequest('/schedules',{method:'PUT',body:[{cron:FD_FIXED_CRON}]});
const [settings,schedules,processorRaw,schedulerRaw,subdomain,processorSchedules,schedulerSettings]=await Promise.all([cf.request('/settings'),cf.schedulerRequest('/schedules'),cf.request('',{raw:true}),cf.schedulerRequest('',{raw:true}),cf.schedulerRequest('/subdomain'),cf.request('/schedules'),cf.schedulerRequest('/settings')]);
const parts=async raw=>{const f=await new Response(raw.content,{headers:{'Content-Type':raw.contentType}}).formData();const p=f.get('index.js');return typeof p==='string'?p:await p.text();};
if(hash(await parts(processorRaw))!==hash(targetSource)||hash(await parts(schedulerRaw))!==hash(controllerSource))throw Error('FD_SOURCE_READBACK_FAILED');
const entries=schedules.schedules||schedules;if(entries.length!==1||entries[0].cron!==FD_FIXED_CRON||subdomain.enabled!==false||(processorSchedules.schedules||processorSchedules).length!==0)throw Error('FD_SCHEDULE_READBACK_FAILED');
for(const binding of targetSettings.bindings)if(!settings.bindings.some(b=>b.name===binding.name&&b.type===binding.type))throw Error('FD_EXISTING_BINDING_LOST');
for(const binding of controllerSettings?.bindings||[])if(!schedulerSettings.bindings.some(b=>b.name===binding.name&&b.type===binding.type))throw Error('FD_EXISTING_SCHEDULER_BINDING_LOST');
if(!settings.bindings.some(b=>b.name==='FD_FIXED_REFRESH_ENABLED'&&b.text==='true'))throw Error('FD_FLAG_NOT_ENABLED');
for(const result of [settings,schedulerSettings])if(!result.bindings.some(b=>b.name==='SAHMT_PERFORMANCE_ENABLED'&&b.text===String(performanceEnabled)))throw Error('SAHMT_PERFORMANCE_FLAG_READBACK_FAILED');
if(performanceEnabled&&!settings.bindings.some(b=>b.name==='FD_WEB_API_KEY'&&b.text===GOOGLE_PROJECT_CONFIG.FD.config.apiKey))throw Error('FD_WEB_API_KEY_READBACK_FAILED');
if(performanceEnabled&&(!settings.bindings.some(b=>b.name==='FE_PERFORMANCE_READ_URL'&&b.text===FE_PERFORMANCE_READ_URL)||!settings.bindings.some(b=>b.name==='FE_PERFORMANCE_READ_SECRET'&&b.type==='secret_text')))throw Error('FE_RELAY_EXECUTOR_BINDING_READBACK_FAILED');
const report={...preflight,relaySmoke,code:'FD_FIXED_SYNC_ACTIVE',account:'434b7325287b58f36d214c9403819db2',schedulerWorker:'sahmt-fd-refresh-scheduler',processorWorker:'sahmt-indicators',schedulerPublic:false,bindingsPreserved:true,firstScheduledCycle:'pending next configured window',businessWrites:0,at:new Date().toISOString()};
await writeFile(dir+'/deployed.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
