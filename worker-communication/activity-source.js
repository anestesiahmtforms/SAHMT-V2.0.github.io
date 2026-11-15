import {Buffer} from 'node:buffer';
import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';
import {validateObligation} from '../communication/obligations.js';

const sources=Object.freeze({
 TRAINING:{project:'FB',header:'X-SAHMT-FB-Authorization',url:'https://sahmt-html-training.anestesiahmtforms2.workers.dev/v1/training'},
 SURVEY:{project:'FA',header:'X-SAHMT-FA-Authorization',url:'https://sahmt-fe-surveys.anestesiahmtforms5.workers.dev/v1/institutional-surveys'}
});
const failure=(code,status=503)=>Object.assign(Error(code),{code,status});
const invalid=()=>failure('COMM_INVALID_ACTIVITY',400);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,199}$/.test(value);
async function boundedJson(response){
 if(Number(response.headers.get('Content-Length'))>512*1024)throw failure('COMM_SOURCE_UNAVAILABLE');
 const reader=response.body?.getReader();if(!reader)throw failure('COMM_SOURCE_UNAVAILABLE');
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024)throw failure('COMM_SOURCE_UNAVAILABLE');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure('COMM_SOURCE_UNAVAILABLE');}
}

/** Request-local adapter. Only source user tokens are forwarded, never an FF service credential. */
export function createActivitySource({fetchImpl=fetch,headers={},actor}={}){
 const authenticated=new Map();
 async function authenticate(source){
  if(authenticated.has(source.project))return authenticated.get(source.project);
  const denied=()=>failure('COMM_SOURCE_IDENTITY_MISMATCH',401);
  const authorization=typeof headers.get==='function'?headers.get(source.header):Object.entries(headers).find(([key])=>key.toLowerCase()===source.header.toLowerCase())?.[1];
  if(!actor?.uid||typeof actor.email!=='string'||!actor.googleUid||!/^Bearer [A-Za-z0-9_.-]{50,16000}$/.test(authorization||''))throw denied();
  const token=authorization.slice(7),config=GOOGLE_PROJECT_CONFIG[source.project].config;
  let claims;try{const parts=token.split('.');if(parts.length!==3)throw Error();claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw denied();}
  const now=Date.now()/1000,email=actor.email.trim().toLowerCase(),googleIds=claims.firebase?.identities?.['google.com'];
  if(claims.aud!==config.projectId||claims.iss!==`https://securetoken.google.com/${config.projectId}`||!id(claims.sub)||claims.sub.length>128||claims.email?.toLowerCase()!==email||claims.email_verified!==true||claims.firebase?.sign_in_provider!=='google.com'||!Array.isArray(googleIds)||googleIds.length!==1||googleIds[0]!==actor.googleUid||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||!Number.isFinite(claims.auth_time)||claims.auth_time>now+30)throw denied();
  let response,data;
  try{response=await fetchImpl('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});data=await boundedJson(response);}catch{throw failure('COMM_SOURCE_UNAVAILABLE');}
  const user=data.users?.length===1?data.users[0]:null,providers=user?.providerUserInfo?.filter(p=>p.providerId==='google.com');
  if(!response.ok||!user||user.disabled===true||user.localId!==claims.sub||user.emailVerified!==true||user.email?.toLowerCase()!==email||Number(user.validSince||0)>claims.auth_time||providers?.length!==1||providers[0].rawId!==actor.googleUid)throw denied();
  authenticated.set(source.project,authorization);return authorization;
 }
 async function call(kind,action,input){
  if(!Object.hasOwn(sources,kind))throw invalid();
  const source=sources[kind],authorization=await authenticate(source);let response,data;
  try{response=await fetchImpl(source.url,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json',Origin:'https://anestesiahmtforms.github.io'},body:JSON.stringify({action,input}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});data=await boundedJson(response);}catch{throw failure('COMM_SOURCE_UNAVAILABLE');}
  if(!response.ok)throw failure(response.status===401?'COMM_SOURCE_SESSION_INVALID':response.status===403?'COMM_SOURCE_FORBIDDEN':'COMM_SOURCE_UNAVAILABLE',response.status===401?401:response.status===403?403:503);
  if(!data||typeof data!=='object'||Array.isArray(data))throw failure('COMM_SOURCE_UNAVAILABLE');
  return data;
 }
 function checked(activity){const value=validateObligation(activity);if(value.kind==='SURVEY'&&value.cycle!=='2026')throw invalid();return value;}
 const inputFor=activity=>activity.kind==='TRAINING'?{trainingId:activity.id,version:activity.version,minimumScore:activity.minimumScore}:{survey:activity.id,cycle:activity.cycle};
 return Object.freeze({
  async catalog({kind}={}){
   const result=await call(kind,'OBLIGATION_CATALOG',{});
   if(!Array.isArray(result.items)||result.items.length>1000)throw failure('COMM_SOURCE_UNAVAILABLE');
   const items=result.items.map(item=>{
    if(item?.kind!==kind)throw failure('COMM_SOURCE_UNAVAILABLE');
    let value;try{value=checked(kind==='TRAINING'?{kind,id:item.id,title:item.title,version:item.version,maxScore:item.maxScore,minimumScore:item.maxScore}:{kind,id:item.id,title:item.title,cycle:item.cycle});}catch{throw failure('COMM_SOURCE_UNAVAILABLE');}
    if(kind==='TRAINING')delete value.minimumScore;return value;
   });
   return {items};
  },
  async eligibility({activity,recipients}={}){
   const value=checked(activity);
   if(!Array.isArray(recipients)||recipients.length>200||recipients.some(r=>!id(r?.uid)||typeof r.email!=='string'||r.email.length>254||!r.email.includes('@'))||new Set(recipients.map(r=>r.uid)).size!==recipients.length)throw invalid();
   const eligibleUids=[],excluded=[];
   // Keep source transactions and Worker subrequest budgets bounded per batch.
   for(let offset=0;offset<recipients.length;offset+=8){
    const batch=recipients.slice(offset,offset+8).map(({uid,email})=>({uid,email:email.trim().toLowerCase()}));
    const result=await call(value.kind,'OBLIGATION_ELIGIBILITY',{...inputFor(value),recipients:batch});
    if(!Array.isArray(result.eligibleUids)||!Array.isArray(result.excluded))throw failure('COMM_SOURCE_UNAVAILABLE');
    const returned=[...result.eligibleUids,...result.excluded.map(r=>r?.uid)];
    if(returned.length!==batch.length||new Set(returned).size!==batch.length||returned.some(uid=>!batch.some(r=>r.uid===uid))||result.excluded.some(r=>typeof r.reason!=='string'||!/^[A-Z0-9_]{1,90}$/.test(r.reason)))throw failure('COMM_SOURCE_UNAVAILABLE');
    eligibleUids.push(...result.eligibleUids);excluded.push(...result.excluded.map(({uid,reason})=>({uid,reason})));
   }
   return {eligibleUids,excluded};
  },
  async completion({activity}={}){
   const value=checked(activity),result=await call(value.kind,'OBLIGATION_STATUS',inputFor(value));
   if(typeof result.completed!=='boolean')throw failure('COMM_SOURCE_UNAVAILABLE');
   if(result.completed){
    if(value.kind==='SURVEY')return {completed:true};
    if(!Number.isSafeInteger(result.completedAt)||result.completedAt<=0||!Number.isFinite(result.score)||result.score<value.minimumScore||result.score>value.maxScore)throw failure('COMM_SOURCE_UNAVAILABLE');
    return {completed:true,completedAt:result.completedAt,score:result.score};
   }
   return {completed:false,...(result.unavailable===true?{unavailable:true,reason:typeof result.reason==='string'&&/^[A-Z0-9_]{1,90}$/.test(result.reason)?result.reason:'SOURCE_UNAVAILABLE'}:{})};
  }
 });
}
