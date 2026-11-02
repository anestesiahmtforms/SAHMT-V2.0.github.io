import {verifyTrainingIdentity} from '../worker-training/google-auth.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {createVacationSheets,vacationServiceToken} from './google.js';
import {createVacationService} from './service.js';
const runtimes=new WeakMap();
function runtime(env){
 if(!runtimes.has(env)){
  const getAccessToken=vacationServiceToken({credentials:JSON.parse(env.FE_SERVICE_ACCOUNT_JSON)});
  runtimes.set(env,createVacationService({store:createFirestoreStore({projectId:'outros-48120',getAccessToken}),sheets:createVacationSheets({getAccessToken})}));
 }
 return runtimes.get(env);
}
export function createVacationWorker({verifyIdentity=verifyTrainingIdentity,buildService=runtime}={}){
 return {async fetch(request,env){
  const origin=request.headers.get('Origin'),allowed=origin==='https://anestesiahmtforms.github.io',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',...(allowed?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(data,status)=>Response.json(data,{status,headers});
  if(!allowed)return reply({code:'VACATIONS_FORBIDDEN'},403);
  if(new URL(request.url).pathname!=='/v1/vacations-2027')return reply({code:'VACATIONS_ROUTE_UNKNOWN'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
  if(request.method!=='POST')return reply({code:'VACATIONS_METHOD_DENIED'},405);
  try{
   if(env.VACATIONS_ENABLED!=='true')throw Error();
   if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return reply({code:'VACATIONS_INPUT_INVALID'},400);
   const reader=request.body?.getReader(),parts=[];let size=0;
   if(!reader)return reply({code:'VACATIONS_INPUT_INVALID'},400);
   try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4096)return reply({code:'VACATIONS_INPUT_INVALID'},413);parts.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
   let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return reply({code:'VACATIONS_INPUT_INVALID'},400);}
   if(!body||Array.isArray(body)||Object.keys(body).length!==2||typeof body.action!=='string'||!body.input||typeof body.input!=='object'||Array.isArray(body.input))return reply({code:'VACATIONS_INPUT_INVALID'},400);
   const identity=await verifyIdentity(request.headers.get('Authorization'),{apiKey:env.FA_WEB_API_KEY,projectId:'sahmt-17a16'});
   return reply(await buildService(env).execute(body.action,body.input,identity),200);
  }catch(error){const code=/^VACATIONS_[A-Z_]+$/.test(error?.code||'')?error.code:'VACATIONS_UNAVAILABLE';return reply({code},[400,401,403,404,409,413,422,429,503].includes(error?.status)?error.status:503);}
 }};
}
export default createVacationWorker();
