import {createPrivateKey,sign} from 'node:crypto';
export const TRAINING_PROJECT='sahmt-gestao-5ae66';
const error=(code,status=503)=>Object.assign(new Error(code),{code,status});
const b64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');

/** Server-only service identity. Never accepts a project/key supplied by the participant. */
export function createServiceTokenProvider({credentials,fetchImpl=fetch,now=Date.now}={}) {
 if(!credentials||credentials.project_id!==TRAINING_PROJECT||!new RegExp(`^[a-zA-Z0-9._-]+@${TRAINING_PROJECT}\\.iam\\.gserviceaccount\\.com$`).test(credentials.client_email||'')||!credentials.private_key?.includes('PRIVATE KEY'))throw error('TRAINING_SERVICE_CONFIG_INVALID');
 let key;try{key=createPrivateKey(credentials.private_key);}catch{throw error('TRAINING_SERVICE_CONFIG_INVALID');}
 let cached=null,running=null;
 return async()=>{
  if(cached&&cached.until>now()+60000)return cached.token;
  if(!running)running=(async()=>{
   const issued=Math.floor(now()/1000),aud='https://oauth2.googleapis.com/token';
   const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/datastore',aud,iat:issued,exp:issued+3600});
   const assertion=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
   let response,data;try{response=await fetchImpl(aud,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),redirect:'manual',signal:AbortSignal.timeout(15000)});data=await response.json();}catch{throw error('TRAINING_SERVICE_AUTH_UNAVAILABLE');}
   if(!response.ok||typeof data.access_token!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<120||data.expires_in>3600)throw error('TRAINING_SERVICE_AUTH_UNAVAILABLE');
   cached={token:data.access_token,until:now()+data.expires_in*1000};return cached.token;
  })().finally(()=>{running=null;});
  return running;
 };
}

/** accounts:lookup validates the signature against Firebase, then account state is checked on every request. */
export async function verifyTrainingIdentity(authorization,{apiKey,projectId=TRAINING_PROJECT,fetchImpl=fetch,now=Date.now}={}) {
 const denied=()=>error('TRAINING_SESSION_INVALID',401);
 if(typeof apiKey!=='string'||!apiKey||![TRAINING_PROJECT,'sahmt-17a16'].includes(projectId))throw error('TRAINING_SERVICE_CONFIG_INVALID');
 if(!/^Bearer [A-Za-z0-9_.-]{50,16000}$/.test(authorization||''))throw denied();
 const token=authorization.slice(7);let claims;
 try{const parts=token.split('.');if(parts.length!==3)throw Error();claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw denied();}
 const time=now()/1000;
 if(claims.aud!==projectId||claims.iss!==`https://securetoken.google.com/${projectId}`||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>128||/[\s/\x00-\x1f]/.test(claims.sub)||!Number.isFinite(claims.exp)||claims.exp<=time||!Number.isFinite(claims.iat)||claims.iat>time+30||!Number.isFinite(claims.auth_time)||claims.auth_time>time+30||claims.email_verified!==true||claims.firebase?.sign_in_provider!=='google.com'||typeof claims.email!=='string'||claims.email.length>254)throw denied();
 let response,data;try{response=await fetchImpl('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});data=await response.json();}catch{throw error('TRAINING_SESSION_UNAVAILABLE');}
 const user=data.users?.length===1?data.users[0]:null;
 if(!response.ok||!user||user.disabled===true||user.localId!==claims.sub||user.emailVerified!==true||String(user.email).toLowerCase()!==claims.email.toLowerCase()||Number(user.validSince||0)>claims.auth_time)throw denied();
 return {uid:claims.sub,email:claims.email.toLowerCase(),emailVerified:true,provider:'google.com'};
}
