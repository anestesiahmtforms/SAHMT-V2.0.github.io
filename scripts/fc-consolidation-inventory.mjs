import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
import {captureFcConsolidationSnapshot} from './lib/fa-consolidation-capture.js';
import {prepareFcConsolidationPlan,FC_CONSOLIDATION_COLLECTIONS,FA_PROJECT,FC_PROJECT,faConsolidationReport} from './lib/fa-consolidation-plan.js';
import {snapshotDigest} from './lib/management-split-plan.js';
try{
 const dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');await mkdir(dir,{recursive:true});
 const protector=await createPrivateJsonProtector(),stamp=new Date().toISOString().replace(/[^0-9]/g,''),readTime=new Date(Date.now()-30000).toISOString();
 const captures={},configuration={};
 for(const [alias,projectId,email]of [['FC',FC_PROJECT,'anestesiahmtforms3@gmail.com'],['FA',FA_PROJECT,'anestesiahmtforms@gmail.com']]){
  const token=await firebaseCliAccountToken(email);
  captures[alias]=await captureFcConsolidationSnapshot({projectId,scope:FC_CONSOLIDATION_COLLECTIONS,readTime,accessToken:token,fetchImpl:fetch,includeRootInventory:true});
  if(alias==='FC'){
   const get=async url=>{const r=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('CONSOLIDATION_FC_CONFIGURATION_HTTP_'+r.status);return r.json();};
   configuration.billing=await get('https://cloudbilling.googleapis.com/v1/projects/'+projectId+'/billingInfo');
   configuration.release=await get('https://firebaserules.googleapis.com/v1/projects/'+projectId+'/releases/cloud.firestore');
   configuration.rules=await get('https://firebaserules.googleapis.com/v1/'+configuration.release.rulesetName);
   configuration.indexes=await get('https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/collectionGroups/-/indexes');
  }
 }
 const input={source:captures.FC.snapshot,destination:captures.FA.snapshot,scope:FC_CONSOLIDATION_COLLECTIONS},plan=prepareFcConsolidationPlan(input);
 const value={input,plan,captures,configuration},path=resolve(dir,'FC-'+stamp+'.dpapi.json');
 await writeFile(path,JSON.stringify(protector.seal(value)),{flag:'wx',mode:0o600});
 if(snapshotDigest(await openPrivateJson(JSON.parse(await readFile(path,'utf8'))))!==snapshotDigest(value))throw Error('CONSOLIDATION_FC_BACKUP_MISMATCH');
 const report={...faConsolidationReport(plan),code:'FC_CONSOLIDATION_INVENTORY',stamp,
  collections:Object.fromEntries(FC_CONSOLIDATION_COLLECTIONS.map(name=>[name,input.source.documents.filter(row=>row.path.split('/')[0]===name).length])),
  sourceRootCollections:captures.FC.rootInventory.collections,billingEnabled:configuration.billing.billingEnabled===true,
  indexes:configuration.indexes.indexes?.length||0,indexesComplete:!configuration.indexes.nextPageToken,backupVerified:true,remoteWrites:0};
 await writeFile(resolve(dir,'FC-'+stamp+'-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({code:/^(CONSOLIDATION|CLI_ACCOUNT)_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_FC_INVENTORY_FAILED',remoteWrites:0}));process.exitCode=1;}
