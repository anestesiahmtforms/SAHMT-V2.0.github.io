import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {sealPrivateJson,openPrivateJson} from './lib/windows-protected-json.js';
import {FI_PROJECTS} from '../worker-fi-control/store.js';
const directory='.local-preview/fi-control',project=FI_PROJECTS.FI,service=`fi-control-worker@${project}.iam.gserviceaccount.com`;
const owners={FA:'anestesiahmtforms@gmail.com',FB:'anestesiahmtforms2@gmail.com',FD:'anestesiahmtforms4@gmail.com',FF:'anestesiahmtforms6@gmail.com',FG:'sahmtcheck@gmail.com',FH:'etiquetassahmt@gmail.com',FI:'anestesiahmtforms9@gmail.com',FJ:'anestesiahmtforms10@gmail.com'};
const demand=(v,c)=>{if(!v)throw Error(c);};
async function api(url,token,body,method=body===undefined?'GET':'POST',missing=false){const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});if(missing&&r.status===404)return null;const result=await r.json().catch(()=>({}));demand(r.ok,'FI_SERVICE_HTTP_'+r.status);return result;}
try{
 await mkdir(directory,{recursive:true});const token=await firebaseCliAccountToken(owners.FI);
 const marker=await api(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/fiControlMigrations/initial`,token);demand(marker.fields?.sourceDeletes?.integerValue==='0','FI_SERVICE_IMPORT_REQUIRED');
 const billing=await api(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`,token);demand(billing.billingEnabled===false,'FI_SERVICE_BILLING_DISABLED_REQUIRED');
 const accountUrl=`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${service}`;let account=await api(accountUrl,token,undefined,'GET',true);
 if(!account)account=await api(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`,token,{accountId:'fi-control-worker',serviceAccount:{displayName:'SAHMT FI Administrative Control and AI',description:'FI control data, scoped administrative projections and authorized internal search.'}});
 demand(account.email===service&&!account.disabled,'FI_SERVICE_IDENTITY_MISMATCH');
 const checked=[];
 for(const alias of Object.keys(owners)){
  const owner=alias==='FI'?token:await firebaseCliAccountToken(owners[alias]),id=FI_PROJECTS[alias],writer=['FI','FA','FJ'].includes(alias);
  const permissions=['datastore.entities.get','datastore.entities.list',...(writer?['datastore.databases.get','datastore.entities.create','datastore.entities.update']:[])].sort();
  const roleId=alias==='FI'?'sahmtFiControlRuntime':writer?'sahmtFiControlProjection':'sahmtFiControlSourceReader',roleName=`projects/${id}/roles/${roleId}`;
  const roleUrl='https://iam.googleapis.com/v1/'+roleName;let role=await api(roleUrl,owner,undefined,'GET',true);
  if(!role)role=await api(`https://iam.googleapis.com/v1/projects/${id}/roles`,owner,{roleId,role:{title:roleId,stage:'GA',includedPermissions:permissions}});
  demand(!role.deleted&&JSON.stringify([...role.includedPermissions].sort())===JSON.stringify(permissions),'FI_SERVICE_ROLE_MISMATCH');
  const base=`https://cloudresourcemanager.googleapis.com/v1/projects/${id}`,policy=await api(base+':getIamPolicy',owner,{options:{requestedPolicyVersion:3}}),member='serviceAccount:'+service;
  const backup=`${directory}/iam-${alias}-before.dpapi.json`;try{await readFile(backup);}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(backup,JSON.stringify(await sealPrivateJson(policy)));}
  demand(!(policy.bindings||[]).some(b=>b.members?.includes(member)&&b.role!==roleName),'FI_SERVICE_UNEXPECTED_ROLE');
  const binding=policy.bindings?.find(b=>b.role===roleName&&!b.condition);
  if(!binding?.members?.includes(member)){
   const bindings=structuredClone(policy.bindings||[]),target=bindings.find(b=>b.role===roleName&&!b.condition);if(target)target.members.push(member);else bindings.push({role:roleName,members:[member]});
   await api(base+':setIamPolicy',owner,{policy:{...policy,bindings}});
  }
  const after=await api(base+':getIamPolicy',owner,{options:{requestedPolicyVersion:3}});demand(after.bindings?.some(b=>b.role===roleName&&!b.condition&&b.members?.includes(member)),'FI_SERVICE_IAM_READBACK_FAILED');checked.push({station:alias,projectId:id,role:roleName,readOnly:!writer});
 }
 const keyPath=directory+'/service-key.dpapi.json';let key;
 try{key=await openPrivateJson(JSON.parse(await readFile(keyPath,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!key){const created=await api(accountUrl+'/keys',token,{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});demand(created.privateKeyData,'FI_SERVICE_KEY_MISSING');key=JSON.parse(Buffer.from(created.privateKeyData,'base64'));await writeFile(keyPath,JSON.stringify(await sealPrivateJson(key)));}
 demand(key.project_id===project&&key.client_email===service&&key.private_key_id,'FI_SERVICE_KEY_MISMATCH');
 const verified=await openPrivateJson(JSON.parse(await readFile(keyPath,'utf8')));demand(verified.private_key_id===key.private_key_id,'FI_SERVICE_KEY_BACKUP_INVALID');
 const report={code:'FI_CONTROL_SERVICE_PREPARED',projectId:project,serviceEmail:service,billingEnabled:false,checked,credentialsEncryptedLocally:true,entityDeletesGranted:false,at:new Date().toISOString()};await writeFile('docs/superpowers/reports/2026-11-09-fi-service.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'FI_SERVICE_PREPARATION_FAILED'}));process.exitCode=1;}
