// Read-only FA audit. Does not enumerate operational records or change services.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createConsolidationScriptClient} from './lib/fa-consolidation-script-client.js';
import {createFaCloudflareClient} from './lib/fa-cloudflare-client.js';
import {createHash} from 'node:crypto';
if(process.argv.slice(2).join(' ')!=='--read-once')throw Error('FA_AUDIT_READ_ONCE_REQUIRED');
const project='sahmt-17a16',directory=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-cleanup-20261016');
await mkdir(directory,{recursive:true});
const report={code:'FA_RUNTIME_READ_ONLY_AUDIT',project,remoteWrites:0,checks:{}};
const privateData={};
const safe=e=>/^[A-Z_]+(?:_\d+)?$/.test(e.message||'')?e.message:'READ_UNAVAILABLE';
try {
 const token=await firebaseCliAccountToken('anestesiahmtforms@gmail.com');
 const root='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents';
 const paths=['managementRuntime/faConsolidation','managementRuntime/domainCutover','occurrenceRuntime/faConsolidation','evaluationRuntime/state','checklistScienceRuntime/state','appConfig/app'];
 for(const path of paths){
  const r=await fetch(root+'/'+path,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
  report.checks[path]={httpStatus:r.status};if(!r.ok)continue;
  const d=await r.json();privateData[path]=d;const f=d.fields||{};
  report.checks[path]={httpStatus:r.status,...Object.fromEntries(['status','release','sourceProjectId','destinationProjectId','migrationCode'].filter(k=>f[k]?.stringValue).map(k=>[k,f[k].stringValue])),
   ...(f.enabled?{enabled:f.enabled.booleanValue===true}:{}),
   ...(f.performanceDirty?{performanceDirty:f.performanceDirty.booleanValue===true}:{}),
   ...(f.features?.mapValue?{features:Object.fromEntries(Object.entries(f.features.mapValue.fields||{}).map(([k,v])=>[k,v.booleanValue]))}:{})};
 }
 const collections=[];let pageToken='';
 for(let page=0;page<3;page++){
  const r=await fetch(root+':listCollectionIds',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({pageSize:200,...(pageToken?{pageToken}:{})}),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('COLLECTION_METADATA_HTTP_'+r.status);const d=await r.json();collections.push(...(d.collectionIds||[]));pageToken=d.nextPageToken||'';if(!pageToken)break;
 }
 report.collections={count:collections.length,complete:!pageToken,names:collections.sort()};
}catch(e){report.firestoreError=safe(e);}
try {
 const client=await createConsolidationScriptClient(),content=await client.readContent(),deployments=await client.readDeployments();privateData.script={content,deployments};
 const comparisons=[];for(const f of content.files.filter(f=>f.type==='SERVER_JS')){
  let local;try{local=await readFile(new URL('../apps-script-v2/'+f.name+'.gs',import.meta.url),'utf8')}catch{}
  comparisons.push({file:f.name+'.gs',localPresent:typeof local==='string',matchesLocal:typeof local==='string'&&local.replaceAll('\r\n','\n')===f.source.replaceAll('\r\n','\n')});
 }
 report.appsScript={files:content.files.length,comparisons,manifest:JSON.parse(content.files.find(f=>f.name==='appsscript').source),deployments:(deployments.deployments||[]).map(d=>({version:d.deploymentConfig?.versionNumber,types:(d.entryPoints||[]).map(e=>e.entryPointType)}))};
}catch(e){report.appsScriptError=safe(e);}
try {
 const cf=await createFaCloudflareClient(),settings=await cf.request('/workers/scripts/sahmt-auth-broker/settings');
 privateData.workerSettings=settings;
 const keys=new Set(['MANAGEMENT_SECONDARY_AUTH_RETIRED','MANAGEMENT_AUTH_ENABLED','MANAGEMENT_AUTH_FB_ENABLED','MANAGEMENT_AUTH_FC_ENABLED','MANAGEMENT_DOMAIN_ENABLED','MANAGEMENT_GATEWAY_ENABLED','MANAGEMENT_FIRST_LOGIN_ENABLED','OCCURRENCE_SCORING_ENABLED','OPERATIONAL_SHEETS_ENABLED','QMENTUM_WRITE_ENABLED']);
 report.worker={flags:Object.fromEntries(settings.bindings.filter(b=>b.type==='plain_text'&&keys.has(b.name)).map(b=>[b.name,b.text])),secretBindings:settings.bindings.filter(b=>b.type==='secret_text').length,remoteWrites:0};
}catch(e){report.workerError=safe(e);}
const stamp=Date.now();
await writeFile(resolve(directory,'private-source-and-controls-'+stamp+'.json'),JSON.stringify(privateData),{flag:'wx',mode:0o600});
report.evidenceSha256=createHash('sha256').update(JSON.stringify(privateData)).digest('hex');
await writeFile(resolve(directory,'audit-'+stamp+'.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify(report));
