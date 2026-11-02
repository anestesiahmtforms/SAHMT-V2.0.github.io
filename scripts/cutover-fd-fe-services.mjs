import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createFaCloudflareClient} from './lib/fa-cloudflare-client.js';
import {targets,demand,cloudflare,unprotect,protect,report} from './lib/fd-fe-release.js';
const station=process.argv[2],target=targets[station];demand(target,'RELEASE_STATION_INVALID');
const worker=station==='FD'?'sahmt-indicators':'sahmt-html-training';
const client=await createFaCloudflareClient();demand(client.accountId==='1851e9f4cd5f026371beaa2c5a85f1b8','RELEASE_CENTRAL_ACCOUNT_MISMATCH');
const path='/workers/scripts/'+worker,before=await unprotect(worker+'-central-before');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function modules(source){const form=await new Response(source.content,{headers:{'Content-Type':source.contentType}}).formData();const files={};for(const[name,part]of form)files[name]=typeof part==='string'?part:await part.text();return files;}
const original=await modules(before.source),settings=await client.request(path+'/settings'),live=await modules(await client.request(path,{raw:true}));
demand(Object.keys(original).length===1&&typeof original['worker.js']==='string','RELEASE_ORIGINAL_MODULE_UNEXPECTED');
const files={...original,'station-forward.js':await readFile('worker-station-forwarding/forward.js','utf8'),
 'station-entry.js':`import legacy from './worker.js'; import {stationAwareWorker} from './station-forward.js'; export default stationAwareWorker(legacy,'${station}');\n`};
const flag=station+'_STATION_FORWARD_ENABLED';
const normalize=bindings=>bindings.filter(b=>b.name!==flag).sort((a,b)=>a.name.localeCompare(b.name));
demand([hash(original),hash(files)].includes(hash(live))&&hash(normalize(settings.bindings))===hash(normalize(before.settings.bindings)),'RELEASE_CENTRAL_DRIFT');
const metadata={main_module:'station-entry.js',compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags,
 keep_bindings:['secret_text'],bindings:[...settings.bindings.filter(b=>b.type!=='secret_text'&&b.name!==flag),{name:flag,type:'plain_text',text:'true'}]};
for(const key of ['usage_model','logpush','placement','tags','tail_consumers','observability','limits'])if(settings[key]!==undefined)metadata[key]=settings[key];
await protect(worker+'-central-candidate',{metadata,files});
const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
for(const[name,content]of Object.entries(files))form.set(name,new Blob([content],{type:'application/javascript+module'}),name);
if(hash(live)!==hash(files))await client.request(path,{method:'PUT',body:form});
const after=await client.request(path+'/settings'),afterModules=await modules(await client.request(path,{raw:true}));
demand(hash(afterModules)===hash(files),'RELEASE_FORWARD_READBACK_FAILED');
demand(hash(normalize(after.bindings))===hash(normalize(settings.bindings)),'RELEASE_EXISTING_BINDINGS_CHANGED');
if(station==='FD'){
 const fd=await cloudflare('FD');
 await fd.request('/workers/scripts/'+target.worker+'/schedules',{method:'PUT',body:[{cron:'0 7-10 * * *'}]});
}
const result={station,centralWorker:worker,originalModulePreserved:true,otherBindingsPreserved:true,forwardedActions:station==='FD'?'all indicator actions':['SUBMIT','GET_PERFORMANCE'],otherRoutesUnchanged:true,newCron:station==='FD'?'0 7-10 * * *':null,centralFdCronNoop:station==='FD',at:new Date().toISOString(),billingChanges:0};
await report('2026-11-01-'+station.toLowerCase()+'-cutover',result);console.log(JSON.stringify(result));
