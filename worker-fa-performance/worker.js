import {verifyTrainingIdentity} from '../worker-training/google-auth.js';
import {createServiceTokenProvider} from './service-token.js';
import {createFaPerformanceStore} from './store.js';
import {Buffer} from 'node:buffer';
const PROJECT='sahmt-17a16',ORIGIN='https://anestesiahmtforms.github.io',runtimes=new WeakMap();
function store(env){if(!runtimes.has(env)){let credentials;try{credentials=JSON.parse(env.FA_PERFORMANCE_SERVICE_ACCOUNT_JSON);}catch{throw Error('FA_CONFIG_REQUIRED');}if(credentials.client_email!=='fa-performance-reader@'+PROJECT+'.iam.gserviceaccount.com')throw Error('FA_READER_IDENTITY_INVALID');runtimes.set(env,createFaPerformanceStore({getAccessToken:createServiceTokenProvider({credentials})}));}return runtimes.get(env);}
export function createFaPerformanceWorker({verifyIdentity=verifyTrainingIdentity,getStore=store}={}){return {async fetch(request,env){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',...(request.headers.get('Origin')===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN}:{})},reply=(body,status)=>Response.json(body,{status,headers});
 if(request.headers.get('Origin')!==ORIGIN)return reply({code:'FA_ORIGIN_DENIED'},403);
 if(new URL(request.url).pathname!=='/v1/fa-performance')return reply({code:'FA_ROUTE_UNKNOWN'},404);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
 if(request.method!=='POST')return reply({code:'FA_METHOD_DENIED'},405);
 if(env.FA_PERFORMANCE_ENABLED!=='true')return reply({code:'FA_PERFORMANCE_DISABLED'},503);
 try{
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return reply({code:'FA_INPUT_INVALID'},400);
  const reader=request.body?.getReader();if(!reader)return reply({code:'FA_INPUT_INVALID'},400);const chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2048)return reply({code:'FA_INPUT_TOO_LARGE'},413);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply({code:'FA_INPUT_INVALID'},400);}
  if(!body||Object.keys(body).sort().join()!=='action,input'||body.action!=='GET_PERFORMANCE'||!body.input||Object.keys(body.input).join()!=='subjectUid'||!/^[A-Za-z0-9_-]{1,200}$/.test(body.input.subjectUid))return reply({code:'FA_INPUT_INVALID'},400);
  const identity=await verifyIdentity(request.headers.get('Authorization'),{apiKey:env.FA_WEB_API_KEY,projectId:PROJECT}),db=getStore(env);
  const admin=p=>p?.uid===identity.uid&&p.email?.toLowerCase()===identity.email&&p.active===true&&p.access===true&&(p.role==='administrador_app'||p.permissions?.admin===true);
  if(!admin(await db.get('users',identity.uid)))return reply({code:'FA_PERFORMANCE_FORBIDDEN'},403);
  const runtime=await db.get('faPerformanceRuntime','current');
  if(runtime?.enabled!==true||runtime.projectId!==PROJECT||runtime.schemaVersion!==1||runtime.mode!=='FA_ONLY'||runtime.automaticExternalSync!==false||!Number.isFinite(Date.parse(runtime.effectiveFrom))||Date.now()<Date.parse(runtime.effectiveFrom))return reply({code:'FA_PERFORMANCE_PENDING'},503);
  const ref=await db.get('faPerformanceReference','team');if(ref?.status!=='CONFIRMED'||!Number.isSafeInteger(ref.revision))return reply({code:'FA_PERFORMANCE_PENDING'},503);
  const uid=body.input.subjectUid,[summary,team,awards,ledger]=await Promise.all([db.get('faPerformanceSummaries',uid),db.list('faPerformanceSummaries'),db.list('faPerformanceAwards',uid),db.list('faPerformanceLedger',uid)]);
  if(summary?.revision!==ref.revision||team.filter(p=>p.revision===ref.revision).length!==ref.eligibleCount&&Number.isInteger(ref.eligibleCount))return reply({code:'FA_PERFORMANCE_PENDING'},503);
  const fresh=await db.get('users',identity.uid),reference=await db.get('faPerformanceReference','team'),active=await db.get('faPerformanceRuntime','current');
  if(!admin(fresh))return reply({code:'FA_PERFORMANCE_FORBIDDEN'},403);
  if(reference?.status!=='CONFIRMED'||reference.revision!==ref.revision||active?.enabled!==true||active.mode!==runtime.mode||active.projectId!==PROJECT||active.effectiveFrom!==runtime.effectiveFrom)return reply({code:'FA_PERFORMANCE_PENDING'},503);
  return reply({summary,team:team.filter(p=>p.revision===ref.revision),awards:awards.filter(a=>a.revision===ref.revision),ledger,reference:ref,effectiveFrom:runtime.effectiveFrom,sourceProjectId:PROJECT},200);
 }catch(e){return reply({code:'FA_PERFORMANCE_UNAVAILABLE'},e?.status===401?401:503);}
 }};}
export default createFaPerformanceWorker();
