import {createPrivateKey,sign} from 'node:crypto';
import {FK_PROJECT} from './performance-store.js';
import {Buffer} from 'node:buffer';

const validUid=value=>typeof value==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(value)&&!['.','..'].includes(value);

/** Verify the Firebase FK session created only by the FA→FK custom-token bridge. */
export async function verifyFunctionalIdentity(authorization,{apiKey,fetchImpl=fetch,now=Date.now}={}){
 const deny=()=>Object.assign(Error('FK_AUTH_REQUIRED'),{code:'FK_AUTH_REQUIRED',status:401});
 if(typeof apiKey!=='string'||!apiKey)throw Error('FK_AUTH_CONFIG_REQUIRED');
 const match=/^Bearer ([A-Za-z0-9_.-]{50,16000})$/.exec(authorization||'');
 if(!match)throw deny();
 let claims;
 try{const parts=match[1].split('.');if(parts.length!==3)throw Error();claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw deny();}
 const seconds=now()/1000,uid=claims.sub,custom=claims.firebase?.sign_in_provider==='custom';
 if(claims.aud!==FK_PROJECT||claims.iss!==`https://securetoken.google.com/${FK_PROJECT}`||!validUid(uid)||!custom||
   !Number.isFinite(claims.exp)||claims.exp<=seconds||!Number.isFinite(claims.iat)||claims.iat>seconds+30||
   !Number.isFinite(claims.auth_time)||claims.auth_time>seconds+30)throw deny();
 const functionalRole=claims.functionalRole,functionalGroup=claims.functionalGroup;
 const functionalPermissions=claims.functionalPermissions;
 const email=typeof claims.functionalEmail==='string'?claims.functionalEmail.trim().toLowerCase():'';
 const supported=(functionalRole==='MEMBER'&&functionalGroup==='EQUIPE'&&email.length>0&&Array.isArray(functionalPermissions)&&functionalPermissions.length===0)||
   (functionalRole==='ADMIN'&&functionalGroup==='ADMINISTRADOR'&&email==='wx2064@gmail.com'&&Array.isArray(functionalPermissions))||
   (functionalRole==='GESTOR'&&functionalGroup==='GESTOR'&&email==='marcio.henrique82@gmail.com'&&Array.isArray(functionalPermissions));
 if(!supported||functionalPermissions.length>12||new Set(functionalPermissions).size!==functionalPermissions.length||
   functionalPermissions.some(value=>!['performance','professionalRegistration','epidemiological','fe','climateSurvey','stressFatigue','biosafetyManual','vaccination','dosimetry'].includes(value)))throw deny();
 let response,data;
 try{response=await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:match[1]}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});data=await response.json();}
 catch{throw Object.assign(Error('FK_AUTH_UNAVAILABLE'),{code:'FK_AUTH_UNAVAILABLE',status:503});}
 const user=data?.users?.length===1?data.users[0]:null;
 if(!response.ok||!user||user.localId!==uid||user.disabled===true)throw deny();
 return Object.freeze({uid,email,functionalRole,functionalGroup,functionalPermissions:Object.freeze([...functionalPermissions]),provider:'custom',emailVerified:true});
}

export function functionalServiceToken({credentials,fetchImpl=fetch,now=Date.now}={}){
 const expectedEmail='fk-performance@'+FK_PROJECT+'.iam.gserviceaccount.com';
 if(credentials?.project_id!==FK_PROJECT||credentials.client_email!==expectedEmail||!credentials.private_key?.includes('PRIVATE KEY'))throw Error('FUNCTIONAL_SERVICE_CONFIG_INVALID');
 const key=createPrivateKey(credentials.private_key);let cached,pending;const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 return async()=>{
  if(cached?.until>now()+60000)return cached.token;
  if(!pending)pending=(async()=>{
   const issuedAt=Math.floor(now()/1000),audience='https://oauth2.googleapis.com/token',unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:audience,iat:issuedAt,exp:issuedAt+3600}),assertion=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
   const response=await fetchImpl(audience,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),redirect:'manual',signal:AbortSignal.timeout(15000)});
   if(!response.ok){await response.body?.cancel();throw Error('FUNCTIONAL_SERVICE_AUTH_UNAVAILABLE');}
   const body=await response.json();if(typeof body.access_token!=='string'||!Number.isFinite(body.expires_in)||body.expires_in<120||body.expires_in>3600)throw Error('FUNCTIONAL_SERVICE_AUTH_UNAVAILABLE');
   cached={token:body.access_token,until:now()+body.expires_in*1000};return cached.token;
  })().finally(()=>pending=null);
  return pending;
 };
}
