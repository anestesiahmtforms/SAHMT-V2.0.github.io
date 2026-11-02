import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
export const FB_CLOUDFLARE={account:'679464db2379db8562b62ae982f30471',email:'anestesiahmtforms2@gmail.com',worker:'sahmt-fb-performance'};
export async function fbCloudflare(){
 const target=FB_CLOUDFLARE;
 const free=JSON.parse(await readFile('.local-preview/fb-performance/workers-free-confirmed.json','utf8'));
 if(free.accountId!==target.account||free.workersFreeConfirmed!==true||free.paidActionsAllowed!==false)throw Error('FB_FREE_CONFIRMATION_REQUIRED');
 const env={...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'};
 for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])delete env[key];
 // Subprocess errors retain stdout/stderr; never propagate a credential command's error.
 let credential;
 try{credential=JSON.parse(execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'auth','token','--json','--profile','sahmt-fb-isolation'],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}));}
 catch{throw Error('FB_CF_CREDENTIAL_UNAVAILABLE');}
 if(credential?.type!=='oauth'||typeof credential.token!=='string'||!credential.token)throw Error('FB_CF_OAUTH_REQUIRED');
 const base='/accounts/'+target.account;
 async function request(path,{method='GET',body}={}){
  if(!(path==='/user'&&method==='GET'||path===base&&method==='GET'||path.startsWith(base+'/workers/')))throw Error('FB_CF_SCOPE_DENIED');
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+credential.token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000),redirect:'error'});
  const value=await response.json();if(!response.ok||value.success!==true)throw Error('FB_CF_HTTP_'+response.status);
  return value.result;
 }
 if((await request('/user')).email!==target.email||(await request(base)).id!==target.account)throw Error('FB_CF_IDENTITY_MISMATCH');
 return {request:(path,options)=>request(base+'/workers/'+path,options),target};
}
