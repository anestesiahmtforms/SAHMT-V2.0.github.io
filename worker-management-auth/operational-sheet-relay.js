import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const FA = 'sahmt-17a16';
const PREFIX = `projects/${FA}/databases/(default)/documents/`;
const TYPES = new Set(['events', 'labels', 'checklists']);
const CODE = /^CONTROLE_[A-Z_]+$/;
const result = (code, status, origin) => new Response(JSON.stringify({code}), {
  status, headers: {'Content-Type':'application/json', 'Cache-Control':'no-store',
    ...(origin ? {'Access-Control-Allow-Origin':origin, Vary:'Origin'} : {})}
});
async function jsonLimited(message, maxBytes) {
  const reader=message.body?.getReader(); if(!reader)throw Error('EMPTY');
  const chunks=[];let size=0;
  try { for(;;) { const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;if(size>maxBytes)throw Error('LARGE');chunks.push(value);
  } } finally { await reader.cancel().catch(()=>{}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const mac=(payload,secret)=>createHmac('sha256',secret).update('SAHMT_SHEET_V1\n'+payload).digest('hex');

/** One authenticated Firestore GET per notification. No scan, timer, admin token or retry. */
export async function relayOperationalSheet(request, env, {fetchImpl=fetch, now=Date.now}={}) {
  const origin=request.headers.get('Origin');
  const allowed=['https://anestesiahmtforms.github.io'];
  if(env.OPERATIONAL_SHEETS_PILOT_ORIGIN)allowed.push(env.OPERATIONAL_SHEETS_PILOT_ORIGIN);
  if(!allowed.includes(origin))return result('CONTROLE_ORIGEM_RECUSADA',403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
    'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST',
    'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'3600',Vary:'Origin'}});
  if(request.method!=='POST')return result('CONTROLE_METODO_RECUSADO',405,origin);
  if(env.OPERATIONAL_SHEETS_ENABLED!=='true')return result('CONTROLE_ENVIO_DESATIVADO',503,origin);
  const secret=env.OPERATIONAL_SHEETS_HMAC_SECRET;
  const endpoint=env.OPERATIONAL_SHEETS_SCRIPT_URL;
  if(typeof secret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(secret)||
    typeof endpoint!=='string'||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(endpoint))
    return result('CONTROLE_CONFIGURACAO_AUSENTE',503,origin);
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9_.-]{100,16000}$/.test(authorization))return result('CONTROLE_SESSAO_RECUSADA',401,origin);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),55000);
  try {
    const input=await jsonLimited(request,1024);
    if(!input||Object.keys(input).sort().join(',')!=='collection,id'||!TYPES.has(input.collection)||
      typeof input.id!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(input.id))return result('CONTROLE_RECURSO_INVALIDO',400,origin);
    // Firebase validates the user's ID token and applies existing Security Rules.
    // An admin OAuth token is deliberately never substituted here.
    const name=PREFIX+input.collection+'/'+input.id;
    const response=await fetchImpl('https://firestore.googleapis.com/v1/'+name,{method:'GET',
      headers:{Authorization:authorization,Accept:'application/json'},cache:'no-store',redirect:'error',signal:controller.signal});
    if(response.status!==200) {
      await response.body?.cancel().catch(()=>{});
      return result(response.status===404?'CONTROLE_REGISTRO_AUSENTE':
        [401,403].includes(response.status)?'CONTROLE_LEITURA_RECUSADA':'CONTROLE_ORIGEM_INDISPONIVEL',
        [401,403,404].includes(response.status)?response.status:503,origin);
    }
    const document=await jsonLimited(response,32768);
    if(document.name!==name||!document.fields||!document.updateTime)throw Error('DOCUMENT_INVALID');
    // Only the author can announce the creation. Claims are inspected only after
    // Firestore has accepted this exact bearer token and resource read.
    const claims=JSON.parse(Buffer.from(authorization.slice(7).split('.')[1],'base64url').toString('utf8'));
    if(claims.aud!==FA||claims.iss!==`https://securetoken.google.com/${FA}`||
      typeof claims.sub!=='string'||document.fields.createdByUid?.stringValue!==claims.sub)
      return result('CONTROLE_AUTOR_RECUSADO',403,origin);
    const nonce=randomBytes(16).toString('hex'),issuedAt=now();
    const payload=Buffer.from(JSON.stringify({v:1,aud:'sahmt-operational-sheet',nonce,issuedAt,
      expiresAt:issuedAt+60000,document})).toString('base64url');
    let reply=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({payload,mac:mac(payload,secret)}),redirect:'manual',signal:controller.signal});
    if([302,303].includes(reply.status)) {
      const location=new URL(reply.headers.get('Location'));
      if(location.protocol!=='https:'||location.hostname!=='script.googleusercontent.com'||location.port||location.username||
        location.password||location.hash||location.pathname!=='/macros/echo'||!location.searchParams.get('user_content_key')||
        [...location.searchParams.keys()].some(k=>!['user_content_key','lib'].includes(k))||
        new Set(location.searchParams.keys()).size!==[...location.searchParams.keys()].length||location.href.length>8192)throw Error('REDIRECT');
      await reply.body?.cancel().catch(()=>{});
      reply=await fetchImpl(location.href,{method:'GET',redirect:'error',signal:controller.signal});
    }
    if(reply.status!==200)throw Error('HTTP');
    const envelope=await jsonLimited(reply,4096);
    if(typeof envelope.payload!=='string'||envelope.payload.length>2048||!/^[A-Za-z0-9_-]+$/.test(envelope.payload)||
      typeof envelope.mac!=='string'||! /^[a-f0-9]{64}$/.test(envelope.mac)||
      !timingSafeEqual(Buffer.from(envelope.mac,'hex'),Buffer.from(mac(envelope.payload,secret),'hex')))throw Error('HMAC');
    const body=JSON.parse(Buffer.from(envelope.payload,'base64url').toString('utf8'));
    if(body.v!==1||body.nonce!==nonce||!CODE.test(body.code)||now()>issuedAt+60000)throw Error('REPLY');
    return result(body.code,['CONTROLE_REGISTRO_RECEBIDO','CONTROLE_REGISTRO_JA_RECEBIDO'].includes(body.code)?200:409,origin);
  } catch {return result('CONTROLE_ENVIO_INDISPONIVEL',503,origin);}
  finally {clearTimeout(timer);}
}
