import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
export const FD_ACCOUNT='434b7325287b58f36d214c9403819db2';
export async function fdManualCloudflare(){
 const free=JSON.parse(await readFile('docs/superpowers/reports/2026-11-01-cloudflare-free-confirmation.json','utf8'));
 if(free.accounts.FD!==FD_ACCOUNT||!free.workersFreeConfirmed||free.paidActionsAllowed!==false)throw Error('FD_FREE_REQUIRED');
 const env={...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'};for(const k of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])delete env[k];
 let auth;try{auth=JSON.parse(execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'auth','token','--json','--profile','sahmt-fd-isolation'],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}));}catch{throw Error('FD_CREDENTIAL_UNAVAILABLE');}
 if(auth.type!=='oauth')throw Error('FD_OAUTH_REQUIRED');
 const base='/accounts/'+FD_ACCOUNT,path=base+'/workers/scripts/sahmt-indicators',scheduler=base+'/workers/scripts/sahmt-fd-refresh-scheduler';
 const request=async(suffix,{method='GET',body,raw=false}={})=>{
  if(!(suffix==='/user'&&method==='GET'||suffix===base&&method==='GET'||suffix===path||suffix.startsWith(path+'/')||suffix===scheduler||suffix.startsWith(scheduler+'/')))throw Error('FD_CF_SCOPE_DENIED');
  let r;for(let attempt=0;attempt<3;attempt++){r=await fetch('https://api.cloudflare.com/client/v4'+suffix,{method,headers:{Authorization:'Bearer '+auth.token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});if(method!=='GET'||r.status<500||attempt===2)break;await r.body?.cancel();await new Promise(resolve=>setTimeout(resolve,500));}
  if(r.status===404&&method==='GET')return null;if(!r.ok)throw Error('FD_CF_HTTP_'+r.status);if(raw)return {contentType:r.headers.get('Content-Type'),content:await r.text()};const d=await r.json();if(!d.success)throw Error('FD_CF_FAILED');return d.result;
 };
 if((await request('/user')).email!=='anestesiahmtforms4@gmail.com'||(await request(base)).id!==FD_ACCOUNT)throw Error('FD_IDENTITY_MISMATCH');return {request:(suffix,options)=>request(path+suffix,options),schedulerRequest:(suffix,options)=>request(scheduler+suffix,options)};
}
