import {createPrivateKey,sign} from 'node:crypto';
import {FF,fail} from '../communication/domain.js';
import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';
export async function boundedJson(response,max=512*1024){
 if(!response.body)throw fail('COMM_SERVICE_UNAVAILABLE',503);
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max)throw fail('COMM_RESPONSE_LIMIT',503);chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('COMM_SERVICE_UNAVAILABLE',503);}
}
export function serviceToken(credentials,fetchImpl=fetch){
 if(credentials?.project_id!==FF.projectId||credentials.client_email!==`communication-worker@${FF.projectId}.iam.gserviceaccount.com`)throw fail('COMM_CONFIG_REQUIRED',503);
 const key=createPrivateKey(credentials.private_key);let cached;
 return async()=>{
  if(cached)return cached;
  const iat=Math.floor(Date.now()/1000),b=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned=b({alg:'RS256',typ:'JWT'})+'.'+b({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600});
  const r=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url')})});
  const d=await boundedJson(r,16384);if(!r.ok||typeof d.access_token!=='string')throw fail('COMM_SERVICE_UNAVAILABLE',503);cached=d.access_token;return cached;
 };
}
// accounts:lookup verifies the signature with Google's server, not with decoded claims.
export async function verifyToken(authorization,target,{fetchImpl=fetch,now=Date.now}={}){
 const config=GOOGLE_PROJECT_CONFIG[target]?.config;
 if(!['FA','FF'].includes(target)||!config)throw fail('COMM_CONFIG_REQUIRED',503);
 const denied=()=>fail('COMM_SESSION_INVALID',401);
 if(!/^Bearer [A-Za-z0-9_.-]{50,16000}$/.test(authorization||''))throw denied();
 const token=authorization.slice(7);let c;
 try{const parts=token.split('.');if(parts.length!==3)throw Error();c=JSON.parse(Buffer.from(parts[1],'base64url').toString());}catch{throw denied();}
 const time=now()/1000,google=c.firebase?.identities?.['google.com'];
 if(c.aud!==config.projectId||c.iss!==`https://securetoken.google.com/${config.projectId}`||typeof c.sub!=='string'||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(c.sub)||!Number.isFinite(c.exp)||c.exp<=time||!Number.isFinite(c.iat)||c.iat>time+30||!Number.isFinite(c.auth_time)||c.auth_time>time+30||c.email_verified!==true||c.firebase?.sign_in_provider!=='google.com'||!Array.isArray(google)||google.length!==1||typeof google[0]!=='string'||typeof c.email!=='string')throw denied();
 const r=await fetchImpl('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+config.apiKey,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});
 const d=await boundedJson(r,32768),u=d.users?.length===1?d.users[0]:null;
 if(!r.ok||!u||u.localId!==c.sub||u.disabled||u.emailVerified!==true||u.email?.toLowerCase()!==c.email.toLowerCase()||Number(u.validSince||0)>c.auth_time||!u.providerUserInfo?.some(p=>p.providerId==='google.com'&&p.rawId===google[0]))throw denied();
 return {uid:c.sub,email:c.email.toLowerCase(),emailVerified:true,googleUid:google[0]};
}
export async function verifyPair(request,options){
 const ff=await verifyToken(request.headers.get('Authorization'),'FF',options);
 const fa=await verifyToken(request.headers.get('X-SAHMT-FA-Authorization'),'FA',options);
 if(ff.googleUid!==fa.googleUid||ff.email!==fa.email)throw fail('COMM_IDENTITY_MISMATCH',403);
 return {...ff,sourceUid:ff.uid,faUid:fa.uid};
}
export async function verifyCommunicationActor(request,options){
 const ff=await verifyToken(request.headers.get('Authorization'),'FF',options);
 return {...ff,sourceUid:ff.uid};
}
export async function assertFreeProject(getToken,fetchImpl=fetch){
 for(const [url,valid]of [
  [`https://cloudbilling.googleapis.com/v1/projects/${FF.projectId}/billingInfo`,d=>d.billingEnabled===false&&!d.billingAccountName],
  [`https://firestore.googleapis.com/v1/projects/${FF.projectId}/databases/${FF.databaseId}`,d=>d.name===`projects/${FF.projectId}/databases/${FF.databaseId}`&&d.freeTier===true]
 ]){const r=await fetchImpl(url,{headers:{Authorization:'Bearer '+await getToken()},redirect:'manual',signal:AbortSignal.timeout(10000)});const d=await boundedJson(r,32768);if(!r.ok||!valid(d))throw fail('COMM_FREE_PLAN_UNCONFIRMED',503);}
}
