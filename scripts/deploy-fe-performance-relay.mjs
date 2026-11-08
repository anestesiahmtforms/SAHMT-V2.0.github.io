import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {cloudflare} from './lib/fd-fe-release.js';
import {sealPrivateJson} from './lib/windows-protected-json.js';
import {feRelaySecret,feRelayMetadata,smokeFeRelay,FE_PERFORMANCE_READ_URL} from './lib/fe-performance-relay-release.js';
// Default is read-only remote preflight. Pairing is created only with --apply.
const {request,target}=await cloudflare('FE',{profile:'sahmt-fe-isolation'}),path='/workers/scripts/'+target.worker;
const [before,settings,subdomain]=await Promise.all([request(path,{raw:true}),request(path+'/settings'),request('/workers/subdomain')]);
if(subdomain.subdomain!==target.subdomain)throw Error('FE_RELAY_SUBDOMAIN_MISMATCH');
const source=(await build({entryPoints:['worker-fe-surveys/worker.js'],bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*'],write:false})).outputFiles[0].text;
feRelayMetadata(settings,'preflight-only-not-a-real-secret');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function sourceHash(raw){const form=await new Response(raw.content,{headers:{'Content-Type':raw.contentType}}).formData(),parts=[];for(const [name,value]of form)parts.push([name,typeof value==='string'?value:await value.text()]);return hash(JSON.stringify(parts.sort((a,b)=>a[0].localeCompare(b[0]))));}
const preflight={code:'FE_RELAY_READY',account:target.account,worker:target.worker,endpoint:FE_PERFORMANCE_READ_URL,sourceSha256:hash(source),bindingsPreserved:true,iamChanges:0,businessWrites:0,paidChanges:0};
if(!process.argv.includes('--apply')){console.log(JSON.stringify(preflight));process.exit(0);}
const dir='.local-preview/fd-fixed-sync';await mkdir(dir,{recursive:true});
await writeFile(dir+'/fe-relay-before-'+Date.now()+'.dpapi.json',JSON.stringify(await sealPrivateJson({before,settings})));
const secret=await feRelaySecret({create:true});
const [fresh,freshSettings]=await Promise.all([request(path,{raw:true}),request(path+'/settings')]);
if(await sourceHash(fresh)!==await sourceHash(before)||JSON.stringify(freshSettings)!==JSON.stringify(settings))throw Error('FE_RELAY_REMOTE_DRIFT');
const form=new FormData();form.set('metadata',new Blob([JSON.stringify(feRelayMetadata(settings,secret))],{type:'application/json'}));form.set('index.js',new Blob([source],{type:'application/javascript+module'}),'index.js');
await request(path,{method:'PUT',body:form});
const [after,afterSettings]=await Promise.all([request(path,{raw:true}),request(path+'/settings')]);
const deployedForm=await new Response(after.content,{headers:{'Content-Type':after.contentType}}).formData(),part=deployedForm.get('index.js');
if(!part||hash(typeof part==='string'?part:await part.text())!==hash(source))throw Error('FE_RELAY_SOURCE_READBACK_FAILED');
for(const binding of settings.bindings)if(!afterSettings.bindings.some(b=>b.name===binding.name&&b.type===binding.type))throw Error('FE_RELAY_EXISTING_BINDING_LOST');
if(!afterSettings.bindings.some(b=>b.name==='FE_PERFORMANCE_READ_SECRET'&&b.type==='secret_text'))throw Error('FE_RELAY_PAIRING_READBACK_FAILED');
const smoke=await smokeFeRelay({secret});
const result={...preflight,code:'FE_RELAY_ACTIVE',smoke,at:new Date().toISOString()};await writeFile(dir+'/fe-relay-deployed.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
