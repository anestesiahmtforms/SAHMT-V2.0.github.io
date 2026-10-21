import fs from 'node:fs/promises';import path from 'node:path';import{randomBytes,createHmac,createHash}from'node:crypto';
import{createFaCloudflareClient}from'./lib/fa-cloudflare-client.js';
import{createConsolidationScriptClient}from'./lib/fa-consolidation-script-client.js';
import{continuityBootstrapSource}from'./lib/continuity-bootstrap-source.js';
const endpoint='https://sahmt-operational-channel.anestesiahmtforms.workers.dev/v1/operational-continuity/import';
const directory=path.join(process.env.LOCALAPPDATA,'SAHMT','remote-continuity-v1');
await fs.mkdir(directory,{recursive:true});
const save=(name,value)=>fs.writeFile(path.join(directory,name),typeof value==='string'?value:JSON.stringify(value));
let secret;try{secret=(await fs.readFile(path.join(directory,'import-key.private'),'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;secret=randomBytes(32).toString('base64url');await fs.writeFile(path.join(directory,'import-key.private'),secret,{flag:'wx'});}
if(!/^[A-Za-z0-9_-]{43}$/.test(secret))throw Error('CONTINUITY_KEY_INVALID');
const command=process.argv[2];
async function signed(body){
 const text=JSON.stringify(body),time=String(Date.now()),nonce=randomBytes(16).toString('hex'),signature=createHmac('sha256',secret).update(time+'\n'+nonce+'\n'+createHash('sha256').update(text).digest('hex')).digest('hex');
 const response=await fetch(endpoint,{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json','X-Continuity-Time':time,'X-Continuity-Nonce':nonce,'X-Continuity-Signature':signature},body:text,redirect:'error',signal:AbortSignal.timeout(30000)});
 const value=await response.json();if(!response.ok)throw Error(/^CONTINUITY_[A-Z_]+$/.test(value.code)?value.code:'CONTINUITY_REMOTE_UNAVAILABLE');return value;
}
async function workerInstall(){
 const client=await createFaCloudflareClient(),settings=await client.request('/workers/scripts/sahmt-operational-channel/settings');
 if(!settings.bindings?.some(b=>b.name==='OPERATIONAL_CHANNEL_STATE'&&b.type==='durable_object_namespace')||!settings.bindings.some(b=>b.name==='OPERATIONAL_CHANNEL_AUTHORIZATION'&&b.type==='durable_object_namespace'))throw Error('CONTINUITY_EXISTING_BINDINGS_REQUIRED');
 try{await fs.access(path.join(directory,'worker-settings-before.private.json'));}catch{await save('worker-settings-before.private.json',settings);const source=await client.request('/workers/scripts/sahmt-operational-channel',{raw:true});await save('worker-source-before.private.json',source);}
 await client.request('/workers/scripts/sahmt-operational-channel/secrets',{method:'PUT',body:{name:'CONTINUITY_IMPORT_SECRET',type:'secret_text',text:secret}});
 const source=await fs.readFile('.local-preview/remote-continuity/package/worker.mjs','utf8');
 const upload=async enabled=>{
  const bindings=settings.bindings.filter(b=>b.type!=='secret_text'&&b.name!=='OPERATIONAL_CONTINUITY_ENABLED');bindings.push({name:'OPERATIONAL_CONTINUITY_ENABLED',type:'plain_text',text:String(enabled)});
  const form=new FormData();form.set('metadata',JSON.stringify({main_module:'worker.mjs',compatibility_date:settings.compatibility_date||'2026-10-06',bindings,keep_bindings:['secret_text'],usage_model:settings.usage_model||'standard',observability:{enabled:false}}));form.set('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
  await client.request('/workers/scripts/sahmt-operational-channel',{method:'PUT',body:form});
 };
 await upload(false);
 const proof=await signed({schemaVersion:1,profiles:[],resources:[]});if(proof.code!=='CONTINUITY_IMPORTED')throw Error('CONTINUITY_INSTALL_PROOF_FAILED');
 const fresh=await client.request('/workers/scripts/sahmt-operational-channel/settings');
 if(fresh.bindings.find(b=>b.name==='OPERATIONAL_CONTINUITY_ENABLED')?.text!=='false')throw Error('CONTINUITY_DISABLED_PROOF_FAILED');
 await upload(true);
 await save('worker-installed.json',{code:'CONTINUITY_WORKER_INSTALLED',verifiedDisabledFirst:true,bindingsPreserved:true,seedPending:true,installedAt:new Date().toISOString()});
 console.log(JSON.stringify({code:'CONTINUITY_WORKER_INSTALLED',verifiedDisabledFirst:true,bindingsPreserved:true,seedPending:true}));
}
async function scriptInstall(){
 const client=await createConsolidationScriptClient(),content=await client.readContent(),deployments=await client.readDeployments();
 try{await fs.access(path.join(directory,'script-before.private.json'));}catch{await save('script-before.private.json',content);await save('script-deployments-before.private.json',deployments);}
 const source=structuredClone(content),receiver=source.files.find(f=>f.name==='OperationalSheetPush'&&f.type==='SERVER_JS');
 if(!receiver?.source.includes('function doPost(event) {'))throw Error('CONTINUITY_RECEIVER_UNEXPECTED');
 if(!receiver.source.includes("action === 'operational-continuity-admin-v1'"))receiver.source=receiver.source.replace('function doPost(event) {',"function doPost(event) {\n  if (event && event.parameter && event.parameter.action === 'operational-continuity-admin-v1') return ocsAdminHttp_(event);");
 const adapter=source.files.find(f=>f.name==='Config'&&f.source?.includes('function firestoreRequest_('));
 if(!adapter)throw Error('CONTINUITY_SCRIPT_ADAPTER_MISSING');
 if(!adapter.source.includes('ocsMirrorCommitted_(url, options, decoded)')){
  const start=adapter.source.indexOf('function firestoreRequest_('),end=adapter.source.indexOf('\nfunction ',start+10),section=adapter.source.slice(start,end);
  if(!section.includes('  return decoded;'))throw Error('CONTINUITY_SCRIPT_ADAPTER_UNEXPECTED');
  adapter.source=adapter.source.slice(0,start)+section.replace('  return decoded;','  if (typeof ocsMirrorCommitted_ === "function") ocsMirrorCommitted_(url, options, decoded);\n  return decoded;')+adapter.source.slice(end);
 }
 const add=(name,text)=>{const existing=source.files.find(f=>f.name===name);if(existing)existing.source=text;else source.files.push({name,type:'SERVER_JS',source:text});};
 for(const name of ['OperationalContinuitySync','OperationalContinuityCore'])add(name,await fs.readFile('apps-script-v2/'+name+'.gs','utf8'));
 // Known current quota failure: defer initial snapshot beyond the next reset.
 const notBefore=Date.parse(process.env.CONTINUITY_SEED_NOT_BEFORE||'2026-10-21T07:15:00Z');
 add('OperationalContinuityPrivateInstall',continuityBootstrapSource({secret,endpoint,notBefore:Number.isFinite(notBefore)?Math.max(Date.now(),notBefore):Date.now()}));
 await client.updateContent(source);const installed=await client.readContent();
 for(const file of source.files)if(installed.files.find(f=>f.name===file.name)?.source!==file.source)throw Error('CONTINUITY_EXISTING_SCRIPT_CHANGED');
 const version=await client.createVersion('Remote operational continuity: authenticated bootstrap and bounded reconciliation');
 const candidates=(deployments.deployments||[]).filter(d=>d.deploymentConfig?.versionNumber&&d.entryPoints?.some(e=>e.entryPointType==='WEB_APP')).sort((a,b)=>b.deploymentConfig.versionNumber-a.deploymentConfig.versionNumber);
 if(!candidates.length||candidates[1]?.deploymentConfig.versionNumber===candidates[0].deploymentConfig.versionNumber)throw Error('CONTINUITY_DEPLOYMENT_AMBIGUOUS');
 const target=candidates[0];await client.updateDeployment(target,version.versionNumber,'Remote operational continuity; existing integrations preserved');
 const url=target.entryPoints.find(e=>e.entryPointType==='WEB_APP').webApp.url;
 await save('script-installed.private.json',{deploymentId:target.deploymentId,version:version.versionNumber,url,files:installed.files.length});
 console.log(JSON.stringify({code:'CONTINUITY_SCRIPT_INSTALLED',filesPreserved:content.files.length,version:version.versionNumber}));
}
async function scriptCall(action){
 const installed=JSON.parse(await fs.readFile(path.join(directory,'script-installed.private.json'),'utf8'));
 const payload=JSON.stringify({action}),time=String(Date.now()),nonce=randomBytes(16).toString('hex'),signature=createHmac('sha256',secret).update(time+'\n'+nonce+'\n'+createHash('sha256').update(payload).digest('hex')).digest('hex');
 const url=new URL(installed.url);if(url.hostname!=='script.google.com'||!url.pathname.endsWith('/exec'))throw Error('CONTINUITY_SCRIPT_ENDPOINT_INVALID');url.searchParams.set('action','operational-continuity-admin-v1');
 let response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,time,nonce,signature}),redirect:'manual',signal:AbortSignal.timeout(30000)});
 if(response.status===302){const location=response.headers.get('Location'),next=new URL(location);if(next.protocol!=='https:'||next.hostname!=='script.googleusercontent.com'||next.pathname!=='/macros/echo')throw Error('CONTINUITY_SCRIPT_REDIRECT_INVALID');await response.body?.cancel();response=await fetch(next,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(30000)});}
 if(response.status!==200)throw Error('CONTINUITY_SCRIPT_HTTP_'+response.status);
 let value;try{value=await response.json();}catch{throw Error('CONTINUITY_SCRIPT_RESPONSE_INVALID');}
 if(!/^CONTINUITY_/.test(value.code||''))throw Error('CONTINUITY_SCRIPT_RESPONSE_INVALID');
 await save('script-status.json',{...value,observedAt:new Date().toISOString()});console.log(JSON.stringify(value));
}
try{
 if(command==='worker')await workerInstall();else if(command==='script')await scriptInstall();else if(command==='activate')await scriptCall('install');else if(command==='status')await scriptCall('status');else throw Error('CONTINUITY_INSTALL_COMMAND_REQUIRED');
}catch(error){console.error(JSON.stringify({code:/^(?:CONTINUITY|CONSOLIDATION)_[A-Z_0-9]+$/.test(error.message)?error.message:'CONTINUITY_INSTALL_FAILED',retries:0}));process.exitCode=1;}
