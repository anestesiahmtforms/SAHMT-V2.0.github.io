import {validateContinuityProfile,CONTINUITY_MAX_BODY_BYTES,CONTINUITY_KINDS} from './remote-continuity-contract.js';
import {validChannelEndpoint} from './provisional-channel-client.js';
import {CHANNEL_COLLECTIONS,validDay,validId,channelDay} from './provisional-channel-contract.js';
const fail=(code,status)=>{throw Object.assign(Error(code),{code,httpStatus:status});};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
function validateEntry(entry,now){
 if(!entry||![...CONTINUITY_KINDS,'offlineOperational'].includes(entry.kind)||typeof entry.id!=='string'||! /^[A-Za-z0-9_:.-]{1,240}$/.test(entry.id)||!Number.isSafeInteger(entry.verifiedAt)||entry.verifiedAt>now||entry.data===null||typeof entry.data!=='object'||JSON.stringify(entry.data).length>180000)fail('CONTINUITY_RESPONSE_INVALID');
 return entry;
}
function operationForLocal(op,uid,now){
 if(!op||op.uid!==uid||!CHANNEL_COLLECTIONS.includes(op.collection)||!validId(op.requestId)||!validDay(op.day)||!op.data||typeof op.data!=='object'||Array.isArray(op.data)||!Number.isSafeInteger(op.createdAt)||op.createdAt<=0||op.createdAt>now+60000)fail('CONTINUITY_RECOVERY_INVALID');
 if(op.collection==='scheduleReleases'){
  if(op.data.day!==op.day||typeof op.data.sigla!=='string'||! /^[A-Z0-9]{1,20}$/.test(op.data.sigla))fail('CONTINUITY_RECOVERY_INVALID');
  return {uid,type:op.collection,requestId:`schedule-release::${uid}::${op.day}::${op.data.sigla}`,resourceId:op.day+':'+op.data.sigla,payload:op.data,createdAt:op.createdAt};
 }
 if(op.data.date!==op.day)fail('CONTINUITY_RECOVERY_INVALID');
 return {uid,type:op.collection,requestId:op.requestId,resourceId:op.requestId,payload:{collectionName:op.collection,data:op.data},createdAt:op.createdAt};
}
export function createRemoteContinuityClient({endpoint='',fetchImpl=fetch,now=Date.now,getCurrentUser=()=>null,online=()=>globalThis.navigator?.onLine!==false,
 cacheProfile,writeCache,listOperations,enqueue,updateOperation,saveReceipt,isCommitted=async()=>false,getAppCheckHeaders=async()=>({}),timeoutMs=8000}={}){
 const flights=new Map(),previous=new Map(),retryAt=new Map(),denied=new Set();
 const enabled=validChannelEndpoint(endpoint);
 const isCurrent=(user,check)=>getCurrentUser()?.uid===user.uid&&check();
 async function request(user,body,check){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Object.assign(Error('CONTINUITY_TIMEOUT'),{code:'CONTINUITY_TIMEOUT'})),{once:true}))]);
  try{
   const token=await bounded(user.getIdToken());if(!isCurrent(user,check))fail('CONTINUITY_SESSION_CHANGED');
   const appCheckHeaders=await bounded(getAppCheckHeaders());if(!isCurrent(user,check))fail('CONTINUITY_SESSION_CHANGED');
   const response=await bounded(fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...appCheckHeaders},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal}));
   const reader=response.body?.getReader();if(!reader)fail('CONTINUITY_RESPONSE_INVALID');
   const chunks=[];let size=0;
   try{for(;;){const {done,value}=await bounded(reader.read());if(done)break;size+=value.length;if(size>CONTINUITY_MAX_BODY_BYTES)fail('CONTINUITY_RESPONSE_TOO_LARGE');chunks.push(value);}}
   finally{await reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('CONTINUITY_RESPONSE_INVALID');}
   if(!isCurrent(user,check))fail('CONTINUITY_SESSION_CHANGED');
   if(!response.ok)fail(/^(?:CHANNEL|CONTINUITY)_[A-Z_]+$/.test(result?.code||'')?result.code:'CONTINUITY_UNAVAILABLE',response.status);
   return result;
  }finally{clearTimeout(timer);}
 }
 async function hydrate(user,first,day,check){
  if(first.code!=='CONTINUITY_READY'||!Array.isArray(first.entries)||first.entries.length>250||!Array.isArray(first.operations)||!Number.isSafeInteger(first.authorizedUntil)||first.authorizedUntil<=now())fail('CONTINUITY_RESPONSE_INVALID');
  const profile=validateContinuityProfile({schemaVersion:1,uid:user.uid,verifiedAt:first.profileVerifiedAt,profile:first.profile},now());
  if(profile.uid!==user.uid)fail('CONTINUITY_RESPONSE_INVALID');
  const entries=first.entries.map(entry=>validateEntry(entry,now()));
  const remote=[...first.operations];let cursor=first.nextCursor,pages=0;
  const seenCursors=new Set();
  while(cursor){
   if(typeof cursor!=='string'||seenCursors.has(cursor)||pages++>=49)fail('CONTINUITY_RECOVERY_INCOMPLETE');seenCursors.add(cursor);
   const page=await request(user,{action:'recover',day,after:cursor},check);if(page.code!=='CONTINUITY_RECOVERY'||!Array.isArray(page.operations))fail('CONTINUITY_RESPONSE_INVALID');
   remote.push(...page.operations);if(remote.length>2000)fail('CONTINUITY_RECOVERY_INCOMPLETE');cursor=page.nextCursor;
  }
  const operations=remote.map(op=>({remote:op,local:operationForLocal(op,user.uid,now())}));
  if(!isCurrent(user,check))fail('CONTINUITY_SESSION_CHANGED');
  await cacheProfile(user.uid,profile.profile,{validatedAt:profile.verifiedAt});
  for(const entry of entries){if(!isCurrent(user,check))fail('CONTINUITY_SESSION_CHANGED');await writeCache(user.uid,entry.kind,entry.id,entry.data,{validatedAt:entry.verifiedAt});}
  const existing=[...await listOperations(user.uid)];let restored=0,confirmed=0;
  for(const {remote:op,local} of operations){
   if(!isCurrent(user,check))fail('CONTINUITY_SESSION_CHANGED');
   const saveCommittedReceipt=()=>saveReceipt(user.uid,op.requestId,{collection:op.collection,day:op.day,localRequestId:local.requestId,occurredAt:op.data.occurredAt||null,shared:true,attempted:true,state:'pending',committed:true,remoteContinuity:true});
   if(await isCommitted(user.uid,local.requestId,local.payload)){await saveCommittedReceipt();confirmed++;continue;}
   const prior=existing.find(item=>item.requestId===local.requestId);
   if(prior&&canonical(prior.payload)!==canonical(local.payload)){
    await updateOperation(user.uid,local.requestId,{status:'conflict',lastErrorCode:'CONTINUITY_LOCAL_CONFLICT',lastError:'A cópia local e o recibo remoto divergem; ambos foram preservados.'});continue;
   }
   if(!prior){await enqueue(local);if(await isCommitted(user.uid,local.requestId,local.payload)){await saveCommittedReceipt();confirmed++;continue;}existing.push(local);restored++;}
   if(op.state==='conflict')await updateOperation(user.uid,local.requestId,{status:'conflict',lastErrorCode:'CONTINUITY_SERVER_CONFLICT',lastError:'O registro remoto foi preservado e exige revisão de conflito.'});
   await saveReceipt(user.uid,op.requestId,{collection:op.collection,day:op.day,localRequestId:local.requestId,occurredAt:op.data.occurredAt||null,shared:true,attempted:true,state:op.state==='conflict'?'conflict':'pending',remoteContinuity:true});
  }
  if(!isCurrent(user,check))fail('CONTINUITY_SESSION_CHANGED');
  return {profile:profile.profile,profileVerifiedAt:profile.verifiedAt,authorizedUntil:first.authorizedUntil,restored,confirmed,entries:entries.length};
 }
 async function bootstrap(user,{day=channelDay(now()),isCurrent:check=()=>true,force=false}={}){
  if(!enabled||!online())return null;if(!validId(user?.uid)||typeof user.getIdToken!=='function'||!validDay(day)||!isCurrent(user,check))fail('CONTINUITY_SESSION_CHANGED');
  const key=user.uid+':'+day;
  if(flights.has(key))return flights.get(key);
  if(now()<(retryAt.get(user.uid)||0))fail(denied.has(user.uid)?'CONTINUITY_ACCESS_DENIED':'CONTINUITY_BACKOFF');
  const cached=previous.get(key);if(!force&&cached&&now()-cached.at<60000&&cached.result.authorizedUntil>now())return cached.result;
  const task=(async()=>{
   try{const result=await hydrate(user,await request(user,{action:'bootstrap',day},check),day,check);denied.delete(user.uid);previous.set(key,{at:now(),result});return result;}
   catch(error){if(error.code!=='CONTINUITY_SESSION_CHANGED')retryAt.set(user.uid,now()+60000);if(error.code==='CONTINUITY_ACCESS_DENIED'||[401,403].includes(error.httpStatus))denied.add(user.uid);if(denied.has(user.uid))fail('CONTINUITY_ACCESS_DENIED');throw error;}
   finally{flights.delete(key);}
  })();flights.set(key,task);return task;
 }
 return {enabled,bootstrap,reset(uid){for(const key of previous.keys())if(key.startsWith(uid+':'))previous.delete(key);}};
}
