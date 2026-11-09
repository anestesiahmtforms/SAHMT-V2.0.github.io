import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {openPrivateJson,sealPrivateJson} from './lib/windows-protected-json.js';
import {createFiServiceToken} from '../worker-fi-control/identity.js';
import {createFiStore,FI_PROJECTS} from '../worker-fi-control/store.js';

const account='948f85652861c7c25506625091d2120d',owner='anestesiahmtforms9@gmail.com';
const project=FI_PROJECTS.FI,worker='sahmt-fi-control',subdomain='sahmt-fi-948f8565';
const directory='.local-preview/fi-control',config='worker-fi-control/wrangler.jsonc';
const firebase='https://firebaserules.googleapis.com/v1',releaseName=`projects/${project}/releases/cloud.firestore`;
const endpoint=`https://${worker}.${subdomain}.workers.dev`;
const profile='sahmt-fi-isolation',wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
const env={...process.env,CI:'true',CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'};
for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL','CLOUDFLARE_ACCOUNT_ID'])delete env[key];
const demand=(value,code)=>{if(!value)throw Error(code);};
const run=(args,input)=>execFileSync(process.execPath,[wrangler,...args,'--profile',profile],{env,input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:85000});
async function json(url,{token,body,method=body===undefined?'GET':'POST',missing=false}={}){
 const response=await fetch(url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(missing&&response.status===404)return null;
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result)throw Error('FI_DEPLOY_HTTP_'+response.status);
 return result;
}
async function secureRules(token){
 const options={token},current=await json(firebase+'/'+releaseName,{token,missing:true});
 if(current)demand(current.name===releaseName&&current.rulesetName.startsWith(`projects/${project}/rulesets/`),'FI_RULES_TARGET_MISMATCH');
 const old=current?await json(firebase+'/'+current.rulesetName,options):null;
 const normalize=value=>value.replaceAll('\r\n','\n');
 const content=normalize(await readFile('firestore.fi-control.rules','utf8')),name='firestore.fi-control.rules';
 if(old?.source?.files?.length===1&&typeof old.source.files[0].content==='string'&&normalize(old.source.files[0].content)===content)return current.rulesetName;
 const backup=await sealPrivateJson({current,old});
 await writeFile(`${directory}/rules-before.dpapi.json`,JSON.stringify(backup),{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 await openPrivateJson(JSON.parse(await readFile(`${directory}/rules-before.dpapi.json`,'utf8')));
 const rules=await json(firebase+`/projects/${project}/rulesets`,{token,body:{source:{files:[{name,content}]}}});
 demand(rules.name.startsWith(`projects/${project}/rulesets/`),'FI_RULES_TARGET_MISMATCH');
 const check=await json(firebase+'/'+releaseName,{token,missing:true});
 demand(check?.updateTime===current?.updateTime&&check?.rulesetName===current?.rulesetName,'FI_RULES_DRIFT');
 const release={name:releaseName,rulesetName:rules.name};
 if(current)await json(firebase+'/'+releaseName,{token,method:'PATCH',body:{release,updateMask:'rulesetName'}});
 else await json(firebase+`/projects/${project}/releases`,{token,body:release});
 const published=await json(firebase+'/'+releaseName,options);
 demand(published.rulesetName===rules.name,'FI_RULES_READBACK_FAILED');
 return published.rulesetName;
}
let stage='PREFLIGHT';
try{
 const pilot=process.argv.includes('--apply-pilot');
 demand(pilot!==process.argv.includes('--apply-disabled'),'FI_DEPLOY_MODE_REQUIRED');
 const target=JSON.parse(await readFile(config,'utf8'));
 demand(target.name===worker&&target.account_id===account&&['FI_CONTROL_ENABLED','FI_AI_ENABLED','FI_MONTHLY_ENABLED'].every(k=>target.vars[k]==='false')&&target.vars.FI_REQUIRE_APP_CHECK==='true','FI_DEPLOY_CONFIG_INVALID');
 const token=await firebaseCliAccountToken(owner);
 const billing=await json(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`,{token});
 demand(billing.billingEnabled===false,'FI_BILLING_ENABLED');
 const credentials=await openPrivateJson(JSON.parse(await readFile(`${directory}/service-key.dpapi.json`,'utf8')));
 const getAccessToken=createFiServiceToken({credentials});
 const store=createFiStore({projectId:project,getAccessToken});
 const marker=await store.get('fiControlMigrations','initial');
 demand(marker?.sourceDeletes===0&&marker?.counts?.plannedDocuments>0,'FI_IMPORT_NOT_READY');
 if(pilot){
  const plan=await store.get('fiControlConfig','pilot');
  demand(plan?.schemaVersion===1&&typeof plan.uid==='string'&&plan.expiresAt>Date.now()&&plan.monthlyBudgetMicros===250000,'FI_PILOT_NOT_READY');
 }
 stage='RULES';
 const ruleset=await secureRules(token);
 console.log(JSON.stringify({stage,ruleset,readbackVerified:true}));
 stage='CLOUDFLARE_PREFLIGHT';
 const auth=JSON.parse(run(['auth','token','--json']));
 demand(auth.type==='oauth'&&typeof auth.token==='string','FI_CF_CREDENTIAL_INVALID');
 const cf=async(path,missing=false)=>{
  const data=await json('https://api.cloudflare.com/client/v4'+path,{token:auth.token,missing});
  if(data===null)return null;
  demand(data.success===true,'FI_CF_RESPONSE_INVALID');return data.result;
 };
 const path='/accounts/'+account;
 const [identity,accountInfo,domain]=await Promise.all([cf('/user'),cf(path),cf(path+'/workers/subdomain')]);
 demand(identity.email===owner&&accountInfo.id===account&&domain.subdomain===subdomain,'FI_CF_TARGET_MISMATCH');
 const scripts=await cf(path+'/workers/scripts');
 if(scripts.some(item=>item.id===worker)){
  const health=await json(endpoint+'/health');
  demand(health.projectId===project&&health.controlEnabled===false&&health.aiEnabled===false&&health.monthlyEnabled===false,'FI_WORKER_EXISTS_REVIEW_REQUIRED');
 }
 stage='DEPLOY_DISABLED';
 run(['deploy','--config',config,...(pilot?['--var','FI_PILOT_ENABLED:true']:[])]);
 stage='STORE_WORKER_CREDENTIAL';
 run(['secret','bulk','--config',config],JSON.stringify({FI_SERVICE_ACCOUNT_JSON:JSON.stringify(credentials)}));
 stage='VERIFY_DEPLOYMENT';
 const secrets=await cf(path+'/workers/scripts/'+worker+'/secrets');
 demand(secrets.some(item=>item.name==='FI_SERVICE_ACCOUNT_JSON'&&item.type==='secret_text')&&(!pilot||secrets.some(item=>item.name==='OPENAI_API_KEY'&&item.type==='secret_text')),'FI_SECRET_READBACK_FAILED');
 let verified=false;
 for(let attempt=0;attempt<5&&!verified;attempt++){
  try{
   const health=await json(endpoint+'/health');
   const blocked=await fetch(endpoint+'/v1/control',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:'{"action":"search","input":{"query":"teste"}}',redirect:'error',signal:AbortSignal.timeout(10000)});
   verified=health.projectId===project&&health.controlEnabled===false&&health.aiEnabled===false&&health.monthlyEnabled===false&&health.pilotEnabled===pilot&&blocked.status===503&&(await blocked.json()).code==='FI_NOT_READY';
  }catch{}
  if(!verified)await new Promise(resolve=>setTimeout(resolve,2000));
 }
 demand(verified,'FI_API_READBACK_FAILED');
 if(pilot){
  const unauthenticated=await fetch(endpoint+'/v1/pilot',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:'{"action":"service.status","input":{}}',redirect:'error',signal:AbortSignal.timeout(10000)});
  demand(unauthenticated.status===403&&(await unauthenticated.json()).code==='FI_APP_CHECK_REQUIRED','FI_PILOT_AUTH_GUARD_FAILED');
 }
 const report={project,worker,endpoint,ruleset,controlEnabled:false,aiEnabled:false,monthlyEnabled:false,pilotEnabled:pilot,firestoreBillingEnabled:false,cloudCredentialInstalled:true,serviceCredentialValidatedLocally:true,source:await readFile('worker-fi-control/worker.js','utf8').then(s=>createHash('sha256').update(s).digest('hex')),at:new Date().toISOString()};
 await writeFile(`${directory}/deployment.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}catch(error){
 console.error(JSON.stringify({stage,code:/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'FI_DEPLOY_FAILED'}));process.exitCode=1;
}
