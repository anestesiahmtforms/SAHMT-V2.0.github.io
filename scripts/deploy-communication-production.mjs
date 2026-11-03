import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {openPrivateJson} from './lib/windows-protected-json.js';
const config='worker-communication/wrangler.jsonc',account='7c4c3dcb7472c5daa58620efd358dfb1';
const env={...process.env,CI:'true',CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'};
for(const k of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])delete env[k];
const binary=resolve('node_modules/wrangler/bin/wrangler.js');
try{
 if(!process.argv.includes('--apply'))throw Error('FF_DEPLOY_APPLY_REQUIRED');
 const target=JSON.parse(await readFile(config,'utf8'));if(target.account_id!==account||target.name!=='sahmt-ff-comunicacao')throw Error('FF_DEPLOY_TARGET_INVALID');
 let auth;try{auth=JSON.parse(execFileSync(process.execPath,[binary,'auth','token','--json','--profile','sahmt-ff-isolation'],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}));}catch{throw Error('FF_PROFILE_UNAVAILABLE');}
 const api=async path=>{const r=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:'Bearer '+auth.token}});if(!r.ok)throw Error('FF_CF_HTTP_'+r.status);return(await r.json()).result;};
 if((await api('/user')).email!=='anestesiahmtforms6@gmail.com'||(await api('/accounts/'+account)).id!==account)throw Error('FF_CF_IDENTITY_MISMATCH');
 const credentials=await openPrivateJson(JSON.parse(await readFile(resolve(process.env.LOCALAPPDATA,'SAHMT','communication-production','worker.dpapi.json'),'utf8')));
 if(credentials.project_id!=='sahmt-comunicacao-ff'||credentials.client_email!=='communication-worker@sahmt-comunicacao-ff.iam.gserviceaccount.com')throw Error('FF_SERVICE_IDENTITY_INVALID');
 const run=(args,input)=>{try{return execFileSync(process.execPath,[binary,...args,'--config',config,'--profile','sahmt-ff-isolation'],{env,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],...(input?{input}:{}),timeout:120000});}catch{throw Error('FF_DEPLOYMENT_FAILED');}};
 // User confirmed Workers Free for this exact account on 03/11/2026.
 // First install code disabled; then install secret; only then activate API.
 const first=run(['deploy']);
 run(['secret','bulk'],JSON.stringify({FF_SERVICE_ACCOUNT_JSON:JSON.stringify(credentials)}));
 const deployed=run(['deploy','--var','COMMUNICATION_ENABLED:true','--var','WORKERS_FREE_CONFIRMED:true']);
 const subdomain=await api('/accounts/'+account+'/workers/subdomain');
 const endpoint=`https://${target.name}.${subdomain.subdomain}.workers.dev/v1/communication`;
 const unauth=await fetch(endpoint,{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'BOOTSTRAP'})});
 const denied=await unauth.json();if(unauth.status!==401||denied.code!=='COMM_SESSION_INVALID')throw Error('FF_UNAUTHENTICATED_PROBE_FAILED');
 await mkdir('.local-preview/communication-production',{recursive:true});
 await writeFile('.local-preview/communication-production/deployment.json',JSON.stringify({account,worker:target.name,endpoint,freeConfirmedByUser:true,unauthenticatedDenied:true,at:new Date().toISOString()},null,2));
 await writeFile('.local-preview/communication-production/deployment.log',first+'\n'+deployed);
 console.log(JSON.stringify({deployed:true,account,endpoint,secretInstalled:true,unauthenticatedDenied:true,pushSent:false}));
}catch(e){console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'FF_DEPLOY_FAILED');process.exitCode=1;}
