import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const FC='indicadores---sahmt',DOMAIN='SAHMT_QMENTUM_PRINT_V1\n';
const mac=(payload,key)=>createHmac('sha256',key).update(DOMAIN+payload).digest('hex');
const reply=(code,status,origin,result)=>Response.json({code,...(result===undefined?{}:{result})},{status,headers:{'Cache-Control':'no-store',...(origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})}});
async function limited(message,max,signal){
 const reader=message.body?.getReader();if(!reader)throw Error('EMPTY');const chunks=[];let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal?.aborted)throw Error('TIMEOUT');const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('LARGE');chunks.push(value);}}finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(k=>allowed.includes(k));
function validInput(input){
 if(!object(input)||!/^[A-Za-z0-9_-]{1,80}$/.test(input.unitId||''))return false;
 if(input.operation==='SCAN')return keys(input,['operation','unitId','year'])&&Number.isInteger(input.year)&&input.year>=2026&&input.year<=2200;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period||'')||input.period<'2026-07'||input.period>'2200-12')return false;
 if(input.operation==='PREVIEW'){
  if(!keys(input,['operation','unitId','period','source','files']))return false;
  if(input.source==='DRIVE')return !Object.hasOwn(input,'files');
  return input.source==='UPLOAD'&&Array.isArray(input.files)&&input.files.length===2&&new Set(input.files.map(f=>f?.kind)).size===2&&input.files.every(f=>keys(f,['kind','name','mimeType','base64'])&&['TECHNIQUES','INDICATORS'].includes(f.kind)&&typeof f.name==='string'&&f.name.length<=200&&['image/png','image/jpeg'].includes(f.mimeType)&&typeof f.base64==='string'&&f.base64.length>0&&f.base64.length<=2796204&&/^[A-Za-z0-9+/]+={0,2}$/.test(f.base64));
 }
 return input.operation==='APPLY'&&keys(input,['operation','unitId','period','previewId','baseVersion','corrections','resolutions'])&&/^[a-f0-9]{64}$/.test(input.previewId||'')&&Number.isSafeInteger(input.baseVersion)&&input.baseVersion>=0&&object(input.corrections)&&Object.keys(input.corrections).length<=20&&object(input.resolutions)&&Object.keys(input.resolutions).length<=20;
}
/** FC's own grant read authenticates the bearer; the signed FC backend checks
 * current profile, manager, unit, source snapshot and CAS before every apply. */
