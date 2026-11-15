import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';

const owner='anestesiahmtforms6@gmail.com';
const account='7c4c3dcb7472c5daa58620efd358dfb1';
const script='sahmt-ff-comunicacao';
const spreadsheet=process.argv.find(arg=>arg.startsWith('--sheet='))?.slice(8);
if(!/^[A-Za-z0-9_-]{30,100}$/.test(spreadsheet||''))throw Error('FF_HISTORY_SPREADSHEET_REQUIRED');
const config=JSON.parse(await readFile('worker-communication/wrangler.jsonc','utf8'));
if(config.account_id!==account||config.name!==script)throw Error('FF_WORKER_TARGET_MISMATCH');
const cloudToken=await firebaseCliAccountToken(owner);
for(const service of ['drive.googleapis.com','sheets.googleapis.com']){
 const response=await fetch('https://serviceusage.googleapis.com/v1/projects/772883283859/services/'+service,{
  headers:{Authorization:'Bearer '+cloudToken},redirect:'error',signal:AbortSignal.timeout(15000)
 });
 if(!response.ok||(await response.json()).state!=='ENABLED')throw Error('FF_HISTORY_API_NOT_ENABLED');
}
const env={...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'};
for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL','CLOUDFLARE_ACCOUNT_ID'])delete env[key];
const wrangler=(...args)=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{
 env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000
});
const {token}=JSON.parse(wrangler('auth','token','--json','--profile','sahmt-ff-isolation'));
const path='/accounts/'+account+'/workers/scripts/'+script;
async function api(route,method='GET',body){
 const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
  method,body,headers:{Authorization:'Bearer '+token,...(typeof body==='string'?{'Content-Type':'application/json'}:{})},
  redirect:'error',signal:AbortSignal.timeout(30000)
 });
 const result=await response.json();
 if(!response.ok||result.success!==true)throw Error('FF_CLOUDFLARE_'+method+'_'+response.status);
 return result.result;
}
const [user,settings,schedule]=await Promise.all([api('/user'),api(path+'/settings'),api(path+'/schedules')]);
if(user.email!==owner||!settings.bindings.some(b=>b.name==='FF_SERVICE_ACCOUNT_JSON'&&b.type==='secret_text')||
   !settings.bindings.some(b=>b.name==='COMMUNICATION_PUSH_QUEUE'&&b.type==='queue')||
   !['COMMUNICATION_ENABLED','WORKERS_FREE_CONFIRMED'].every(name=>settings.bindings.some(b=>b.name===name&&b.text==='true')))throw Error('FF_WORKER_PRODUCTION_CONFIG_REQUIRED');
const cron=config.triggers.crons[0];
const existingCrons=(Array.isArray(schedule)?schedule:schedule.schedules||[]).map(s=>s.cron);
const nextCrons=[...new Set([...existingCrons,cron])].sort();
const dir=await mkdtemp(join(tmpdir(),'sahmt-ff-release-'));
try{
 const file=join(dir,'worker.bundle');
 wrangler('deploy','--dry-run','--config','worker-communication/wrangler.jsonc','--outfile',file);
 const bytes=await readFile(file);
 const boundary=bytes.subarray(0,bytes.indexOf('\r\n')).toString().slice(2);
 const form=await new Response(bytes,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData();
 const original=form.get('metadata');
 const bundled=JSON.parse(typeof original==='string'?original:await original.text());
 if(!form.has(bundled.main_module))throw Error('FF_BUNDLE_INVALID');
 const metadata={
  main_module:bundled.main_module,keep_bindings:['secret_text'],
  bindings:[...settings.bindings.filter(b=>b.type!=='secret_text'&&b.name!=='FF_HISTORY_SPREADSHEET_ID'),
   {type:'plain_text',name:'FF_HISTORY_SPREADSHEET_ID',text:spreadsheet}]
 };
 for(const k of ['compatibility_date','compatibility_flags','usage_model','logpush','placement','tags','tail_consumers','observability','limits'])if(settings[k]!==undefined)metadata[k]=settings[k];
 if(!process.argv.includes('--apply')){console.log('FF_HISTORY_DEPLOY_DRY_RUN_VERIFIED');}
 else{
  form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
  const result=await api(path,'PUT',form);
  if(!existingCrons.includes(cron))await api(path+'/schedules','PUT',JSON.stringify(nextCrons.map(cron=>({cron}))));
  const [after,afterSchedules]=await Promise.all([api(path+'/settings'),api(path+'/schedules')]);
  const found=(Array.isArray(afterSchedules)?afterSchedules:afterSchedules.schedules||[]).map(s=>s.cron).sort();
  if(!metadata.bindings.every(expected=>after.bindings.some(actual=>Object.entries(expected).every(([k,v])=>actual[k]===v)))||
     !after.bindings.some(b=>b.name==='FF_SERVICE_ACCOUNT_JSON'&&b.type==='secret_text')||
     JSON.stringify(found)!==JSON.stringify(nextCrons))throw Error('FF_HISTORY_RELEASE_READBACK_FAILED');
  console.log(JSON.stringify({deployed:true,deploymentId:result.deployment_id??result.id,cron}));
 }
}finally{await rm(dir,{recursive:true,force:true});}
