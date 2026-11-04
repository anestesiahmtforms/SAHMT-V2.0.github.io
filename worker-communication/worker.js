import {FF,fail} from '../communication/domain.js';
import {verifyPair,serviceToken,assertFreeProject,boundedJson} from './google.js';
import {createStore} from './store.js';
import {createCommunicationService} from './service.js';
import {COMMUNICATION_LIMITS} from '../src/communication-usage.js';
const ORIGIN='https://anestesiahmtforms.github.io';
function limitedFetch(){let calls=0;return (url,options)=>{if(++calls>COMMUNICATION_LIMITS.externalCalls)throw fail('COMM_OPERATION_WORK_LIMIT',429);return fetch(url,options);};}
async function runtime(env,fetchImpl,buildService){
 if(buildService)return buildService(env);
 const getToken=serviceToken(JSON.parse(env.FF_SERVICE_ACCOUNT_JSON||'null'),fetchImpl);
 await assertFreeProject(getToken,fetchImpl);
 const store=createStore({getToken,fetchImpl}),fa=createStore({getToken,fetchImpl,source:'FA'}),fb=createStore({getToken,fetchImpl,source:'FB'});
 const recipientEnabled=async device=>{
  for(const [project,uid]of [['sahmt-17a16',device.sourceUid],[FF.projectId,device.uid]]){
   const r=await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+await getToken(),'Content-Type':'application/json'},body:JSON.stringify({localId:[uid]})});
   const d=await boundedJson(r,32768);if(!r.ok)throw fail('COMM_SERVICE_UNAVAILABLE',503);
   const u=d.users?.[0];if(!(d.users?.length===1&&u.localId===uid&&!u.disabled&&u.emailVerified===true&&u.email?.toLowerCase()===device.email&&u.providerUserInfo?.some(p=>p.providerId==='google.com'&&p.rawId===device.googleUid)))return false;
  }
  return true;
 };
 const send=async(token,data)=>{
  const r=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${FF.projectId}/messages:send`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+await getToken(),'Content-Type':'application/json'},body:JSON.stringify({message:{token,data:{...data,source:'SAHMT_FF'},webpush:{headers:{TTL:'3600',Urgency:'normal'}}}})});
  const d=await boundedJson(r,16384),code=d.error?.details?.find(x=>x['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode;
  if(r.ok&&typeof d.name==='string')return {status:'accepted',providerId:d.name};
  if(code==='UNREGISTERED')return {status:'failed',disable:true,reason:'UNREGISTERED'};
  return {status:'failed',reason:r.status===429?'PROVIDER_QUOTA':code==='SENDER_ID_MISMATCH'?'SENDER_ID_MISMATCH':'PROVIDER_REJECTED'};
 };
 const sources=Object.fromEntries(['FC','FD','FE'].map(source=>[source,createStore({getToken,fetchImpl,source})]));
 return createCommunicationService({store,fa,fb,sources,send,recipientEnabled,pushQueue:env.COMMUNICATION_PUSH_QUEUE});
}
export function createCommunicationWorker({verify=verifyPair,buildService}={}){
 return {
  async fetch(request,env){
   const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
   const json=(body,status=200)=>Response.json(body,{status,headers});
   if(request.headers.get('Origin')!==ORIGIN)return json({code:'COMM_ORIGIN_DENIED'},403);
   Object.assign(headers,{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Authorization, Content-Type, X-SAHMT-FA-Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'});
   if(new URL(request.url).pathname!=='/v1/communication')return json({code:'COMM_NOT_FOUND'},404);
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   if(request.method!=='POST')return json({code:'COMM_METHOD_DENIED'},405);
   if(env.COMMUNICATION_ENABLED!=='true'||env.WORKERS_FREE_CONFIRMED!=='true')return json({code:'COMM_CONFIG_REQUIRED'},503);
   try{
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw fail('COMM_INVALID_INPUT');
    if(Number(request.headers.get('Content-Length'))>16384)throw fail('COMM_BODY_LIMIT',413);
    let body;try{body=await boundedJson(request,16384);}catch(e){throw e.code==='COMM_RESPONSE_LIMIT'?fail('COMM_BODY_LIMIT',413):fail('COMM_INVALID_INPUT');}
    if(!body||typeof body.action!=='string'||Object.keys(body).some(k=>!['action','input'].includes(k)))throw fail('COMM_INVALID_INPUT');
    const fetchImpl=limitedFetch(),actor=await verify(request,{fetchImpl}),service=await runtime(env,fetchImpl,buildService);
    return json(await service.execute(body.action,body.input||{},actor));
   }catch(e){const code=/^COMM_[A-Z_]+$/.test(e.code||'')?e.code:'COMM_SERVICE_UNAVAILABLE',details=Object.fromEntries(['used','limit','resetsAt'].filter(key=>Number.isSafeInteger(e[key])&&e[key]>=0).map(key=>[key,e[key]]));return json({code,...details},[400,401,403,409,413,429,503].includes(e.status)?e.status:503);}
  },
  async queue(batch,env){
   if(env.COMMUNICATION_ENABLED!=='true'||env.WORKERS_FREE_CONFIRMED!=='true'){for(const message of batch.messages)message.retry({delaySeconds:30});return;}
   try{
    const service=await runtime(env,limitedFetch(),buildService);
    for(const message of batch.messages){try{await service.consumePush(message.body);message.ack();}catch{message.retry({delaySeconds:30});}}
   }catch{for(const message of batch.messages)message.retry({delaySeconds:30});}
  }
 };
}
export default createCommunicationWorker();
