import {FF,fail,adminIdentity} from '../communication/domain.js';
import {verifyCommunicationActor,serviceToken,assertFreeProject,boundedJson} from './google.js';
import {createStore} from './store.js';
import {createCommunicationService} from './service.js';
import {COMMUNICATION_LIMITS} from '../src/communication-usage.js';
import {createActivitySource} from './activity-source.js';
import {createCommunicationHistoryDrive} from './history-drive.js';
import {createCommunicationHistory} from './history-service.js';
import {checklistConferenceWindow} from './checklist-conference-schedule.js';
const ORIGIN='https://anestesiahmtforms.github.io';
function limitedFetch(action){let calls=0;return (url,options)=>{
 const target=new URL(url),path=decodeURIComponent(target.pathname);
 if(target.hostname==='firestore.googleapis.com'){
  const ff=path.startsWith(`/v1/projects/${FF.projectId}/databases/${FF.databaseId}`);
  const fa=action==='SCHEDULE_RELEASE_NOTICE'&&(options?.method||'GET')==='GET'&&/^\/v1\/projects\/sahmt-17a16\/databases\/\(default\)\/documents\/users\/[^/]+$/.test(path);
  const fjRead=['SCHEDULE_RELEASE_NOTICE','CHECKLIST_CONFERENCE_AUTO'].includes(action)&&(options?.method||'GET')==='GET'&&/^\/v1\/projects\/sahmt-escala-fj\/databases\/\(default\)\/documents\/(?:scheduleDays\/[^/]+|runtimePolicy\/folders)$/.test(path);
  let fjChecklist=false;
  if(action==='CHECKLIST_CONFERENCE_AUTO'&&path==='/v1/projects/sahmt-escala-fj/databases/(default)/documents:runQuery'&&(options?.method||'GET')==='POST'){
   try{
    const query=JSON.parse(options.body||'{}').structuredQuery,filters=query?.where?.compositeFilter?.filters||[];
    const expected=new Set(['active:EQUAL','start:LESS_THAN_OR_EQUAL','end:GREATER_THAN_OR_EQUAL']);
    fjChecklist=query?.from?.length===1&&query.from[0].collectionId==='vacations'&&query.limit===101&&filters.length===3&&filters.every(item=>{
     const filter=item.fieldFilter;return filter&&expected.delete(`${filter.field?.fieldPath}:${filter.op}`)&&
      (filter.field.fieldPath==='active'?filter.value?.booleanValue===true:typeof filter.value?.stringValue==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(filter.value.stringValue));
    })&&expected.size===0;
   }catch{}
  }
  const fj=fjRead||fjChecklist;
  if(!ff&&!fa&&!fj)throw fail('COMM_SOURCE_DENIED',403);
 }
 if(target.hostname==='identitytoolkit.googleapis.com'&&path.includes('/projects/')&&!path.startsWith(`/v1/projects/${FF.projectId}/`))throw fail('COMM_SOURCE_DENIED',403);
 if(++calls>COMMUNICATION_LIMITS.externalCalls)throw fail('COMM_OPERATION_WORK_LIMIT',429);return fetch(url,options);
};}
export function resolveScheduleSourceProject(env={}){
 const project=env.SCHEDULE_SOURCE_PROJECT||'FJ';
 if(project!=='FJ')throw fail('COMM_CONFIG_REQUIRED',503);
 return project;
}
async function runtime(env,fetchImpl,buildService,actor,headers,{scheduled=false}={}){
 if(buildService)return buildService(env);
 const credentials=JSON.parse(env.FF_SERVICE_ACCOUNT_JSON||'null');
 const getToken=serviceToken(credentials,fetchImpl);
 await assertFreeProject(getToken,fetchImpl);
 const administrator=scheduled||adminIdentity(actor)&&actor.email==='wx2064@gmail.com';
 const store=createStore({getToken,fetchImpl,administrator}),fa=createStore({getToken,fetchImpl,source:'FA'});
 const scheduleSource=createStore({getToken,fetchImpl,source:resolveScheduleSourceProject(env),administrator});
 const recipientEnabled=async device=>{
  for(const [project,uid]of [[FF.projectId,device.uid]]){
   const r=await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+await getToken(),'Content-Type':'application/json'},body:JSON.stringify({localId:[uid]})});
   const d=await boundedJson(r,32768);if(!r.ok)throw fail('COMM_SERVICE_UNAVAILABLE',503);
   const u=d.users?.[0];if(!(d.users?.length===1&&u.localId===uid&&!u.disabled&&u.emailVerified===true&&u.email?.toLowerCase()===device.email&&u.providerUserInfo?.some(p=>p.providerId==='google.com'&&p.rawId===device.googleUid)))return false;
  }
  return true;
 };
 const send=async(token,data)=>{
  await store.assertAvailable();
  const r=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${FF.projectId}/messages:send`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+await getToken(),'Content-Type':'application/json'},body:JSON.stringify({message:{token,data:{...data,source:'SAHMT_FF'},webpush:{headers:{TTL:'3600',Urgency:'high'}}}})});
  if(r.status===429||r.status>=500){
   const retryAfter=r.headers.get('Retry-After')||'';
   const seconds=/^\d+$/.test(retryAfter)?Number(retryAfter):Math.ceil((Date.parse(retryAfter)-Date.now())/1000);
   await r.body?.cancel().catch(()=>{});
   return {status:'failed',reason:r.status===429?'PROVIDER_QUOTA':'PROVIDER_UNAVAILABLE',retryDelaySeconds:Math.min(3600,Math.max(r.status===429?60:30,Number.isFinite(seconds)?seconds:0))};
  }
  const d=await boundedJson(r,16384),code=d.error?.details?.find(x=>x['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode;
  if(r.ok&&typeof d.name==='string')return {status:'accepted',providerId:d.name};
  if(code==='UNREGISTERED')return {status:'failed',disable:true,reason:'UNREGISTERED'};
  return {status:'failed',reason:r.status===429?'PROVIDER_QUOTA':code==='SENDER_ID_MISMATCH'?'SENDER_ID_MISMATCH':'PROVIDER_REJECTED'};
 };
 const pushQueue=env.COMMUNICATION_PUSH_QUEUE;
 const historyDrive=env.FF_HISTORY_SPREADSHEET_ID?createCommunicationHistoryDrive({
  getToken:serviceToken(credentials,fetchImpl,{history:true}),fetchImpl,spreadsheetId:env.FF_HISTORY_SPREADSHEET_ID
 }):null;
 const history=historyDrive?createCommunicationHistory({store,drive:historyDrive,pushQueue}):null;
 const activitySource=history&&actor?createActivitySource({fetchImpl,headers,actor,professionalInFc:env.FC_PROFESSIONAL_REGISTRATION_ENABLED==='true'}):null;
 const service=createCommunicationService({store,fa,scheduleSource,send,recipientEnabled,pushQueue,history,historyDrive,activitySource});
 return {
  async execute(...args){await store.assertAvailable();const result=await service.execute(...args);await store.assertAvailable();return result;},
  async consumePush(...args){await store.assertAvailable();return service.consumePush(...args);},
  async recoverHistory(){
   if(!history)return;
   await store.assertAvailable();
   let verified=false;
   let code='';
   let archiveApi='';
   let archiveHttpStatus=0;
   try{await historyDrive.verify();verified=true;}
   catch(error){code=error.code||'COMM_HISTORY_UNAVAILABLE';archiveApi=error.archiveApi||'';archiveHttpStatus=error.archiveHttpStatus||0;}
   await store.transaction(tx=>tx.set('communicationHistoryHealth','2026',{verified,code,archiveApi,archiveHttpStatus,checkedAt:Date.now()}));
   if(verified){
    const presentation=await store.get('communicationHistoryPresentation','2026');
    if(presentation?.format!=='dd/mm/yyyy'){
     const result=await historyDrive.formatExistingDates();
     await store.transaction(tx=>tx.set('communicationHistoryPresentation','2026',{format:'dd/mm/yyyy',changed:result.changed,verifiedAt:Date.now()}));
     return;
    }
    await history.recover();
   }
  },
  async sendChecklistConference(day){return service.sendChecklistConference(day);}
 };
}
export function createCommunicationWorker({verify=verifyCommunicationActor,buildService}={}){
 return {
  async fetch(request,env){
   const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
   const json=(body,status=200)=>Response.json(body,{status,headers});
   if(request.headers.get('Origin')!==ORIGIN)return json({code:'COMM_ORIGIN_DENIED'},403);
   Object.assign(headers,{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Authorization, Content-Type, X-SAHMT-FA-Authorization, X-SAHMT-FB-Authorization, X-SAHMT-FC-Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'});
   if(new URL(request.url).pathname!=='/v1/communication')return json({code:'COMM_NOT_FOUND'},404);
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   if(request.method!=='POST')return json({code:'COMM_METHOD_DENIED'},405);
   if(env.COMMUNICATION_ENABLED!=='true'||env.WORKERS_FREE_CONFIRMED!=='true')return json({code:'COMM_CONFIG_REQUIRED'},503);
   try{
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw fail('COMM_INVALID_INPUT');
    if(Number(request.headers.get('Content-Length'))>16384)throw fail('COMM_BODY_LIMIT',413);
    let body;try{body=await boundedJson(request,16384);}catch(e){throw e.code==='COMM_RESPONSE_LIMIT'?fail('COMM_BODY_LIMIT',413):fail('COMM_INVALID_INPUT');}
    if(!body||typeof body.action!=='string'||Object.keys(body).some(k=>!['action','input'].includes(k)))throw fail('COMM_INVALID_INPUT');
    const fetchImpl=limitedFetch(body.action),actor=await verify(request,{fetchImpl,action:body.action}),service=await runtime(env,fetchImpl,buildService,actor,request.headers);
    return json(await service.execute(body.action,body.input||{},actor));
   }catch(e){const code=/^COMM_[A-Z_]+$/.test(e.code||'')?e.code:'COMM_SERVICE_UNAVAILABLE',details=Object.fromEntries(['used','limit','resetsAt'].filter(key=>Number.isSafeInteger(e[key])&&e[key]>=0).map(key=>[key,e[key]]));return json({code,...details},[400,401,403,404,409,413,429,503].includes(e.status)?e.status:503);}
  },
  async queue(batch,env){
   if(env.COMMUNICATION_ENABLED!=='true'||env.WORKERS_FREE_CONFIRMED!=='true'){for(const message of batch.messages)message.retry({delaySeconds:30});return;}
   try{
    const service=await runtime(env,limitedFetch(),buildService);
    for(const message of batch.messages){try{await service.consumePush(message.body,{lastAttempt:message.attempts>=6});message.ack();}
     catch(error){message.retry({delaySeconds:error.retryDelaySeconds||30});}}
   }catch{for(const message of batch.messages)message.retry({delaySeconds:30});}
  },
  async scheduled(event,env){
   if(env.COMMUNICATION_ENABLED!=='true'||env.WORKERS_FREE_CONFIRMED!=='true')return;
   const timestamp=Number(event?.scheduledTime)||Date.now(),day=checklistConferenceWindow(timestamp);
   const service=await runtime(env,limitedFetch(day?'CHECKLIST_CONFERENCE_AUTO':'SCHEDULE_RELEASE_NOTICE'),buildService,undefined,undefined,{scheduled:true});
   const tasks=[];
   if(env.FF_HISTORY_SPREADSHEET_ID)tasks.push(service.recoverHistory());
   if(day)tasks.push(service.sendChecklistConference(day));
   const results=await Promise.allSettled(tasks),failed=results.find(result=>result.status==='rejected');
   if(failed)throw failed.reason;
  }
 };
}
export default createCommunicationWorker();
