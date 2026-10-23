import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {openPrivateJson} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';

const PROJECT='indicadores---sahmt',FA='sahmt-17a16',DOCUMENT='occurrenceRuntime/independentV1';
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
async function api(token,url,method='GET',body){
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(response.status===404)return null;if(!response.ok)throw Error('FC_RELEASE_HTTP_'+response.status);return response.json();
}
async function main(){
 demand(process.env.LOCALAPPDATA,'FC_RELEASE_BACKUP_PATH_REQUIRED');
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','qmentum-fc-migration');
 const names=(await readdir(directory)).filter(name=>/^FC-\d{17}\.dpapi\.json$/.test(name)).sort();
 demand(names.length>0,'FC_RELEASE_MIGRATION_BACKUP_MISSING');
 const backup=await openPrivateJson(JSON.parse(await readFile(resolve(directory,names.at(-1)),'utf8')));
 const plan=backup.plan,counts=plan?.counts;
 const planSha256=plan?snapshotDigest(plan):'';
 demand(plan?.ready===true&&plan.sourceProjectId===FA&&plan.destinationProjectId===PROJECT&&counts?.qmentumSource===65&&counts?.occurrenceSource===4&&counts?.occurrenceEquivalent===4&&counts?.conflicts===0&&/^[a-f0-9]{64}$/.test(planSha256),'FC_RELEASE_VERIFICATION_EVIDENCE_INVALID');
 const token=await firebaseCliAccountToken('anestesiahmtforms3@gmail.com');
 const url='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/'+DOCUMENT;
 const expected={schemaVersion:{integerValue:'1'},release:{stringValue:'occurrence-fc-independent-v1'},status:{stringValue:'ACTIVE'},
  sourceProjectId:{stringValue:FA},destinationProjectId:{stringValue:PROJECT},planSha256:{stringValue:planSha256},
  verifiedDocuments:{integerValue:'4'},plannedDocuments:{integerValue:'4'},migrationCode:{stringValue:'FC_INDEPENDENT_VERIFIED'}};
 const current=await api(token,url);
 if(current){
  demand(canonical(current.fields)===canonical(expected),'FC_RELEASE_MARKER_CONFLICT');
  console.log(JSON.stringify({code:'FC_OCCURRENCE_RELEASE_ALREADY_ACTIVE',project:PROJECT,verifiedDocuments:4,writes:0,billingEnabled:false}));return;
 }
 const commit=await api(token,'https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents:commit','POST',{
  writes:[{update:{name:'projects/'+PROJECT+'/databases/(default)/documents/'+DOCUMENT,fields:expected},currentDocument:{exists:false}}]});
 demand(Array.isArray(commit.writeResults)&&commit.writeResults.length===1,'FC_RELEASE_MARKER_COMMIT_INVALID');
 const check=await api(token,url);demand(check?.fields&&canonical(check.fields)===canonical(expected),'FC_RELEASE_MARKER_POSTCHECK_FAILED');
 console.log(JSON.stringify({code:'FC_OCCURRENCE_RELEASE_ACTIVE',project:PROJECT,verifiedDocuments:4,plannedDocuments:4,writes:1,billingEnabled:false}));
}
main().catch(error=>{const code=/^FC_RELEASE_[A-Z0-9_]+$/.test(error.message||'')?error.message:'FC_OCCURRENCE_RELEASE_FAILED';console.error(JSON.stringify({code,writes:0}));process.exitCode=1;});
