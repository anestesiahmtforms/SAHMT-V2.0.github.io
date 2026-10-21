import fs from 'node:fs/promises';
import path from 'node:path';
import {createFaCloudflareClient} from './lib/fa-cloudflare-client.js';
const directory=path.join(process.env.LOCALAPPDATA,'SAHMT','remote-continuity-v1');
const endpoint='https://sahmt-operational-channel.anestesiahmtforms.workers.dev/v1/operational-channel/events';
const flag='OPERATIONAL_CHANNEL_REALTIME_ENABLED';
const save=(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value));
const signature=bindings=>JSON.stringify(bindings.filter(b=>b.name!==flag).sort((a,b)=>a.name.localeCompare(b.name)));
async function probe(expected){
 const r=await fetch(endpoint,{headers:{Origin:'https://anestesiahmtforms.github.io'},redirect:'error',signal:AbortSignal.timeout(15000)});
 const value=await r.json();if(value.code!==expected)throw Error('REALTIME_PROBE_FAILED');
 return {httpStatus:r.status,code:value.code};
}
try{
 await fs.mkdir(directory,{recursive:true});
 const client=await createFaCloudflareClient(),settings=await client.request('/workers/scripts/sahmt-operational-channel/settings');
 const bindings=settings.bindings||[];
 if(!['OPERATIONAL_CHANNEL_STATE','OPERATIONAL_CHANNEL_AUTHORIZATION'].every(name=>bindings.some(b=>b.name===name&&b.type==='durable_object_namespace'))||
 !bindings.some(b=>b.name==='CONTINUITY_IMPORT_SECRET'&&b.type==='secret_text')||
 !['OPERATIONAL_CHANNEL_ENABLED','OPERATIONAL_CONTINUITY_ENABLED'].every(name=>bindings.some(b=>b.name===name&&b.text==='true')))throw Error('REALTIME_EXISTING_CONFIGURATION_REQUIRED');
 const command=process.argv[2]||'install';
 const source=await fs.readFile('.local-preview/remote-continuity/package/worker.mjs','utf8');
 if(!source.includes('CHANNEL_REALTIME_TICKET'))throw Error('REALTIME_BUNDLE_REQUIRED');
 async function upload(enabled){
  const form=new FormData();form.set('metadata',JSON.stringify({main_module:'worker.mjs',compatibility_date:settings.compatibility_date||'2026-10-06',
   bindings:[...bindings.filter(b=>b.type!=='secret_text'&&b.name!==flag),{name:flag,type:'plain_text',text:String(enabled)}],keep_bindings:['secret_text'],usage_model:settings.usage_model||'standard',observability:{enabled:false}}));
  form.set('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
  await client.request('/workers/scripts/sahmt-operational-channel',{method:'PUT',body:form});
  // Deployment metadata can precede edge propagation. One bounded pause, no request retries.
  await new Promise(resolve=>setTimeout(resolve,12000));
 }
 if(command==='disable'){
  await upload(false);
  console.log(JSON.stringify({code:'REALTIME_DISABLED',...await probe('CHANNEL_REALTIME_DISABLED'),firestoreReads:0}));
 }else if(command==='install'){
  try{await fs.access(path.join(directory,'realtime-settings-before.private.json'));}catch{
   await save('realtime-settings-before.private.json',settings);
   await save('realtime-source-before.private.json',await client.request('/workers/scripts/sahmt-operational-channel',{raw:true}));
  }
  await upload(false);const disabled=await probe('CHANNEL_REALTIME_DISABLED');
  let fresh=await client.request('/workers/scripts/sahmt-operational-channel/settings');
  if(signature(fresh.bindings)!==signature(bindings))throw Error('REALTIME_BINDINGS_CHANGED');
  await upload(true);const enabled=await probe('CHANNEL_REALTIME_UPGRADE_INVALID');
  fresh=await client.request('/workers/scripts/sahmt-operational-channel/settings');
  if(fresh.bindings.find(b=>b.name===flag)?.text!=='true'||signature(fresh.bindings)!==signature(bindings))throw Error('REALTIME_BINDINGS_CHANGED');
  const result={code:'REALTIME_WORKER_INSTALLED',disabled,enabled,bindingsPreserved:true,plansUnchanged:true,firestoreReads:0,installedAt:new Date().toISOString()};
  await save('realtime-installed.json',result);console.log(JSON.stringify(result));
 }else throw Error('REALTIME_COMMAND_INVALID');
}catch(error){console.error(JSON.stringify({code:/^(?:REALTIME|CONSOLIDATION)_[A-Z_0-9]+$/.test(error.message)?error.message:'REALTIME_INSTALL_FAILED',retries:0}));process.exitCode=1;}
