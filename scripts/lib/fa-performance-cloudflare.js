import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
export const FA_ACCOUNT='1851e9f4cd5f026371beaa2c5a85f1b8';
export async function faPerformanceCloudflare(){
 const env={...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'};
 for(const k of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])delete env[k];
 let credential;try{credential=JSON.parse(execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'auth','token','--json'],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}));}catch{throw Error('FA_CF_CREDENTIAL_UNAVAILABLE');}
 if(credential.type!=='oauth')throw Error('FA_CF_OAUTH_REQUIRED');
 const request=async(path,{method='GET',body,missing=false}={})=>{
  if(!(path==='/user'&&method==='GET'||path==='/accounts/'+FA_ACCOUNT||path.startsWith('/accounts/'+FA_ACCOUNT+'/workers/')||path==='/accounts/'+FA_ACCOUNT+'/subscriptions'&&method==='GET'))throw Error('FA_CF_SCOPE_DENIED');
  const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+credential.token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000),redirect:'error'});
  if(missing&&r.status===404)return null;const data=await r.json();if(!r.ok||data.success!==true)throw Error('FA_CF_HTTP_'+r.status);return data.result;
 };
 if((await request('/user')).email!=='anestesiahmtforms@gmail.com'||(await request('/accounts/'+FA_ACCOUNT)).id!==FA_ACCOUNT)throw Error('FA_CF_IDENTITY_MISMATCH');
 return {request};
}
