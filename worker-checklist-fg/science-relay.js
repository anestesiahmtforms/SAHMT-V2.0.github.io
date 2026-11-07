import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {boundedJson,verifyFaSession} from '../worker-operational-domain/identity.js';
import {isValidDateKey} from '../src/schedule-date.js';

function sign(payload,secret){
  return createHmac('sha256',secret).update('SAHMT_SHEET_V1\n'+payload).digest('hex');
}

export async function callFgScienceWebhook({url,secret,action,day,uid,fetchImpl=fetch}){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,250}\/exec$/.test(url||'')||
      !/^[A-Za-z0-9_-]{43}$/.test(secret||''))throw Error('FG_SCIENCE_CONFIG');
  const nonce=randomBytes(16).toString('hex');
  const payload=Buffer.from(JSON.stringify({v:1,aud:'fg-science',action,day,uid,nonce,issuedAt:Date.now()})).toString('base64url');
  const signal=AbortSignal.timeout(25000);
  let response=await fetchImpl(url+'?action=fg-science-v1',{method:'POST',redirect:'manual',signal,
    headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,mac:sign(payload,secret)})});
  if(response.status===302||response.status===303){
    const location=new URL(response.headers.get('Location'));
    await response.body?.cancel();
    if(location.origin!=='https://script.googleusercontent.com'||location.pathname!=='/macros/echo')throw Error('FG_SCIENCE_REDIRECT');
    response=await fetchImpl(location,{redirect:'error',signal});
  }
  if(!response.ok){await response.body?.cancel();throw Error('FG_SCIENCE_UNAVAILABLE');}
  const reply=await boundedJson(response,4096);
  if(!/^[A-Za-z0-9_-]{1,2048}$/.test(reply.payload||'')||!/^[a-f0-9]{64}$/.test(reply.mac||'')||
      !timingSafeEqual(Buffer.from(sign(reply.payload,secret)),Buffer.from(reply.mac)))throw Error('FG_SCIENCE_REPLY');
  const result=JSON.parse(Buffer.from(reply.payload,'base64url').toString('utf8'));
  if(result.v!==1||result.nonce!==nonce||!/^[A-Z_]{4,40}$/.test(result.code||''))throw Error('FG_SCIENCE_REPLY');
  return result.code;
}

export async function relayFgScience(request,env,{verify=verifyFaSession,relay=callFgScienceWebhook}={}){
  const headers={'Cache-Control':'no-store',Vary:'Origin','X-Content-Type-Options':'nosniff'};
  const json=(code,status)=>Response.json({code},{status,headers});
  const origin=request.headers.get('Origin');
  if(!origin||!String(env.ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).includes(origin))return json('FG_SCIENCE_ORIGIN',403);
  Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return json('FG_SCIENCE_METHOD',405);
  if(env.MODULE_STATION!=='FG'||env.MODULE_PROJECT_ID!=='sahmt-checklist-fg'||env.MODULE_CUTOVER_ACTIVE!=='true')return json('FG_SCIENCE_INACTIVE',503);
  try{
    const body=await boundedJson(request,512);
    if(!body||Object.keys(body).length!==1||!isValidDateKey(body.day))return json('FG_SCIENCE_INPUT',400);
    const actor=await verify(request.headers.get('Authorization'),{apiKey:env.FA_PUBLIC_API_KEY});
    if(!actor.emailVerified)return json('FG_SCIENCE_DENIED',403);
    const code=await relay({url:env.FG_SCIENCE_WEBHOOK_URL,secret:env.FG_SCORING_SHARED_SECRET,action:'settle',day:body.day,uid:actor.uid});
    if(['VALIDATED','DUPLICATE','NEEDS_REVIEW','REJECTED','OUTSIDE_RELEASE'].includes(code))return json(code,200);
    if(code==='FG_WEBHOOK_DENIED')return json('FG_SCIENCE_DENIED',403);
    return json('FG_SCIENCE_RETRY',503);
  }catch(error){return json('FG_SCIENCE_UNAVAILABLE',[400,401,403,413].includes(error.status)?error.status:503);}
}
