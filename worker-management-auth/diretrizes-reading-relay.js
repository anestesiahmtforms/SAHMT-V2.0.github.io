import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',MAX_REPLY=16*1024*1024;
const mac=(payload,key)=>createHmac('sha256',key).update('SAHMT_READING_V1\n'+payload).digest('hex');
const reply=(code,status,origin,data={})=>Response.json({code,...data},{status,headers:{'Cache-Control':'no-store',...(origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})}});
async function limited(response,max,signal){
 const reader=response.body?.getReader();if(!reader)throw Error('EMPTY');
 const chunks=[];let size=0;const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal.aborted)throw Error('TIMEOUT');const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('SIZE');chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
function redirectTarget(raw){
 const u=new URL(raw);if(u.protocol!=='https:'||u.hostname!=='script.googleusercontent.com'||u.port||u.username||u.password||u.hash||u.pathname!=='/macros/echo'||
  !u.searchParams.get('user_content_key')||u.href.length>8192||[...u.searchParams.keys()].some(k=>!['lib','user_content_key'].includes(k))||new Set(u.searchParams.keys()).size!==[...u.searchParams.keys()].length)throw Error('REDIRECT');return u.href;
}
/** Firebase checks token authenticity; HMAC carries only the verified identity. Never log request/response bodies. */
export async function relayDiretrizesReading(request,env,{fetchImpl=fetch,now=Date.now,admitRequest}={}){
 const origin=request.headers.get('Origin'),allowed=['https://anestesiahmtforms.github.io',env?.DIRETRIZES_READING_PILOT_ORIGIN].filter(Boolean);
 if(!allowed.includes(origin))return reply('READING_ORIGIN_DENIED',403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type',Vary:'Origin'}});
 if(request.method!=='POST')return reply('READING_METHOD_DENIED',405,origin);
 if(env?.DIRETRIZES_READING_ENABLED!=='true')return reply('READING_DISABLED',503,origin);
 const project=env.DIRETRIZES_READING_PROJECT_ID||FA;
 if(![FA,FB].includes(project))return reply('READING_CONFIG_MISSING',503,origin);
 const key=env.DIRETRIZES_READING_HMAC_SECRET,url=env.DIRETRIZES_READING_SCRIPT_URL,
  apiKey=project===FB?env.DIRETRIZES_READING_FB_API_KEY:env.DIRETRIZES_READING_FA_API_KEY;
 if(!/^[A-Za-z0-9_-]{43}$/.test(key||'')||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(url||'')||typeof apiKey!=='string'||!apiKey||typeof admitRequest!=='function')return reply('READING_CONFIG_MISSING',503,origin);
 const bearer=request.headers.get('Authorization')||'';if(!/^Bearer [A-Za-z0-9_.-]{100,16000}$/.test(bearer))return reply('READING_IDENTITY_DENIED',401,origin);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);let slot,remoteStarted=false,remoteFinished=false,stage='ADMISSION';
 try{
  slot=await admitRequest({origin,route:'/v1/diretrizes/reading',method:'POST'},{signal:controller.signal});
  if(slot?.allowed!==true||typeof slot.release!=='function')return reply('READING_BUSY',429,origin);
  stage='INPUT';const input=await limited(request,4096,controller.signal),keys=Object.keys(input||{}).sort().join(',');
  if(!['open','start','progress','complete'].includes(input?.action)||!/^[A-Za-z0-9_-]{1,200}$/.test(input.documentId||'')||
   (['open','start'].includes(input.action)?
     !(keys==='action,documentId'||input.action==='start'&&keys==='action,documentId,openTicket'&&typeof input.openTicket==='string'&&input.openTicket.length<=2500&&/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(input.openTicket)):
     keys!=='action,documentId,pages,sessionId'||!/^[a-f0-9]{32}$/.test(input.sessionId||'')||!Array.isArray(input.pages)||input.pages.length>300||input.pages.some(p=>!Number.isSafeInteger(p)||p<1||p>300)))return reply('READING_INPUT_INVALID',400,origin);
  stage='IDENTITY';const token=bearer.slice(7),claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  if(claims.aud!==project||claims.iss!==`https://securetoken.google.com/${project}`||typeof claims.sub!=='string'||!/^[^/\s]{1,128}$/.test(claims.sub)||
   claims.email_verified!==true||typeof claims.email!=='string'||claims.exp*1000<=now()||!Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.auth_time)||claims.firebase?.sign_in_provider!=='google.com')return reply('READING_IDENTITY_DENIED',401,origin);
  // Workerd accepts only manual/follow. Manual also prevents forwarding credentials on redirects.
  stage='IDENTITY_LOOKUP';const lookup=await fetchImpl('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),redirect:'manual',signal:controller.signal});
  if(lookup.status!==200){await lookup.body?.cancel().catch(()=>{});return reply('READING_IDENTITY_DENIED',401,origin);}
  stage='IDENTITY_RESPONSE';const account=(await limited(lookup,32768,controller.signal)).users;
  const user=Array.isArray(account)&&account.length===1?account[0]:null;
  if(!user||user.localId!==claims.sub||user.disabled===true||user.emailVerified!==true||user.email?.toLowerCase()!==claims.email.toLowerCase()||
   !Array.isArray(user.providerUserInfo)||!user.providerUserInfo.some(p=>p.providerId==='google.com')||!Number.isFinite(Number(user.validSince||0))||Number(user.validSince||0)>claims.auth_time)return reply('READING_IDENTITY_DENIED',401,origin);
  const nonce=randomBytes(16).toString('hex'),issuedAt=now();
  const payload=Buffer.from(JSON.stringify({...input,v:1,aud:'sahmt-diretrizes-reading',nonce,issuedAt,expiresAt:issuedAt+60000,uid:claims.sub,email:claims.email.toLowerCase()})).toString('base64url');
  remoteStarted=true;stage='UPSTREAM';
  let response=await fetchImpl(url+'?action=diretrizes-reading-v1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,mac:mac(payload,key)}),redirect:'manual',signal:controller.signal});
  if([302,303].includes(response.status)){const target=redirectTarget(response.headers.get('Location'));await response.body?.cancel().catch(()=>{});response=await fetchImpl(target,{method:'GET',redirect:'manual',signal:controller.signal});}
  if(response.status!==200)throw Error('HTTP');stage='ENVELOPE';const envelope=await limited(response,MAX_REPLY,controller.signal);
  if(typeof envelope.payload!=='string'||envelope.payload.length>MAX_REPLY||!/^[A-Za-z0-9_-]+$/.test(envelope.payload)||! /^[a-f0-9]{64}$/.test(envelope.mac||'')||!timingSafeEqual(Buffer.from(envelope.mac,'hex'),Buffer.from(mac(envelope.payload,key),'hex')))throw Error('MAC');
  stage='REPLY';const answer=JSON.parse(Buffer.from(envelope.payload,'base64url').toString('utf8'));if(answer.v!==1||answer.nonce!==nonce||!/^READING_[A-Z_]+$/.test(answer.code||'')||now()>issuedAt+60000)throw Error('REPLY');
  remoteFinished=true;
  // Project only protocol fields: never relay arbitrary private response keys.
  const data={};for(const k of ['pages','sessionId','pdfBase64','visited','formUrl','hasForm','openTicket'])if(answer[k]!==undefined)data[k]=answer[k];
  const validPages=Number.isSafeInteger(data.pages)&&data.pages>=1&&data.pages<=300;
  const validPdf=typeof data.pdfBase64==='string'&&data.pdfBase64.length<=4*Math.ceil(8*1024*1024/3)&&/^JVBER[A-Za-z0-9+/=]*$/.test(data.pdfBase64);
  if(answer.code==='READING_PREPARED'&&(input.action!=='open'||!validPages||!validPdf||typeof data.openTicket!=='string'||data.openTicket.length>2500||!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(data.openTicket)))throw Error('PDF');
  if(answer.code==='READING_STARTED'&&(input.action!=='start'||!validPages||!/^[a-f0-9]{32}$/.test(data.sessionId||'')||(!input.openTicket&&!validPdf)||(input.openTicket&&data.pdfBase64!==undefined)))throw Error('PDF');
  if(answer.code==='READING_COMPLETED' && data.formUrl!==undefined)throw Error('URL');
  if(answer.code==='READING_RELEASED'&&!/^https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(data.formUrl||''))throw Error('URL');
  return reply(answer.code,['READING_PREPARED','READING_STARTED','READING_PROGRESS_SAVED','READING_RELEASED','READING_COMPLETED'].includes(answer.code)?200:409,origin,data);
 }catch{return reply(controller.signal.aborted?'READING_TIMEOUT':'READING_RELAY_'+stage+'_FAILED',503,origin);}finally{
  clearTimeout(timer);if(!controller.signal.aborted&&(!remoteStarted||remoteFinished)&&slot?.allowed===true)await slot.release().catch(()=>{});
 }
}
