import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
const FC='indicadores---sahmt';
const mac=(payload,key)=>createHmac('sha256',key).update('SAHMT_OCCURRENCE_SCORE_V1\n'+payload).digest('hex');
const result=(code,status,origin)=>new Response(JSON.stringify({code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})}});
async function limited(message,max,signal) {
 const reader=message.body?.getReader();if(!reader)throw Error('EMPTY');let size=0;const chunks=[];
 const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal?.aborted)throw Error('TIMEOUT');const {done,value}=await reader.read();if(signal?.aborted)throw Error('TIMEOUT');if(done)break;size+=value.byteLength;if(size>max)throw Error('LARGE');chunks.push(value);}}
 finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** An exact FC claim read proves bearer identity. Trusted backend independently
 * checks FA app authorization and FC evidence; no amount or personal narrative is relayed. */
export async function relayOccurrenceScore(request,env,{fetchImpl=fetch,now=Date.now,admitRequest}={}) {
 const origin=request.headers.get('Origin'),allowed=['https://anestesiahmtforms.github.io',env.OCCURRENCE_SCORING_PILOT_ORIGIN].filter(Boolean);
 if(!allowed.includes(origin))return result('OCCURRENCE_SCORE_ORIGIN_DENIED',403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type',Vary:'Origin'}});
 if(request.method!=='POST')return result('OCCURRENCE_SCORE_METHOD_DENIED',405,origin);
 if(env.OCCURRENCE_SCORING_ENABLED!=='true')return result('OCCURRENCE_SCORING_DISABLED',503,origin);
 const key=env.OCCURRENCE_SCORING_HMAC_SECRET,url=env.FC_MODULE_SCRIPT_URL||env.OCCURRENCE_SCORING_SCRIPT_URL;
 if(!/^[A-Za-z0-9_-]{43}$/.test(key||'')||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(url||''))return result('OCCURRENCE_SCORE_CONFIG_INVALID',503,origin);
 const authorization=request.headers.get('Authorization')||'';
 if(!/^Bearer [A-Za-z0-9_.-]{100,16000}$/.test(authorization))return result('OCCURRENCE_SCORE_SESSION_INVALID',401,origin);
 if(typeof admitRequest!=='function')return result('OCCURRENCE_SCORE_ADMISSION_UNAVAILABLE',503,origin);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
 let admission,remoteStarted=false,remoteFinished=false;
 try{
  admission=await admitRequest({origin,route:'/v1/evaluation/occurrence',method:'POST'},{signal:controller.signal});
  if(admission?.allowed!==true||typeof admission.release!=='function')return result('OCCURRENCE_SCORE_BUSY',429,origin);
  const input=await limited(request,512,controller.signal);
  if(!input||Object.keys(input).join(',')!=='id'||!/^[A-Fa-f0-9-]{36}$/.test(input.id||''))return result('OCCURRENCE_SCORE_INPUT_INVALID',400,origin);
  const name=`projects/${FC}/databases/(default)/documents/occurrenceScoreClaims/${input.id}`;
  const read=await fetchImpl('https://firestore.googleapis.com/v1/'+name+'?mask.fieldPaths=uid&mask.fieldPaths=sourceId',{method:'GET',headers:{Authorization:authorization},redirect:'error',signal:controller.signal,cache:'no-store'});
  if(read.status!==200){await read.body?.cancel().catch(()=>{});return result('OCCURRENCE_SCORE_CLAIM_UNAVAILABLE',[401,403,404].includes(read.status)?read.status:503,origin);}
  const doc=await limited(read,4096,controller.signal),claims=JSON.parse(Buffer.from(authorization.slice(7).split('.')[1],'base64url').toString('utf8'));
  if(doc.name!==name||doc.fields?.sourceId?.stringValue!==input.id||claims.aud!==FC||claims.iss!==`https://securetoken.google.com/${FC}`||
    typeof claims.sub!=='string'||doc.fields.uid?.stringValue!==claims.sub)return result('OCCURRENCE_SCORE_AUTHOR_DENIED',403,origin);
  const nonce=randomBytes(16).toString('hex'),issuedAt=now(),payload=Buffer.from(JSON.stringify({v:1,aud:'sahmt-occurrence-score',nonce,issuedAt,expiresAt:issuedAt+60000,id:input.id,uid:claims.sub})).toString('base64url');
  remoteStarted=true;
  let reply=await fetchImpl(url+'?action=occurrence-score-v1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,mac:mac(payload,key)}),redirect:'manual',signal:controller.signal});
  if([302,303].includes(reply.status)){
   const redirect=new URL(reply.headers.get('Location'));
   if(redirect.protocol!=='https:'||redirect.hostname!=='script.googleusercontent.com'||redirect.port||redirect.username||redirect.password||redirect.hash||redirect.pathname!=='/macros/echo'||!redirect.searchParams.get('user_content_key')||
    [...redirect.searchParams.keys()].some(k=>!['user_content_key','lib'].includes(k))||new Set(redirect.searchParams.keys()).size!==[...redirect.searchParams.keys()].length||redirect.href.length>8192)throw Error('REDIRECT');
   await reply.body?.cancel().catch(()=>{});reply=await fetchImpl(redirect.href,{method:'GET',redirect:'error',signal:controller.signal});
  }
  if(reply.status!==200)throw Error('HTTP');const envelope=await limited(reply,4096,controller.signal);
  if(typeof envelope.payload!=='string'||envelope.payload.length>2048||!/^[A-Za-z0-9_-]+$/.test(envelope.payload)||typeof envelope.mac!=='string'||!/^[a-f0-9]{64}$/.test(envelope.mac)||!timingSafeEqual(Buffer.from(envelope.mac,'hex'),Buffer.from(mac(envelope.payload,key),'hex')))throw Error('MAC');
  const answer=JSON.parse(Buffer.from(envelope.payload,'base64url').toString('utf8'));
  if(answer.v!==1||answer.nonce!==nonce||!/^OCCURRENCE_[A-Z_]+$/.test(answer.code)||now()>issuedAt+60000)throw Error('REPLY');
  remoteFinished=true;
  return result(answer.code,answer.code==='OCCURRENCE_SCORE_ACCEPTED'?200:409,origin);
 }catch{return result('OCCURRENCE_SCORE_UNAVAILABLE',503,origin);}finally{
  clearTimeout(timer);
  // An aborted remote operation may still be running: retain its slot until
  // the existing Durable Object expiry. Otherwise release it immediately.
  if(!controller.signal.aborted&&(!remoteStarted||remoteFinished)&&admission?.allowed===true&&typeof admission.release==='function')await admission.release().catch(()=>{});
 }
}
