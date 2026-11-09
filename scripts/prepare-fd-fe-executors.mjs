import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {targets,demand,google,protect,unprotect,report} from './lib/fd-fe-release.js';
const station=process.argv[2],target=targets[station];demand(target,'RELEASE_STATION_INVALID');
const sa=target.service+'@'+target.project+'.iam.gserviceaccount.com';
const token=await firebaseCliAccountToken(target.email);
const billing=await google('https://cloudbilling.googleapis.com/v1/projects/'+target.project+'/billingInfo',token);
demand(billing.billingEnabled===false,'RELEASE_BILLING_MUST_BE_DISABLED');
const accountUrl='https://iam.googleapis.com/v1/projects/'+target.project+'/serviceAccounts/'+sa;
let account=await google(accountUrl,token,undefined,'GET',true);
if(!account){demand(station==='FE','RELEASE_FD_EXECUTOR_MISSING');account=await google('https://iam.googleapis.com/v1/projects/'+target.project+'/serviceAccounts',token,{accountId:target.service,serviceAccount:{displayName:'SAHMT FE Surveys',description:'FE responses and participation points; read-only existing FB membership.'}});}
demand(account.email===sa&&!account.disabled,'RELEASE_SERVICE_IDENTITY_INVALID');
const permissions=['datastore.databases.get','datastore.entities.create','datastore.entities.get','datastore.entities.list','datastore.entities.update'];
const specs=station==='FD'?[
 {project:'sahmt-gestao-5ae66',email:'anestesiahmtforms2@gmail.com',role:'sahmtIndicatorSourceReader',permissions:['datastore.entities.get','datastore.entities.list']},
 {project:'indicadores---sahmt',email:'anestesiahmtforms3@gmail.com',role:'sahmtIndicatorSourceReader',permissions:['datastore.entities.get','datastore.entities.list']},
 {...target,role:'sahmtIndicatorCompiler',permissions}
]:[{...target,role:'sahmtFeSurveyWorker',permissions},{project:'sahmt-gestao-5ae66',email:'anestesiahmtforms2@gmail.com',role:'sahmtFeMembershipReader',permissions:['datastore.entities.get']}];
const checked=[];
for(const spec of specs){
 const owner=spec.email===target.email?token:await firebaseCliAccountToken(spec.email);
 const roleName='projects/'+spec.project+'/roles/'+spec.role,roleUrl='https://iam.googleapis.com/v1/'+roleName;
 let role=await google(roleUrl,owner,undefined,'GET',true);
 if(!role){demand(station==='FE','RELEASE_FD_ROLE_MISSING');role=await google('https://iam.googleapis.com/v1/projects/'+spec.project+'/roles',owner,{roleId:spec.role,role:{title:spec.role,stage:'GA',includedPermissions:spec.permissions}});}
 demand(!role.deleted&&JSON.stringify([...role.includedPermissions].sort())===JSON.stringify([...spec.permissions].sort()),'RELEASE_ROLE_MISMATCH');
 const policyUrl='https://cloudresourcemanager.googleapis.com/v1/projects/'+spec.project;
 const policy=await google(policyUrl+':getIamPolicy',owner,{options:{requestedPolicyVersion:3}});
 await protect(station+'-'+spec.project+'-iam-before',policy);
 const member='serviceAccount:'+sa,bindings=policy.bindings||[];
 demand(!bindings.some(b=>b.members?.includes(member)&&b.role!==roleName),'RELEASE_UNEXPECTED_SERVICE_ROLE');
 const binding=bindings.find(b=>b.role===roleName&&!b.condition);
 if(!binding?.members?.includes(member)){
  demand(station==='FE','RELEASE_FD_BINDING_MISSING');
  if(binding)binding.members.push(member);else bindings.push({role:roleName,members:[member]});
  await google(policyUrl+':setIamPolicy',owner,{policy:{...policy,bindings}});
 }
 checked.push({project:spec.project,role:roleName,permissions:spec.permissions});
}
let credentials;try{credentials=await unprotect(station+'-service-key');}catch(e){if(e.code!=='ENOENT')throw e;}
if(!credentials){const key=await google(accountUrl+'/keys',token,{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});demand(key.privateKeyData,'RELEASE_KEY_MISSING');credentials=JSON.parse(Buffer.from(key.privateKeyData,'base64'));await protect(station+'-service-key',credentials);}
demand(credentials.project_id===target.project&&credentials.client_email===sa,'RELEASE_KEY_IDENTITY_MISMATCH');
const result={station,projectId:target.project,serviceEmail:sa,checked,billingEnabled:false,credentialsEncryptedLocally:true,businessWrites:0,at:new Date().toISOString()};
await report('2026-11-01-'+station.toLowerCase()+'-executor',result);console.log(JSON.stringify(result));
