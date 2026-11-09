import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fdManualCloudflare} from './lib/fd-manual-cloudflare.js';
import {sealPrivateJson} from './lib/windows-protected-json.js';

// Replace code only. Never enable runtime flags, rotate secrets, or start a batch.
const cf=await fdManualCloudflare();
const compile=async entry=>(await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*'],write:false})).outputFiles[0].text;
const hash=value=>createHash('sha256').update(value).digest('hex');
const source=async raw=>{
 const form=await new Response(raw.content,{headers:{'Content-Type':raw.contentType}}).formData();
 const file=form.get('index.js');if(!file)throw Error('CLEANUP_UNEXPECTED_MODULE');
 return typeof file==='string'?file:await file.text();
};
const [processor,scheduler,processorBefore,schedulerBefore,settings,schedulerSettings,schedules]=await Promise.all([
 compile('worker-indicators/worker.js'),compile('worker-fd-scheduler/worker.js'),cf.request('',{raw:true}),cf.schedulerRequest('',{raw:true}),cf.request('/settings'),cf.schedulerRequest('/settings'),cf.schedulerRequest('/schedules')
]);
if(!schedulerSettings.bindings.some(b=>b.name==='FD_INDICATOR_EXECUTOR'&&b.type==='service'&&b.service==='sahmt-indicators'))throw Error('CLEANUP_SCHEDULER_BINDING_INVALID');
const report={code:'SAHMT_ONLY_READY',processorSha256:hash(processor),schedulerSha256:hash(scheduler),legacyActionsEnabled:false,flagsChanged:false,businessWrites:0};
if(!process.argv.includes('--apply')){console.log(JSON.stringify(report));process.exit(0);}
await mkdir('.local-preview/sahmt-platform-retirement',{recursive:true});
await writeFile('.local-preview/sahmt-platform-retirement/before.dpapi.json',JSON.stringify(await sealPrivateJson({processorBefore,schedulerBefore,settings,schedulerSettings,schedules})));
const obsolete=new Set(['FA_WEB_API_KEY','OPERATIONAL_EVENTS_SOURCE_PROJECT','FD_STATION_FORWARD_ENABLED']);
function form(code,prior){
 const metadata={main_module:'index.js',compatibility_date:prior.compatibility_date,compatibility_flags:prior.compatibility_flags,keep_bindings:['secret_text'],bindings:prior.bindings.filter(b=>b.type!=='secret_text'&&!obsolete.has(b.name))};
 for(const key of ['usage_model','logpush','placement','tags','tail_consumers','observability','limits'])if(prior[key]!==undefined)metadata[key]=prior[key];
 const data=new FormData();data.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));data.set('index.js',new Blob([code],{type:'application/javascript+module'}),'index.js');return data;
}
await cf.request('',{method:'PUT',body:form(processor,settings)});
await cf.schedulerRequest('',{method:'PUT',body:form(scheduler,schedulerSettings)});
const [processorAfter,schedulerAfter,afterSettings,afterSchedulerSettings,afterSchedules]=await Promise.all([cf.request('',{raw:true}),cf.schedulerRequest('',{raw:true}),cf.request('/settings'),cf.schedulerRequest('/settings'),cf.schedulerRequest('/schedules')]);
if(hash(await source(processorAfter))!==hash(processor)||hash(await source(schedulerAfter))!==hash(scheduler))throw Error('CLEANUP_SOURCE_READBACK_FAILED');
for(const [before,after]of [[settings,afterSettings],[schedulerSettings,afterSchedulerSettings]]){
 for(const binding of before.bindings.filter(b=>!obsolete.has(b.name)))if(!after.bindings.some(b=>b.name===binding.name&&b.type===binding.type&&(b.type!=='plain_text'||b.text===binding.text)))throw Error('CLEANUP_EXISTING_BINDING_CHANGED');
 if(after.bindings.some(b=>obsolete.has(b.name)))throw Error('CLEANUP_LEGACY_BINDING_REMAINED');
}
if(JSON.stringify(afterSchedules)!==JSON.stringify(schedules))throw Error('CLEANUP_SCHEDULE_CHANGED');
const endpoint='https://sahmt-indicators.anestesiahmtforms4.workers.dev/v1/indicators',guards=[];
for(const [action,expected]of [['BOOTSTRAP',404],['REFRESH',404],['GET_PERFORMANCE',404],['GET_SAHMT_PERFORMANCE',401]]){
 const response=await fetch(endpoint,{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action,input:{}}),signal:AbortSignal.timeout(25000)});
 const body=await response.json();if(response.status!==expected)throw Error('CLEANUP_LIVE_GUARD_FAILED_'+action+'_'+response.status);guards.push({action,status:response.status,code:body.code});
}
const result={...report,code:'SAHMT_ONLY_DEPLOYED',guards,schedulePreserved:true,secretsPreserved:true,obsoleteBindingsRemoved:true,at:new Date().toISOString()};
await writeFile('.local-preview/sahmt-platform-retirement/deployed.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
