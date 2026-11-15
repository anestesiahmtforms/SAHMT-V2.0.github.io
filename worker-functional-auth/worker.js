const MAX_BODY = 20000;
const PERFORMANCE_CRON = '50 2 * * SUN';
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');

function cors(origin, env) {
  const headers = {'Cache-Control':'no-store', 'Vary':'Origin'};
  if (origin === env.FK_AUTH_ORIGIN) Object.assign(headers, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  });
  return headers;
}

async function signedEnvelope(payload, secret, now = Date.now(), nonce = crypto.randomUUID()) {
  const timestamp = String(now), body = JSON.stringify(payload);
  const message = new TextEncoder().encode(`${timestamp}\n${nonce}\n${body}`);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, message));
  return JSON.stringify({timestamp, nonce, payload:body, signature});
}

export function createFunctionalAuthWorker({fetchImpl = fetch, clock = Date.now} = {}) {
  return Object.freeze({async scheduled(event, env) {
    if (event.cron !== PERFORMANCE_CRON) return;
    const body=await signedEnvelope({action:'SYNC_TEAM_PERFORMANCE'},env.FK_HMAC_SECRET,clock());
    const response=await fetchImpl(env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body,redirect:'follow',signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error('FK_PERFORMANCE_SYNC_UNAVAILABLE');
    const result=await response.json();
    if(!['FK_PERFORMANCE_SYNCED','FK_PERFORMANCE_ALREADY_CURRENT'].includes(result.code))
      throw Error(/^FK_[A-Z_]+$/.test(result.code||'')?result.code:'FK_PERFORMANCE_SYNC_UNAVAILABLE');
  },async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, env || {});
    const url = new URL(request.url);
    const route = url.pathname;
    if (!['/v1/functional/refresh','/v1/functional/survey','/v1/functional/team-overview','/v1/functional/dosimetry'].includes(route)) return Response.json({code:'NOT_FOUND'}, {status:404,headers});
    if (request.method === 'OPTIONS') return new Response(null, {status:origin === env.FK_AUTH_ORIGIN ? 204 : 403,headers});
    if (request.method !== 'POST' || origin !== env.FK_AUTH_ORIGIN) return Response.json({code:'REQUEST_REJECTED'}, {status:403,headers});
    if (!env.APPS_SCRIPT_URL || !env.FK_HMAC_SECRET || env.FK_HMAC_SECRET.length < 32)
      return Response.json({code:'SERVICE_UNAVAILABLE'}, {status:503,headers});
    const bodyLimit=route==='/v1/functional/dosimetry'?200000:MAX_BODY;
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > bodyLimit) return Response.json({code:'REQUEST_TOO_LARGE'}, {status:413,headers});
    let input;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > bodyLimit) return Response.json({code:'REQUEST_TOO_LARGE'}, {status:413,headers});
      input = JSON.parse(raw);
    } catch { return Response.json({code:'REQUEST_INVALID'}, {status:400,headers}); }
    const validToken = typeof input?.faIdToken === 'string' && input.faIdToken.length >= 100 && input.faIdToken.length <= 10000 && !/[\s\x00-\x1f]/.test(input.faIdToken);
    if(route==='/v1/functional/dosimetry'){
      if(!input||Object.keys(input).length!==2||!Object.hasOwn(input,'input')||!validToken||
         !input.input||typeof input.input!=='object'||Array.isArray(input.input))return Response.json({code:'REQUEST_INVALID'},{status:400,headers});
      try{
        const batch=['PREVIEW_IMPORT','IMPORT'].includes(input.input.operation);
        if(!batch&&input.input.operation!=='GET')return Response.json({code:'REQUEST_INVALID'},{status:400,headers});
        const payload={action:batch?'FUNCTIONAL_DOSIMETRY_IMPORT':'FUNCTIONAL_DOSIMETRY',faIdToken:input.faIdToken,input:input.input};input.faIdToken='';
        const body=await signedEnvelope(payload,env.FK_HMAC_SECRET,clock());payload.faIdToken='';
        const response=await fetchImpl(env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body,redirect:'follow',signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw Error();const text=await response.text();if(text.length>200000)throw Error();const result=JSON.parse(text);
        const errors={FK_AUTH_DENIED:403,FK_TEAM_MEMBER_DENIED:403,FK_DOSIMETRY_INPUT_INVALID:400,FK_DOSIMETRY_CONFLICT:409,FK_DOSIMETRY_BINDING_REQUIRED:400,FK_DOSIMETRY_FOLDER_DISABLED:403};
        if(Object.hasOwn(errors,result.code))return Response.json({code:result.code},{status:errors[result.code],headers});
        if(batch){
          if(result.year!==input.input.year)throw Error();
          if(input.input.operation==='PREVIEW_IMPORT'&&result.code==='FK_DOSIMETRY_IMPORT_PREVIEW'&&Array.isArray(result.rows)&&result.rows.length<=100&&Array.isArray(result.members))return Response.json(result,{headers});
          if(input.input.operation==='IMPORT'&&result.code==='FK_DOSIMETRY_IMPORTED'&&Number.isSafeInteger(result.updated)&&Number.isSafeInteger(result.unchanged))return Response.json(result,{headers});
          throw Error();
        }
        if(!['FK_DOSIMETRY_READY','FK_DOSIMETRY_SAVED'].includes(result.code)||result.uid!==input.input.subjectUid||result.year!==input.input.year||
          result.record!==null&&(result.record?.uid!==result.uid||result.record?.year!==result.year||!Array.isArray(result.record.values)||result.record.values.length!==12))throw Error();
        return Response.json({uid:result.uid,year:result.year,record:result.record},{headers});
      }catch{return Response.json({code:'FK_DOSIMETRY_UNAVAILABLE'},{status:503,headers});}
    }
    if (route === '/v1/functional/survey') {
      const keys=['faIdToken','action','survey','cycle','response'];
      if (!input || Object.keys(input).length!==keys.length || keys.some(key=>!Object.hasOwn(input,key))
        || !validToken || input.action!=='SUBMIT' || !['climate','stress','epidemiological'].includes(input.survey)
        || input.cycle!=='2026' || !input.response || typeof input.response!=='object' || Array.isArray(input.response))
        return Response.json({code:'REQUEST_INVALID'}, {status:400,headers});
      try {
        const payload={action:'FUNCTIONAL_SURVEY_SUBMIT',faIdToken:input.faIdToken,survey:input.survey,
          cycle:input.cycle,response:input.response};
        input.faIdToken='';
        const body=await signedEnvelope(payload,env.FK_HMAC_SECRET,clock());
        payload.faIdToken='';
        const response=await fetchImpl(env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},
          body,redirect:'follow',signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error('UPSTREAM_REJECTED');
        const text=await response.text();if(text.length>16000)throw new Error('UPSTREAM_RESPONSE_INVALID');
        const result=JSON.parse(text);
        if(result.code==='FK_SURVEY_SAVED'&&typeof result.uid==='string'&&result.survey===input.survey
          &&typeof result.alreadyResponded==='boolean')
          return Response.json({status:'READY',uid:result.uid,accepted:true,alreadyResponded:result.alreadyResponded},{status:200,headers});
        if(result.code==='FK_AUTH_DENIED'||result.code==='FK_SURVEY_ACCESS_DENIED')
          return Response.json({code:'FK_SURVEY_ACCESS_DENIED'},{status:403,headers});
        if(result.code==='FK_SURVEY_INPUT_INVALID')
          return Response.json({code:'FK_SURVEY_INPUT_INVALID'},{status:400,headers});
        throw new Error('SURVEY_UPSTREAM_UNAVAILABLE');
      } catch {
        return Response.json({code:'FK_SURVEY_UNAVAILABLE'},{status:503,headers});
      }
    }
    if (route === '/v1/functional/team-overview') {
      const subjectUid = input?.subjectUid;
      if (!input || Object.keys(input).length !== 2 || !validToken ||
          typeof subjectUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(subjectUid))
        return Response.json({code:'REQUEST_INVALID'}, {status:400,headers});
      try {
        const body = await signedEnvelope({action:'READ_TEAM_OVERVIEW',faIdToken:input.faIdToken,subjectUid},env.FK_HMAC_SECRET,clock());
        input.faIdToken = '';
        const response = await fetchImpl(env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body,redirect:'follow',signal:AbortSignal.timeout(30000)});
        if (!response.ok) throw new Error('UPSTREAM_REJECTED');
        const text = await response.text();
        if (text.length > 500000) throw new Error('UPSTREAM_RESPONSE_INVALID');
        const result = JSON.parse(text);
        if (['FK_AUTH_DENIED','FK_TEAM_MEMBER_DENIED'].includes(result.code))
          return Response.json({code:'FK_TEAM_ACCESS_DENIED'}, {status:403,headers});
        if (result.code !== 'FK_TEAM_OVERVIEW' || result.uid !== subjectUid ||
            (result.snapshot !== null && result.snapshot?.uid !== subjectUid))
          throw new Error('UPSTREAM_RESPONSE_INVALID');
        return Response.json({uid:subjectUid,snapshot:result.snapshot,recognition:typeof result.recognition === 'string' ? result.recognition : null,performance:result.performance?.uid===subjectUid?result.performance:null},{status:200,headers});
      } catch {
        return Response.json({code:'FK_TEAM_OVERVIEW_UNAVAILABLE'},{status:503,headers});
      }
    }
    if (route === '/v1/functional/refresh') {
      if (!input || Object.keys(input).length !== 1 || !validToken) return Response.json({code:'REQUEST_INVALID'}, {status:400,headers});
      try {
        const body = await signedEnvelope({action:'SYNC_OVERVIEW',faIdToken:input.faIdToken},env.FK_HMAC_SECRET,clock());
        input.faIdToken = '';
        const response = await fetchImpl(env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body,redirect:'follow',signal:AbortSignal.timeout(45000)});
        if (!response.ok) throw new Error('UPSTREAM_REJECTED');
        const text = await response.text();
        if (text.length > 500000) throw new Error('UPSTREAM_RESPONSE_INVALID');
        const result = JSON.parse(text);
        if (result.code !== 'FK_SNAPSHOT_SAVED' || typeof result.uid !== 'string' || result.snapshot?.uid !== result.uid)
          return Response.json({code:'SYNC_UNAVAILABLE'}, {status:503,headers});
        return Response.json({schemaVersion:1,uid:result.uid,snapshot:result.snapshot},{status:200,headers});
      } catch { return Response.json({code:'SYNC_UNAVAILABLE'}, {status:503,headers}); }
    }
    return Response.json({code:'NOT_FOUND'}, {status:404,headers});
  }});
}

export default createFunctionalAuthWorker();
