import {createPrivateKey,sign,createPublicKey,verify as verifySignature} from 'node:crypto';
import {verifyFaSession,boundedJson} from '../worker-operational-domain/identity.js';
import {decodeFields} from '../worker-training/firestore.js';
import {fiError} from './store.js';
const FI='sahmt-operacional-fi',FA='sahmt-17a16';
const email=v=>String(v||'').trim().toLowerCase();
export function createFiServiceToken({credentials,fetchImpl=fetch,now=Date.now}){
 if(credentials?.project_id!==FI||credentials.client_email!==`fi-control-worker@${FI}.iam.gserviceaccount.com`)throw fiError('FI_SERVICE_CONFIG_REQUIRED');
 let key;try{key=createPrivateKey(credentials.private_key);}catch{throw fiError('FI_SERVICE_CONFIG_REQUIRED');}
 let cached,pending;return async()=>{
  if(cached?.until>now()+60000)return cached.value;
  if(!pending)pending=(async()=>{const issued=Math.floor(now()/1000),b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
   const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:issued,exp:issued+3600});
   const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url')}),redirect:'manual',signal:AbortSignal.timeout(15000)});
   const value=await boundedJson(response,16384);if(!response.ok||typeof value.access_token!=='string'||!Number.isFinite(value.expires_in)||value.expires_in<120||value.expires_in>3600)throw fiError('FI_SERVICE_AUTH_FAILED');
   cached={value:value.access_token,until:now()+value.expires_in*1000};return cached.value;
  })().finally(()=>pending=null);return pending;
 };
}
async function verifyAppCheck(token,{fetchImpl,now=Date.now}){
 try{
  if(typeof token!=='string'||token.length>16000)throw Error();const parts=token.split('.');if(parts.length!==3)throw Error();
  const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!=='https://firebaseappcheck.googleapis.com/1072832154794'||!Array.isArray(claims.aud)||!claims.aud.includes('projects/1072832154794')||claims.sub!=='1:1072832154794:web:38e8e627d4189ebb0a14d3'||!Number.isFinite(claims.exp)||claims.exp<=now()/1000||!Number.isFinite(claims.iat)||claims.iat>now()/1000+30)throw Error();
  const r=await fetchImpl('https://firebaseappcheck.googleapis.com/v1/jwks',{redirect:'manual',signal:AbortSignal.timeout(10000)}),body=await boundedJson(r,65536),jwk=body.keys?.find(k=>k.kid===header.kid);if(!r.ok||!jwk||!verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error();
 }catch{throw fiError('FI_APP_CHECK_REQUIRED',403);}
}
export function createFiActorVerifier({store,verifySession=verifyFaSession,fetchImpl=fetch,now=Date.now}){
 return async(request,env)=>{
  if(env.FI_REQUIRE_APP_CHECK==='true')await verifyAppCheck(request.headers.get('X-Firebase-AppCheck'),{fetchImpl,now});
  const identity=await verifySession(request.headers.get('Authorization'),{apiKey:env.FA_PUBLIC_API_KEY,fetchImpl,now});
  if(identity.emailVerified!==true)throw fiError('FI_FORBIDDEN',403);
  const path=`projects/${FA}/databases/(default)/documents/users/${identity.uid}`;
  const response=await fetchImpl('https://firestore.googleapis.com/v1/'+path,{headers:{Authorization:request.headers.get('Authorization'),...(request.headers.get('X-Firebase-AppCheck')?{'X-Firebase-AppCheck':request.headers.get('X-Firebase-AppCheck')}:{})},redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw fiError([401,403,404].includes(response.status)?'FI_FORBIDDEN':'FI_SOURCE_UNAVAILABLE',[401,403,404].includes(response.status)?403:503);
  const document=await boundedJson(response,65536),gate=decodeFields(document.fields||{});
  if(document.name!==path||gate.uid!==identity.uid||email(gate.email)!==identity.email||gate.active!==true||gate.access!==true)throw fiError('FI_FORBIDDEN',403);
  const link=await store.get('fiAdminIdentityLinks',identity.uid);
  if(link?.active!==true||link.faUid!==identity.uid||typeof link.fiUid!=='string'||email(link.email)!==identity.email)throw fiError('FI_FORBIDDEN',403);
  const localProfile=await store.get('users',link.fiUid),managed=await store.get('fiAdminUsers',identity.uid);
  if(localProfile?.uid!==link.fiUid||email(localProfile.email)!==identity.email||managed&&(managed.uid!==identity.uid||email(managed.email)!==identity.email))throw fiError('FI_FORBIDDEN',403);
  const profile=managed?{...localProfile,...managed,uid:link.fiUid,faUid:identity.uid}:localProfile;
  if(profile.active!==true||profile.access!==true)throw fiError('FI_FORBIDDEN',403);
  const assignmentId=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity.email)))).toString('hex');
  const assignment=await store.get('memberCategoryAssignments',assignmentId);
  const categories=assignment?.schemaVersion===1&&assignment.identityStatus==='LINKED'&&assignment.uid===identity.uid&&email(assignment.email)===identity.email&&Array.isArray(assignment.memberCategories)?assignment.memberCategories:[];
  return {uid:identity.uid,fiUid:link.fiUid,email:identity.email,profile,identityLink:link,memberCategories:categories};
 };
}
