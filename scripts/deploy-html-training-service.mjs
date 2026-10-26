import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createServiceTokenProvider} from '../worker-training/google-auth.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {IMPORT_PROJECT,IMPORT_ACCOUNT,verifyImportRules} from './lib/html-training-initial-import.js';

const accountId='1851e9f4cd5f026371beaa2c5a85f1b8';
const serviceEmail=`html-training-worker@${IMPORT_PROJECT}.iam.gserviceaccount.com`;
const roleName=`projects/${IMPORT_PROJECT}/roles/htmlTrainingWorker`;
const permissions=['datastore.databases.get','datastore.entities.create','datastore.entities.get','datastore.entities.list','datastore.entities.update'];
const reportPath='.local-preview/html-training-deployment.json';
const args=process.argv.slice(2),apply=args.includes('--apply'),resume=args.includes('--resume');
if(args.some(arg=>!['--apply','--resume'].includes(arg))||new Set(args).size!==args.length||resume&&!apply)throw Error('Usage: node scripts/deploy-html-training-service.mjs [--apply [--resume]]');
const report={projectId:IMPORT_PROJECT,accountId,serviceEmail,roleName,permissions,mode:apply?'APPLY':'DRY_RUN',stages:[],enabled:false};
async function stage(name){report.stages.push({name,at:new Date().toISOString()});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
function wrangler(args,input){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{env:{...process.env,
  CLOUDFLARE_ACCOUNT_ID:accountId,WRANGLER_LOG:args[0]==='deploy'?'info':'error',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:'.local-preview/wrangler-training-deploy.log'},stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 child.on('error',()=>reject(Error('DEPLOY_WRANGLER_START_FAILED')));
 child.on('close',code=>{if(code!==0)reject(Error('DEPLOY_WRANGLER_FAILED_'+args[0]));else resolve(output);});
 child.stdin.on('error',()=>{});child.stdin.end(input);
});}

