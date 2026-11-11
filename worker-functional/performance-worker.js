import {verifyFunctionalIdentity,functionalServiceToken} from './performance-auth.js';
import {createFirestoreStore} from './performance-store.js';
import {createFunctionalPerformanceService} from './performance-service.js';

const runtimes=new WeakMap();
const json=(body,status,headers)=>Response.json(body,{status,headers});
function runtime(env){
  if(!runtimes.has(env)){
    let credentials;
    try{credentials=JSON.parse(env.FUNCTIONAL_PERFORMANCE_SERVICE_ACCOUNT_JSON);}catch{throw Object.assign(Error('FK_PERFORMANCE_CONFIG_REQUIRED'),{status:503});}
    const getAccessToken=functionalServiceToken({credentials});
    const store=createFirestoreStore({getAccessToken});
    const authorize=async identity=>({uid:identity.uid,active:true,access:true});
    const performance=createFunctionalPerformanceService({store,getAccessToken,authorize,enabled:env.FK_SAHMT_PERFORMANCE_ENABLED==='true'});
    runtimes.set(env,{performance});
  }
  return runtimes.get(env);
}
export function createFunctionalPerformanceWorker({fetchImpl=fetch}={}){
  return {async fetch(request,env){
    const origin=env.FA_ORIGIN||'https://anestesiahmtforms.github.io';
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',...(request.headers.get('Origin')===origin?{'Access-Control-Allow-Origin':origin}:{})};
    const reply=(body,status)=>json(body,status,headers);
    if(request.headers.get('Origin')!==origin)return reply({code:'FK_ORIGIN_DENIED'},403);
    const url=new URL(request.url);
    if(url.pathname!=='/v1/performance')return reply({code:'FK_ROUTE_UNKNOWN'},404);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    if(request.method!=='POST')return reply({code:'FK_METHOD_DENIED'},405);
    if(env.FK_SAHMT_PERFORMANCE_ENABLED!=='true')return reply({code:'SAHMT_PERFORMANCE_PREPARING'},503);
    try{
      if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return reply({code:'FK_INPUT_INVALID'},400);
      const reader=request.body?.getReader();
      if(!reader)return reply({code:'FK_INPUT_INVALID'},400);
      let size=0;const chunks=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)return reply({code:'FK_INPUT_TOO_LARGE'},413);chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({code:'FK_INPUT_INVALID'},400);}
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||typeof body.action!=='string'||!body.input||typeof body.input!=='object'||Array.isArray(body.input))return reply({code:'FK_INPUT_INVALID'},400);
      const identity=await verifyFunctionalIdentity(request.headers.get('Authorization'),{apiKey:env.FK_WEB_API_KEY,fetchImpl});
      const result=await runtime(env).performance.execute(body.action,body.input,identity);
      return reply(result,200);
    }catch(error){
      const status=[400,401,403,409,413,429,503].includes(error?.status)?error.status:503;
      const code=/^(?:FK|SAHMT|FUNCTIONAL)_[A-Z0-9_]{1,90}$/.test(error?.code||error?.message)?error.code||error.message:'FK_PERFORMANCE_UNAVAILABLE';
      return reply({code},status);
    }
  },async scheduled(controller,env,ctx){
    const run=async()=>{
      const performance=runtime(env).performance;
      const scheduledTime=Math.floor(controller.scheduledTime/1000)*1000;
      const envelope={action:'PERFORMANCE',issuedAt:Date.now(),scheduledTime};
      const prepared=await performance.executeScheduled({...envelope,activity:'PREPARE'});
      for(const stage of prepared.stages||[]){
        const result=await performance.executeScheduled({...envelope,activity:stage});
        if(result?.status==='BUSY'||result?.complete===false&&stage==='PREPARE')break;
      }
    };
    if(ctx?.waitUntil)ctx.waitUntil(run());else await run();
  }};
}
export default createFunctionalPerformanceWorker();
