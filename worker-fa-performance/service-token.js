import {createPrivateKey,sign} from 'node:crypto';
export const FA_PROJECT='sahmt-17a16';
const error=(code,status=503)=>Object.assign(new Error(code),{code,status});
const b64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');

/** Server-only service identity. Never accepts a project/key supplied by the participant. */
export function createServiceTokenProvider({credentials,fetchImpl=fetch,now=Date.now}={}) {
 if(!credentials||credentials.project_id!==FA_PROJECT||!new RegExp(`^[a-zA-Z0-9._-]+@${FA_PROJECT}\\.iam\\.gserviceaccount\\.com$`).test(credentials.client_email||'')||!credentials.private_key?.includes('PRIVATE KEY'))throw error('FA_SERVICE_CONFIG_INVALID');
 let key;try{key=createPrivateKey(credentials.private_key);}catch{throw error('FA_SERVICE_CONFIG_INVALID');}
 let cached=null,running=null;
 return async()=>{
  if(cached&&cached.until>now()+60000)return cached.token;
  if(!running)running=(async()=>{
   const issued=Math.floor(now()/1000),aud='https://oauth2.googleapis.com/token';
   const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/datastore',aud,iat:issued,exp:issued+3600});
   const assertion=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
   let response,data;try{response=await fetchImpl(aud,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});data=await response.json();}catch{throw error('FA_SERVICE_AUTH_UNAVAILABLE');}
   if(!response.ok||typeof data.access_token!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<120||data.expires_in>3600)throw error('FA_SERVICE_AUTH_UNAVAILABLE');
   cached={token:data.access_token,until:now()+data.expires_in*1000};return cached.token;
  })().finally(()=>{running=null;});
  return running;
 };
}

