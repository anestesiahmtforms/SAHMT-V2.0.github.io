import{readFile}from'node:fs/promises';import{resolve}from'node:path';import{execFileSync}from'node:child_process';
const demand=(value,code)=>{if(!value)throw Error(code);};
export async function createFaCloudflareClient(){
 const path=resolve(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml');
 let config=await readFile(path,'utf8');
 const expiry=config.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
 if(expiry&&Date.parse(expiry)<Date.now()+60000){
  execFileSync(process.execPath,[resolve('node_modules','wrangler','bin','wrangler.js'),'whoami'],{windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:60000});
  config=await readFile(path,'utf8');
 }
 const token=config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];demand(token,'CONSOLIDATION_CF_SESSION_MISSING');
 const request=async(path,{method='GET',body,raw=false}={})=>{
  const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},
   ...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('CONSOLIDATION_CF_HTTP_'+r.status);
  if(raw)return {contentType:r.headers.get('Content-Type'),content:await r.text()};
  const value=await r.json();demand(value.success===true,'CONSOLIDATION_CF_API_FAILED');return value.result;
 };
 const accounts=await request('/accounts');let account=null;
 for(const candidate of accounts){const subdomain=await request('/accounts/'+candidate.id+'/workers/subdomain');if(subdomain.subdomain==='anestesiahmtforms'){demand(!account,'CONSOLIDATION_CF_ACCOUNT_AMBIGUOUS');account=candidate;}}
 demand(account,'CONSOLIDATION_CF_ACCOUNT_UNCONFIRMED');
 return {accountId:account.id,request:(suffix,options)=>request('/accounts/'+account.id+suffix,options)};
}
