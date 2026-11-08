import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {sealPrivateJson} from './lib/windows-protected-json.js';

const project='sahmt-checklist-fg';
const member='serviceAccount:indicator-compiler@rotinas-8a617.iam.gserviceaccount.com';
const roleName='projects/'+project+'/roles/sahmtIndicatorSourceReader';
const permissions=['datastore.entities.get','datastore.entities.list'];
const token=await firebaseCliAccountToken('sahmtcheck@gmail.com');
async function request(url,body){
 const response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
 if(response.status===404&&!body)return null;
 if(!response.ok){await response.body?.cancel();throw Error('FG_READER_HTTP_'+response.status);}
 return response.json();
}
const iam='https://cloudresourcemanager.googleapis.com/v1/projects/'+project;
const roleUrl='https://iam.googleapis.com/v1/'+roleName;
const policy=await request(iam+':getIamPolicy',{options:{requestedPolicyVersion:3}});
let role=await request(roleUrl);
if(role&&(role.deleted||JSON.stringify([...role.includedPermissions].sort())!==JSON.stringify(permissions)))throw Error('FG_READER_ROLE_CONFLICT');
if(policy.bindings?.some(binding=>binding.members?.includes(member)&&binding.role!==roleName))throw Error('FG_READER_EXISTING_ROLE_REVIEW_REQUIRED');
if(!process.argv.includes('--apply')){
 console.log(JSON.stringify({code:'FG_READER_READY',permissions,project,apply:false}));
 process.exit(0);
}
await mkdir('.local-preview/fd-fixed-sync',{recursive:true});
await writeFile('.local-preview/fd-fixed-sync/fg-iam-before-'+Date.now()+'.dpapi.json',JSON.stringify(await sealPrivateJson({policy,role})));
if(!role)role=await request('https://iam.googleapis.com/v1/projects/'+project+'/roles',{roleId:'sahmtIndicatorSourceReader',role:{title:'SAHMT Indicator Source Reader',stage:'GA',includedPermissions:permissions}});
const binding=policy.bindings?.find(binding=>binding.role===roleName&&!binding.condition);
if(!binding?.members?.includes(member)){
 const bindings=structuredClone(policy.bindings||[]);
 const target=bindings.find(row=>row.role===roleName&&!row.condition);
 if(target)target.members.push(member);
 else bindings.push({role:roleName,members:[member]});
 await request(iam+':setIamPolicy',{policy:{...policy,bindings}});
}
const after=await request(iam+':getIamPolicy',{options:{requestedPolicyVersion:3}});
if(!after.bindings?.some(binding=>binding.role===roleName&&!binding.condition&&binding.members?.includes(member)))throw Error('FG_READER_READBACK_FAILED');
console.log(JSON.stringify({code:'FG_READER_CONFIGURED',project,permissions,businessWrites:0}));
