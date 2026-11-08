import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {sealPrivateJson,openPrivateJson} from './windows-protected-json.js';
export const targets={
 FD:{project:'rotinas-8a617',email:'anestesiahmtforms4@gmail.com',account:'434b7325287b58f36d214c9403819db2',service:'indicator-compiler',worker:'sahmt-indicators',subdomain:'anestesiahmtforms4',secret:'INDICATOR_SERVICE_ACCOUNT_JSON',config:'worker-indicators/wrangler.fd.jsonc',entry:'worker-indicators/worker.js'},
 FE:{project:'outros-48120',email:'anestesiahmtforms5@gmail.com',account:'fb3d38f501820ddf90764aadaa94fc89',service:'fe-survey-worker',worker:'sahmt-fe-surveys',subdomain:'anestesiahmtforms5',secret:'FE_SERVICE_ACCOUNT_JSON',config:'worker-fe-surveys/wrangler.jsonc',entry:'worker-fe-surveys/worker.js'}
};
export const demand=(ok,code)=>{if(!ok)throw Error(code);};
export async function protect(name,value){
 await mkdir('.local-preview/fd-fe-release',{recursive:true});
 await writeFile(resolve('.local-preview/fd-fe-release',name+'.dpapi.json'),JSON.stringify(await sealPrivateJson(value)));
}
export async function unprotect(name){return openPrivateJson(JSON.parse(await readFile(resolve('.local-preview/fd-fe-release',name+'.dpapi.json'),'utf8')));}
export async function report(name,value){await mkdir('docs/superpowers/reports',{recursive:true});await writeFile('docs/superpowers/reports/'+name+'.json',JSON.stringify(value,null,2)+'\n');}
export async function google(url,token,body,method=body===undefined?'GET':'POST',missing=false){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(missing&&r.status===404)return null;
 const data=r.status===204?{}:await r.json();
 demand(r.ok,'RELEASE_GOOGLE_'+r.status+'_'+(data.error?.status||'ERROR'));
 return data;
}
export async function cloudflare(station,{profile}={}){
 const target=targets[station];demand(target,'RELEASE_STATION_INVALID');
 const env={...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'};
 for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])delete env[key];
 const credential=JSON.parse(execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'auth','token','--json',...(profile?['--profile',profile]:[])],{cwd:profile?process.cwd():resolve('.local-preview',station.toLowerCase()+'-cloudflare'),env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}));
 demand(credential.type==='oauth'&&typeof credential.token==='string','RELEASE_OAUTH_INVALID');
 const base='/accounts/'+target.account;
 const request=async(path,{method='GET',body,raw=false,missing=false}={})=>{
  demand((path==='/user'&&method==='GET')||path===base||path.startsWith(base+'/workers/'),'RELEASE_CF_SCOPE_DENIED');
  const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+credential.token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(missing&&r.status===404)return null;
  if(raw){demand(r.ok,'RELEASE_CF_HTTP_'+r.status);return {contentType:r.headers.get('Content-Type'),content:await r.text()};}
  const data=await r.json();demand(r.ok&&data.success===true,'RELEASE_CF_HTTP_'+r.status+'_'+(data.errors?.[0]?.code||'ERROR'));return data.result;
 };
 demand((await request('/user')).email===target.email,'RELEASE_CF_IDENTITY_MISMATCH');
 demand((await request(base)).id===target.account,'RELEASE_CF_ACCOUNT_MISMATCH');
 const free=JSON.parse(await readFile('docs/superpowers/reports/2026-11-01-cloudflare-free-confirmation.json','utf8'));
 demand(free.accounts?.[station]===target.account&&free.workersFreeConfirmed===true&&free.paidActionsAllowed===false,'RELEASE_FREE_CONFIRMATION_REQUIRED');
 return {request:(path,options)=>request(base+path,options),target};
}
