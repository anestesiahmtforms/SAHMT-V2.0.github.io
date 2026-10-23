import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPrivateJsonProtector} from './lib/windows-protected-json.js';

const PROJECT='indicadores---sahmt',MEMBER='user:anestesiahmtforms@gmail.com';
const ROLE_ID='sahmtQmentumBackend',ROLE_NAME='projects/'+PROJECT+'/roles/'+ROLE_ID;
const PERMISSIONS=['datastore.databases.get','datastore.entities.create','datastore.entities.get','datastore.entities.list','datastore.entities.update'];
const CONDITION={title:'SAHMT_Qmentum_Default_Database',description:'QMENTUM backend data access, constrained to the FC default Firestore database.',expression:'resource.name == "projects/'+PROJECT+'/databases/(default)"'};
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const require=createRequire(import.meta.url),auth=require('../node_modules/firebase-tools/lib/auth.js');
async function tokenFor(email){const account=auth.getAllAccounts().find(item=>item.user?.email===email&&item.tokens?.refresh_token);demand(account,'QMENTUM_IAM_OWNER_SESSION_REQUIRED');const value=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);demand(typeof value.access_token==='string','QMENTUM_IAM_OAUTH_UNAVAILABLE');return value.access_token;}
async function call(token,method,url,body,{missing=false}={}){let response;try{response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('QMENTUM_IAM_NETWORK');}if(missing&&response.status===404)return null;if(!response.ok)throw Error('QMENTUM_IAM_HTTP_'+response.status);return response.json();}
function samePermissions(role){return role?.name===ROLE_NAME&&role.deleted!==true&&role.stage!=='DISABLED'&&Array.isArray(role.includedPermissions)&&JSON.stringify([...role.includedPermissions].sort())===JSON.stringify([...PERMISSIONS].sort());}
async function main(){const mode=process.argv[2]||'inspect';demand(['inspect','apply'].includes(mode),'QMENTUM_IAM_MODE_INVALID');demand(process.env.LOCALAPPDATA,'QMENTUM_IAM_PRIVATE_PATH_REQUIRED');
 const token=await tokenFor('anestesiahmtforms3@gmail.com'),billing=await call(token,'GET','https://cloudbilling.googleapis.com/v1/projects/'+PROJECT+'/billingInfo');demand(billing.billingEnabled===false,'QMENTUM_IAM_BILLING_ENABLED');
 const policyUrl='https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT+':getIamPolicy',setUrl='https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT+':setIamPolicy';
 const original=await call(token,'POST',policyUrl,{options:{requestedPolicyVersion:3}}),role=await call(token,'GET','https://iam.googleapis.com/v1/'+ROLE_NAME,undefined,{missing:true});
 if(role&&!samePermissions(role))throw Error('QMENTUM_IAM_ROLE_CONFLICT');
 const matching=(original.bindings||[]).filter(binding=>binding.role===ROLE_NAME&&canonical(binding.condition||null)===canonical(CONDITION));demand(matching.length<=1,'QMENTUM_IAM_BINDING_AMBIGUOUS');
 const already=matching.some(binding=>binding.members?.includes(MEMBER));
 if(mode==='inspect'){console.log(JSON.stringify({code:'QMENTUM_FC_IAM_PLAN',project:PROJECT,member:MEMBER,permissions:PERMISSIONS,condition:CONDITION,roleExists:!!role,alreadyGranted:already,billingEnabled:false,write:false}));return;}
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','qmentum-fc-migration');await mkdir(directory,{recursive:true});
 const state={schemaVersion:1,project:PROJECT,member:MEMBER,roleId:ROLE_ID,roleExisted:!!role,originalPolicy:original,previousRole:role,createdAt:new Date().toISOString()};
 const protector=await createPrivateJsonProtector(),backup=resolve(directory,'IAM-'+Date.now()+'-'+randomUUID()+'.dpapi.json');
 await writeFile(backup,JSON.stringify(protector.seal(state)),{flag:'wx',mode:0o600});
 const verified=await protector.open(JSON.parse(await readFile(backup,'utf8')));demand(verified.project===PROJECT&&verified.member===MEMBER,'QMENTUM_IAM_BACKUP_VERIFY_FAILED');
 let created=false;
 if(!role){const result=await call(token,'POST','https://iam.googleapis.com/v1/projects/'+PROJECT+'/roles',{roleId:ROLE_ID,role:{title:'SAHMT QMENTUM Backend',description:'No-delete backend access for the QMENTUM processor, restricted to the default Firestore database.',stage:'GA',includedPermissions:PERMISSIONS}});demand(samePermissions(result),'QMENTUM_IAM_ROLE_VERIFY_FAILED');created=true;}
 const latest=await call(token,'POST',policyUrl,{options:{requestedPolicyVersion:3}}),next=structuredClone(latest);next.version=3;next.bindings??=[];
 const exact=next.bindings.find(binding=>binding.role===ROLE_NAME&&canonical(binding.condition||null)===canonical(CONDITION));
 if(exact){if(!exact.members.includes(MEMBER))exact.members.push(MEMBER);}else next.bindings.push({role:ROLE_NAME,members:[MEMBER],condition:CONDITION});
 await call(token,'POST',setUrl,{policy:next,updateMask:'bindings,etag,version'});
 const check=await call(token,'POST',policyUrl,{options:{requestedPolicyVersion:3}}),ok=check.bindings?.some(binding=>binding.role===ROLE_NAME&&canonical(binding.condition||null)===canonical(CONDITION)&&binding.members?.includes(MEMBER));
 demand(ok,'QMENTUM_IAM_BINDING_VERIFY_FAILED');
 console.log(JSON.stringify({code:'QMENTUM_FC_BACKEND_IAM_READY',project:PROJECT,permissions:PERMISSIONS,condition:CONDITION,roleCreated:created,memberGranted:true,billingEnabled:false,privateRollbackBackup:backup}));
}
main().catch(error=>{console.error(JSON.stringify({code:/^QMENTUM_IAM_[A-Z0-9_]+$/.test(error.message||'')?error.message:'QMENTUM_FC_BACKEND_IAM_FAILED',changed:false}));process.exitCode=1;});