let token,newKeyName,secretStored=false;
async function google(url,body,method=body===undefined?'GET':'POST',{missing=false}={}){
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{})},
  ...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
 if(missing&&response.status===404)return null;
 const data=response.status===204?{}:await response.json();
 if(!response.ok)throw Error('DEPLOY_GOOGLE_'+response.status+'_'+(data.error?.status||'ERROR'));
 return data;
}
try{
 const identity=JSON.parse(await wrangler(['whoami','--json']));
 if(identity.loggedIn!==true||identity.email!=='anestesiahmtforms@gmail.com'||!identity.accounts?.some(a=>a.id===accountId))throw Error('DEPLOY_CLOUDFLARE_ACCOUNT_MISMATCH');
 token=await firebaseCliAccountToken(IMPORT_ACCOUNT);
 const rules=await verifyImportRules(token,await fs.readFile('firestore.independent-fb.rules','utf8'));
 Object.assign(report,rules);await stage('AUTH_AND_RULES_VERIFIED');
 const iam='https://iam.googleapis.com/v1/';
 const serviceName=`projects/${IMPORT_PROJECT}/serviceAccounts/${serviceEmail}`;
 let account=await google(iam+serviceName,undefined,'GET',{missing:true});
 let role=await google(iam+roleName,undefined,'GET',{missing:true});
 if(role&&(role.deleted||JSON.stringify([...role.includedPermissions].sort())!==JSON.stringify([...permissions].sort())))throw Error('DEPLOY_ROLE_CONFLICT');
 if(account?.disabled)throw Error('DEPLOY_SERVICE_ACCOUNT_DISABLED');
 if(!apply){report.serviceAccountExists=!!account;report.roleExists=!!role;await stage('DRY_RUN_COMPLETE');console.log(JSON.stringify(report,null,2));process.exit(0);}
 // Publish disabled before provisioning any persistent credential.
 if(!resume)await wrangler(['deploy','--config','worker-training/wrangler.toml']);
 // Confirmed in the actual Cloudflare deployment on 2026-10-25. Wrangler's
 // logger may send the URL only to its log file when run as a subprocess.
 const url='https://sahmt-html-training.anestesiahmtforms.workers.dev';
 const gate=await fetch(url+'/v1/training',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'LIST',input:{}}),signal:AbortSignal.timeout(20000)});
 if(gate.status!==503||(await gate.json()).code!=='TRAINING_UNAVAILABLE')throw Error('DEPLOY_DISABLED_GATE_FAILED');
 report.url=url;await stage('WORKER_PUBLISHED_DISABLED');
 if(!account)account=await google(iam+`projects/${IMPORT_PROJECT}/serviceAccounts`,{
  accountId:'html-training-worker',serviceAccount:{displayName:'SAHMT HTML Training Worker',description:'Backend exclusivo dos treinamentos HTML em FB; sem Apps Script.'}});
 if(account.email!==serviceEmail||account.projectId!==IMPORT_PROJECT)throw Error('DEPLOY_SERVICE_ACCOUNT_MISMATCH');
 if(!role)role=await google(iam+`projects/${IMPORT_PROJECT}/roles`,{roleId:'htmlTrainingWorker',role:{
  title:'HTML Training Worker',description:'Ler perfis e operar treinamentos; sem exclusao de documentos, regras, IAM ou outros projetos.',includedPermissions:permissions,stage:'GA'}});
 const policyUrl=`https://cloudresourcemanager.googleapis.com/v1/projects/${IMPORT_PROJECT}`;
 const policy=await google(policyUrl+':getIamPolicy',{options:{requestedPolicyVersion:3}});
 const member='serviceAccount:'+serviceEmail;
 const bindings=policy.bindings||[];
 if(bindings.some(b=>b.members?.includes(member)&&b.role!==roleName))throw Error('DEPLOY_UNEXPECTED_SERVICE_ROLE');
 const binding=bindings.find(b=>b.role===roleName&&!b.condition);
 if(!binding?.members?.includes(member)){
  if(binding)binding.members.push(member);else bindings.push({role:roleName,members:[member]});
  await google(policyUrl+':setIamPolicy',{policy:{...policy,bindings}});
 }
 await stage('FB_SERVICE_ROLE_READY');
 const keys=await google(iam+serviceName+'/keys?keyTypes=USER_MANAGED');
 if(keys.keys?.length)throw Error('DEPLOY_EXISTING_KEY_REQUIRES_RESUME_REVIEW');
 const key=await google(iam+serviceName+'/keys',{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});
 newKeyName=key.name;report.keyName=newKeyName;
 const credentials=JSON.parse(Buffer.from(key.privateKeyData,'base64').toString('utf8'));
 if(credentials.client_email!==serviceEmail||credentials.project_id!==IMPORT_PROJECT)throw Error('DEPLOY_KEY_PROJECT_MISMATCH');
 const getAccessToken=createServiceTokenProvider({credentials}),store=createFirestoreStore({getAccessToken,fetchImpl:async(url,options)=>{
  const response=await fetch(url,options);
  if(!response.ok){
   const data=await response.clone().json().catch(()=>({}));
   report.serviceReadDiagnostic={status:response.status,code:data.error?.status||null,
    message:data.error?.message||null,reasons:(data.error?.details||[]).filter(d=>d.reason).map(d=>({reason:d.reason,permission:d.metadata?.permission||null}))};
   await stage('SERVICE_READ_RETRY');
  }
  return response;
 }});
 const manifest=JSON.parse(await fs.readFile('.local-preview/html-training-import/manifest.private.json','utf8'));
 let verified=false;
 for(let attempt=0;attempt<24;attempt++){
  try{const item=await store.get('htmlTrainings',manifest.trainings[0].trainingId);if(item?.status!=='DRAFT')throw Error('DEPLOY_BASELINE_MISSING');verified=true;break;}
  catch(error){if(attempt===23)throw error;await new Promise(resolve=>setTimeout(resolve,10000));}
 }
 if(!verified)throw Error('DEPLOY_SERVICE_READ_FAILED');
 await wrangler(['secret','bulk','--config','worker-training/wrangler.toml'],JSON.stringify({FB_TRAINING_SERVICE_ACCOUNT_JSON:JSON.stringify(credentials)}));
 secretStored=true;await stage('SERVICE_CREDENTIAL_STORED_AND_READ_VERIFIED');
 const response=await fetch(url+'/v1/training',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'LIST',input:{}}),signal:AbortSignal.timeout(20000)});
 if(response.status!==503||(await response.json()).code!=='TRAINING_UNAVAILABLE')throw Error('DEPLOY_DISABLED_GATE_FAILED');
 await stage('DISABLED_ENDPOINT_VERIFIED');console.log(JSON.stringify(report,null,2));
}catch(error){
 report.error=error.message;
 if(newKeyName&&!secretStored){
  try{await google('https://iam.googleapis.com/v1/'+newKeyName,undefined,'DELETE');report.newKeyRevoked=true;}
  catch{report.newKeyRevocationRequired=true;}
 }
 await stage('FAILED');console.error(report.error);process.exitCode=1;
}
