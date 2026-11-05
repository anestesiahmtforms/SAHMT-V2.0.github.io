// Authorized FF production preparation. Keys are protected with Windows DPAPI,
// outside the repository, and never emitted. No billing changes or Push sends.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
const projects=['sahmt-17a16','sahmt-comunicacao-ff'];
const service='communication-worker@sahmt-comunicacao-ff.iam.gserviceaccount.com';
const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','communication-production');
const keyPath=resolve(directory,'worker.dpapi.json');
const demand=(ok,code)=>{if(!ok)throw Error(code);};
async function api(token,url,method='GET',body,missing=false){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(missing&&r.status===404)return null;
 if(!r.ok){await r.body?.cancel();throw Error('FF_PREPARE_HTTP_'+r.status);}return r.json();
}
try{
 demand(process.argv.includes('--apply'),'FF_PREPARE_APPLY_REQUIRED');
 const tokens=[];for(const email of ['anestesiahmtforms@gmail.com','anestesiahmtforms6@gmail.com'])tokens.push(await firebaseCliAccountToken(email));
 const ff=tokens[1],base='https://iam.googleapis.com/v1/projects/sahmt-comunicacao-ff';
 const billing=await api(ff,'https://cloudbilling.googleapis.com/v1/projects/sahmt-comunicacao-ff/billingInfo');
 const database=await api(ff,'https://firestore.googleapis.com/v1/projects/sahmt-comunicacao-ff/databases/comunicacao');
 demand(billing.billingEnabled===false&&!billing.billingAccountName&&database.freeTier===true,'FF_FREE_REQUIRED');
 // Permit the service principal to check metadata; this does not link billing.
 await api(ff,'https://serviceusage.googleapis.com/v1/projects/772883283859/services/cloudbilling.googleapis.com:enable','POST',{});
 await mkdir(directory,{recursive:true});const protector=await createPrivateJsonProtector();
 const policies=[];for(let i=0;i<2;i++)policies.push(await api(tokens[i],`https://cloudresourcemanager.googleapis.com/v1/projects/${projects[i]}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}}));
 await writeFile(resolve(directory,`iam-before-${Date.now()}.dpapi.json`),JSON.stringify(protector.seal({projects,policies,at:new Date().toISOString()})),{flag:'wx'});
 let account=await api(ff,base+'/serviceAccounts/'+service,'GET',undefined,true);
 if(!account)account=await api(ff,base+'/serviceAccounts','POST',{accountId:'communication-worker',serviceAccount:{displayName:'FF manual institutional communication'}});
 demand(account.email===service&&!account.disabled,'FF_SERVICE_IDENTITY_INVALID');
 for(let i=0;i<2;i++){
  const permissions=(i===0?['datastore.entities.get']:['datastore.entities.get','datastore.entities.list','firebaseauth.users.get','datastore.entities.create','datastore.entities.update','datastore.databases.get','datastore.databases.getMetadata','cloudmessaging.messages.create','resourcemanager.projects.get']).sort();
  const roleId=i===0?'ffCommunicationFaReleaseReader':'ffCommunicationWorker',name=`projects/${projects[i]}/roles/${roleId}`;
  let role=await api(tokens[i],'https://iam.googleapis.com/v1/'+name,'GET',undefined,true);
  if(!role)role=await api(tokens[i],`https://iam.googleapis.com/v1/projects/${projects[i]}/roles`,'POST',{roleId,role:{title:'FF Communication '+(i===1?'Worker':'Explicit FA release'),description:'Minimal permissions for manual FF communication; no billing or source writes.',stage:'GA',includedPermissions:permissions}});
  demand(!role.deleted&&JSON.stringify([...role.includedPermissions].sort())===JSON.stringify(permissions),'FF_ROLE_CONFLICT');
  const policy=policies[i],member='serviceAccount:'+service;
  let binding=policy.bindings?.find(b=>b.role===name&&!b.condition);
  if(!binding?.members?.includes(member)){
   if(binding)binding.members.push(member);else(policy.bindings||=[]).push({role:name,members:[member]});
   await api(tokens[i],`https://cloudresourcemanager.googleapis.com/v1/projects/${projects[i]}:setIamPolicy`,'POST',{policy});
  }
  const verified=await api(tokens[i],`https://cloudresourcemanager.googleapis.com/v1/projects/${projects[i]}:getIamPolicy`,'POST',{});
  demand(verified.bindings?.some(b=>b.role===name&&!b.condition&&b.members?.includes(member)),'FF_IAM_READBACK_FAILED');
  console.log(JSON.stringify({project:projects[i],role:name,verified:true}));
 }
 let key;try{key=await openPrivateJson(JSON.parse(await readFile(keyPath,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!key){const result=await api(ff,base+'/serviceAccounts/'+service+'/keys','POST',{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});key=JSON.parse(Buffer.from(result.privateKeyData,'base64'));await writeFile(keyPath,JSON.stringify(protector.seal(key)),{flag:'wx'});}
 demand(key.client_email===service&&key.project_id===projects[1]&&key.private_key,'FF_KEY_IDENTITY_INVALID');
 demand((await openPrivateJson(JSON.parse(await readFile(keyPath,'utf8')))).private_key_id===key.private_key_id,'FF_PROTECTED_KEY_READBACK_FAILED');
 console.log(JSON.stringify({code:'FF_BACKEND_IDENTITY_PREPARED',protectedKey:keyPath,billingChanged:false,pushSent:false}));
}catch(e){console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'FF_PREPARE_FAILED');process.exitCode=1;}
