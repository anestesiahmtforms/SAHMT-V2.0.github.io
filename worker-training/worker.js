import {createServiceTokenProvider,verifyTrainingIdentity} from './google-auth.js';
import {createFirestoreStore} from './firestore.js';
import {createHtmlTrainingService} from './service.js';

const origins=['https://anestesiahmtforms.github.io'];
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
async function bodyJson(request,max){
 const length=Number(request.headers.get('Content-Length'));if(length>max)throw fail('TRAINING_INPUT_TOO_LARGE',413);
 const reader=request.body?.getReader();if(!reader)throw fail('TRAINING_INPUT_INVALID',400);
 let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw fail('TRAINING_INPUT_TOO_LARGE',413);chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('TRAINING_INPUT_INVALID',400);}
}
const runtimes=new WeakMap();
function buildRuntime(env){
 if(!runtimes.has(env)){
  let credentials;try{credentials=JSON.parse(env.FB_TRAINING_SERVICE_ACCOUNT_JSON);}catch{throw fail('TRAINING_SERVICE_CONFIG_INVALID',503);}
  const getAccessToken=createServiceTokenProvider({credentials});
  const store=createFirestoreStore({getAccessToken});
  runtimes.set(env,createHtmlTrainingService({store,now:Date.now,uuid:()=>crypto.randomUUID()}));
 }
 return runtimes.get(env);
}
export function createTrainingWorker({verifyIdentity=verifyTrainingIdentity,buildService=buildRuntime}={}){
 return {async fetch(request,env={},context){
  const origin=request.headers.get('Origin');
  const allowed=origins.includes(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',...(allowed?{'Access-Control-Allow-Origin':origin}: {})};
  const reply=(data,status)=>new Response(JSON.stringify(data),{status,headers});
  if(!allowed)return reply({code:'TRAINING_ORIGIN_DENIED'},403);
  if(new URL(request.url).pathname!=='/v1/training')return reply({code:'TRAINING_ROUTE_UNKNOWN'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
  if(request.method!=='POST')return reply({code:'TRAINING_METHOD_DENIED'},405);
  if(env.HTML_TRAINING_ENABLED!=='true')return reply({code:'TRAINING_UNAVAILABLE'},503);
  try{
   if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))throw fail('TRAINING_INPUT_INVALID',400);
   const body=await bodyJson(request,8*1024*1024);
   if(!body||Object.keys(body).length!==2||typeof body.action!=='string'||!body.input||Array.isArray(body.input)||typeof body.input!=='object'||!Object.hasOwn(body,'input'))throw fail('TRAINING_INPUT_INVALID',400);
   const identity=await verifyIdentity(request.headers.get('Authorization'),{apiKey:env.FB_WEB_API_KEY});
   const result=await buildService(env).execute(body.action,body.input,identity);
   return reply(result,200);
  }catch(error){
   const safe=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,100}$/.test(error.code)?error.code:'TRAINING_UNAVAILABLE';
   return reply({code:safe},[400,401,403,404,409,413,422,429,503].includes(error?.status)?error.status:503);
  }
 }};
}
export default createTrainingWorker();
