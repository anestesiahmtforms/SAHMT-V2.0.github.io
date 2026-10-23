import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {createFaCloudflareClient} from './lib/fa-cloudflare-client.js';
import {createConsolidationScriptClient} from './lib/fa-consolidation-script-client.js';
import {createPrivateJsonProtector} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {cloudflareWorkerSource as workerSource} from './lib/cloudflare-worker-source.js';

const demand=(ok,code)=>{if(!ok)throw Error(code);};
const path='/workers/scripts/sahmt-auth-broker',owned='FC_MODULE_SCRIPT_URL';
const signature=bindings=>snapshotDigest(bindings.toSorted((a,b)=>a.name.localeCompare(b.name)));
let changed=false;
async function main(){
 const mode=process.argv[2]||'preview';demand(['preview','apply'].includes(mode),'FC_WORKER_MODE_INVALID');
 const targetId=process.env.SAHMT_FC_APPS_SCRIPT_DEPLOYMENT_ID;
 demand(typeof targetId==='string'&&/^[A-Za-z0-9_-]{20,200}$/.test(targetId),'FC_WORKER_TARGET_REQUIRED');
 const client=await createConsolidationScriptClient(),deployments=await client.readDeployments();
 const target=deployments.deployments?.find(d=>d.deploymentId===targetId);
 demand(target&&/FC.*QMENTUM|FC independent/i.test(target.deploymentConfig?.description||'')&&target.deploymentConfig.versionNumber>=46,'FC_WORKER_TARGET_NOT_READY');
 const url='https://script.google.com/macros/s/'+targetId+'/exec';
 const options={entryPoints:['worker-management-auth/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,external:['node:*']};
 const bundle=(await build(options)).outputFiles[0].text;
 // Prove that the live bundle is the reviewed reader version, differing only
 // in these two module relays. Any unrelated server drift stops publication.
 const prior=(await build({...options,plugins:[{name:'reviewed-before-fc',setup(b){
  b.onLoad({filter:/(qmentum-write-relay|occurrence-score-relay)\.js$/},args=>{
   const name=args.path.replaceAll('\\','/').split('/').at(-1);
   return {contents:execFileSync('git',['show','80e4b16:worker-management-auth/'+name],{encoding:'utf8',windowsHide:true}),loader:'js'};
  });
 }}]})).outputFiles[0].text;
 const cf=await createFaCloudflareClient();demand(cf.accountId==='1851e9f4cd5f026371beaa2c5a85f1b8','FC_WORKER_ACCOUNT_MISMATCH');
 const [settings,source]=await Promise.all([cf.request(path+'/settings'),cf.request(path,{raw:true})]);
 const liveModule=await workerSource(source);
 demand(liveModule===prior||liveModule===bundle,'FC_WORKER_UNRELATED_SOURCE_DRIFT');
 const expected=settings.bindings.filter(b=>b.name!==owned).concat({name:owned,type:'plain_text',text:url});
 const report={code:'FC_WORKER_PREVIEW',targetVersion:target.deploymentConfig.versionNumber,sourceAlreadyCurrent:liveModule===bundle,bindingAlreadyCurrent:signature(settings.bindings)===signature(expected),secretsPreserved:settings.bindings.filter(b=>b.type==='secret_text'||b.type==='secret_key').length,changes:0};
 if(mode==='preview'){console.log(JSON.stringify(report));return;}
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','qmentum-fc-migration');await mkdir(directory,{recursive:true});
 const protector=await createPrivateJsonProtector(),backup=resolve(directory,'Worker-'+Date.now()+'.dpapi.json');
 const saved={settings,source,target,createdAt:new Date().toISOString()};
 await writeFile(backup,JSON.stringify(protector.seal(saved)),{flag:'wx',mode:0o600});
 demand(snapshotDigest(protector.open(JSON.parse(await readFile(backup,'utf8'))))===snapshotDigest(saved),'FC_WORKER_BACKUP_INVALID');
 const [freshSettings,freshSource]=await Promise.all([cf.request(path+'/settings'),cf.request(path,{raw:true})]);
 demand(signature(freshSettings.bindings)===signature(settings.bindings)&&await workerSource(freshSource)===liveModule,'FC_WORKER_CONCURRENT_CHANGE');
 if(!report.sourceAlreadyCurrent||!report.bindingAlreadyCurrent){
  const metadata={main_module:'worker.js',bindings:expected.filter(b=>!['secret_text','secret_key'].includes(b.type)),keep_bindings:['secret_text','secret_key']};
  for(const key of ['compatibility_date','compatibility_flags','usage_model','logpush','observability','placement','tail_consumers','limits','tags'])if(settings[key]!==undefined)metadata[key]=settings[key];
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.js',new Blob([bundle],{type:'application/javascript+module'}),'worker.js');
  changed=true;await cf.request(path,{method:'PUT',body:form});
 }
 const [after,deployed]=await Promise.all([cf.request(path+'/settings'),cf.request(path,{raw:true})]);
 demand(signature(after.bindings)===signature(expected)&&await workerSource(deployed)===bundle,'FC_WORKER_POSTCHECK_FAILED');
 const probes=[];
 for(const [route,code] of [['/v1/qmentum/write','QMENTUM_WRITE_SESSION_INVALID'],['/v1/evaluation/occurrence','OCCURRENCE_SCORE_SESSION_INVALID']]){
  const r=await fetch('https://sahmt-auth-broker.anestesiahmtforms.workers.dev'+route,{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(20000)});
  const body=await r.json();demand(r.status===401&&body.code===code,'FC_WORKER_PROBE_FAILED');probes.push({route,status:r.status,code:body.code});
 }
 console.log(JSON.stringify({...report,code:'FC_MODULE_WORKER_DEPLOYED',changes:changed?1:0,probes,billingChanged:false,createdNamespaces:0,firestoreReads:0,backup}));
}
main().catch(e=>{console.error(JSON.stringify({code:/^FC_WORKER_[A-Z0-9_]+$/.test(e.message||'')?e.message:'FC_WORKER_OPERATION_FAILED',remoteChangesPossible:changed}));process.exitCode=1;});