export async function relayQmentumPrints(request,env,{fetchImpl=fetch,now=Date.now,admitRequest}={}){
 const origin=request.headers.get('Origin');if(!['https://anestesiahmtforms.github.io',env.QMENTUM_PILOT_ORIGIN].filter(Boolean).includes(origin))return reply('QMENTUM_PRINT_ORIGIN_DENIED',403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type',Vary:'Origin'}});
 if(request.method!=='POST')return reply('QMENTUM_PRINT_METHOD_DENIED',405,origin);
 if(env.QMENTUM_WRITE_ENABLED!=='true')return reply('QMENTUM_PRINT_DISABLED',503,origin);
 const key=env.OPERATIONAL_SHEETS_HMAC_SECRET,url=env.FC_MODULE_SCRIPT_URL;
 if(!/^[A-Za-z0-9_-]{43}$/.test(key||'')||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(url||''))return reply('QMENTUM_PRINT_CONFIG_REQUIRED',503,origin);
 const authorization=request.headers.get('Authorization')||'';if(!/^Bearer [A-Za-z0-9_.-]{100,16000}$/.test(authorization))return reply('QMENTUM_PRINT_SESSION_INVALID',401,origin);
 if(typeof admitRequest!=='function')return reply('QMENTUM_PRINT_ADMISSION_UNAVAILABLE',503,origin);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);let admission,started=false,finished=false;
 try{
  admission=await admitRequest({origin,route:'/v1/qmentum/prints',method:'POST'},{signal:controller.signal});if(admission?.allowed!==true||typeof admission.release!=='function')return reply('QMENTUM_PRINT_BUSY',429,origin);
  let input;try{input=await limited(request,6000000,controller.signal);}catch{return reply('QMENTUM_PRINT_INPUT_INVALID',400,origin);}if(!validInput(input))return reply('QMENTUM_PRINT_INPUT_INVALID',400,origin);
  let claims;try{claims=JSON.parse(Buffer.from(authorization.slice(7).split('.')[1],'base64url').toString('utf8'));}catch{return reply('QMENTUM_PRINT_SESSION_INVALID',401,origin);}
  if(claims.aud!==FC||claims.iss!=='https://securetoken.google.com/'+FC||!/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub||''))return reply('QMENTUM_PRINT_SESSION_INVALID',401,origin);
  const name='projects/'+FC+'/databases/(default)/documents/qmentumAccess/'+claims.sub;
  const proof=await fetchImpl('https://firestore.googleapis.com/v1/'+name,{method:'GET',headers:{Authorization:authorization},redirect:'error',cache:'no-store',signal:controller.signal});
  if(proof.status!==200){await proof.body?.cancel().catch(()=>{});return reply('QMENTUM_PRINT_PERMISSION_DENIED',[401,403,404].includes(proof.status)?403:503,origin);}
  const grant=await limited(proof,8000,controller.signal);if(grant.name!==name||grant.fields?.uid?.stringValue!==claims.sub||grant.fields?.role?.stringValue!=='manager'||grant.fields?.active?.booleanValue!==true||!grant.fields?.units?.arrayValue?.values?.some(v=>v.stringValue===input.unitId))return reply('QMENTUM_PRINT_PERMISSION_DENIED',403,origin);
  const issuedAt=now(),nonce=randomBytes(16).toString('hex'),payload=Buffer.from(JSON.stringify({v:1,aud:'sahmt-qmentum-prints',uid:claims.sub,nonce,issuedAt,expiresAt:issuedAt+60000,request:input})).toString('base64url');
  started=true;let response=await fetchImpl(url+'?action=qmentum-prints-v1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,mac:mac(payload,key)}),redirect:'manual',signal:controller.signal});
  if([302,303].includes(response.status)){
   const redirect=new URL(response.headers.get('Location'));if(redirect.protocol!=='https:'||redirect.hostname!=='script.googleusercontent.com'||redirect.pathname!=='/macros/echo'||redirect.port||redirect.username||redirect.password||redirect.hash||!redirect.searchParams.get('user_content_key')||redirect.href.length>8192||[...redirect.searchParams.keys()].some(k=>!['user_content_key','lib'].includes(k))||new Set(redirect.searchParams.keys()).size!==[...redirect.searchParams.keys()].length)throw Error('REDIRECT');
   await response.body?.cancel().catch(()=>{});response=await fetchImpl(redirect.href,{method:'GET',redirect:'error',signal:controller.signal});
  }
  if(response.status!==200)throw Error('HTTP');const envelope=await limited(response,512000,controller.signal);
  if(typeof envelope.payload!=='string'||envelope.payload.length>450000||!/^[A-Za-z0-9_-]+$/.test(envelope.payload)||! /^[a-f0-9]{64}$/.test(envelope.mac||'')||!timingSafeEqual(Buffer.from(envelope.mac,'hex'),Buffer.from(mac(envelope.payload,key),'hex')))throw Error('MAC');
  const answer=JSON.parse(Buffer.from(envelope.payload,'base64url').toString('utf8'));if(answer.v!==1||answer.nonce!==nonce||!/^QMENTUM_[A-Z_]+$/.test(answer.code||'')||now()>issuedAt+60000)throw Error('REPLY');finished=true;
  const expected={SCAN:'QMENTUM_PRINT_SCAN',PREVIEW:'QMENTUM_PRINT_PREVIEW',APPLY:'QMENTUM_PRINT_APPLIED'}[input.operation];return reply(answer.code,answer.code===expected?200:409,origin,answer.result);
 }catch{return reply('QMENTUM_PRINT_UNAVAILABLE',503,origin);}finally{clearTimeout(timer);if(!controller.signal.aborted&&(!started||finished)&&admission?.allowed===true)await admission.release().catch(()=>{});}
}
