import {createServiceTokenProvider,verifyTrainingIdentity} from '../worker-training/google-auth.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {Buffer} from 'node:buffer';
const PROJECT='sahmt-gestao-5ae66',ORIGIN='https://anestesiahmtforms.github.io';
const runtimes=new WeakMap();
function store(env){
 if(!runtimes.has(env)){
  let credentials;try{credentials=JSON.parse(env.FB_PERFORMANCE_SERVICE_ACCOUNT_JSON);}catch{throw Error('FB_PERFORMANCE_CONFIG_REQUIRED');}
  if(credentials.client_email!=='fb-performance-reader@'+PROJECT+'.iam.gserviceaccount.com')throw Error('FB_PERFORMANCE_IDENTITY_INVALID');
  runtimes.set(env,createFirestoreStore({projectId:PROJECT,getAccessToken:createServiceTokenProvider({credentials})}));
 }
 return runtimes.get(env);
}
export default {async fetch(request,env){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',...(request.headers.get('Origin')===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN}:{})};
 const reply=(value,status)=>Response.json(value,{status,headers});
 if(request.headers.get('Origin')!==ORIGIN)return reply({code:'FB_PERFORMANCE_ORIGIN_DENIED'},403);
 if(new URL(request.url).pathname!=='/v1/fb-performance')return reply({code:'FB_PERFORMANCE_ROUTE_UNKNOWN'},404);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
 if(request.method!=='POST')return reply({code:'FB_PERFORMANCE_METHOD_DENIED'},405);
 if(env.FB_PERFORMANCE_ENABLED!=='true')return reply({code:'FB_PERFORMANCE_DISABLED'},503);
 try{
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return reply({code:'FB_PERFORMANCE_INPUT_INVALID'},400);
  const reader=request.body?.getReader();if(!reader)return reply({code:'FB_PERFORMANCE_INPUT_INVALID'},400);
  const chunks=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2048)return reply({code:'FB_PERFORMANCE_INPUT_TOO_LARGE'},413);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!body||Object.keys(body).sort().join()!=='action,input'||body.action!=='GET_PERFORMANCE'||!body.input||Object.keys(body.input).sort().join()!=='subjectUid'||!/^[A-Za-z0-9_-]{1,200}$/.test(body.input.subjectUid))return reply({code:'FB_PERFORMANCE_INPUT_INVALID'},400);
  const identity=await verifyTrainingIdentity(request.headers.get('Authorization'),{apiKey:env.FB_WEB_API_KEY,projectId:PROJECT});
  const db=store(env),profile=await db.get('users',identity.uid),subject=body.input.subjectUid;
  if(profile?.uid!==identity.uid||profile.email?.toLowerCase()!==identity.email||profile.active!==true||profile.access!==true)return reply({code:'FB_PERFORMANCE_FORBIDDEN'},403);
  const canInspect=p=>(p?.role==='administrador_app'||p?.permissions?.admin===true)&&p?.permissions?.managementManage===true;
  if(subject!==identity.uid&&!canInspect(profile))return reply({code:'FB_PERFORMANCE_FORBIDDEN'},403);
  const runtime=await db.get('fbPerformanceRuntime','current');
  if(runtime?.enabled!==true||runtime.projectId!==PROJECT||runtime.schemaVersion!==1||runtime.mode!=='FB_ONLY'||!Number.isFinite(Date.parse(runtime.effectiveFrom))||Date.now()<Date.parse(runtime.effectiveFrom))return reply({code:'FB_PERFORMANCE_PREPARING'},503);
  const reference=await db.get('fbPerformanceReference','team'),revision=reference?.revision;
  if(!Number.isSafeInteger(revision)||reference.status!=='CONFIRMED')return reply({code:'FB_PERFORMANCE_PENDING'},503);
  const collection=(suffix)=>'fbPerformance'+suffix;
  const [summary,allAwards,allLedger]=await Promise.all([db.get(collection('Summaries'),subject),db.list(collection('Awards'),[{field:'uid',op:'EQUAL',value:subject}],999),db.list(collection('Ledger'),[{field:'uid',op:'EQUAL',value:subject}],999)]);
  if(summary?.revision!==revision)return reply({code:'FB_PERFORMANCE_PENDING'},503);
  const awards=allAwards.filter(a=>a.revision===revision),ledger=allLedger.filter(l=>l.revision===revision).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const fresh=await db.get('users',identity.uid),ref=await db.get('fbPerformanceReference','team'),active=await db.get('fbPerformanceRuntime','current');
  if(fresh?.uid!==identity.uid||fresh.email?.toLowerCase()!==identity.email||fresh.active!==true||fresh.access!==true||subject!==identity.uid&&!canInspect(fresh)||ref?.revision!==revision||ref?.status!=='CONFIRMED'||active?.enabled!==true||active?.mode!==runtime.mode||active?.projectId!==PROJECT||active?.effectiveFrom!==runtime.effectiveFrom)return reply({code:'FB_PERFORMANCE_PENDING'},503);
  return reply({summary:{uid:subject,status:'CONFIRMED',performanceTotal:summary.total,performanceRevision:revision},reference:{performanceStatus:'CONFIRMED',performanceRevision:revision,maxPerformance:reference.maxPerformance,eligibleCount:reference.eligibleCount},awards,ledger,fromCache:false,pendingWrites:false,complete:true,sourceProjectId:PROJECT},200);
 }catch(error){return reply({code:'FB_PERFORMANCE_UNAVAILABLE'},error?.status===401?401:503);}
}};
