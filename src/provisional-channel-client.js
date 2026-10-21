import {CHANNEL_COLLECTIONS,mergeSharedChannelRecords,validDay} from './provisional-channel-contract.js';
import {updateScheduleReleaseState,updateScheduleReleaseTimes} from './schedule-release.js';
export function validChannelEndpoint(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/v1/operational-channel';}catch{return false;}}
export async function provisionalWireOperation(operation){
  if(!CHANNEL_COLLECTIONS.includes(operation?.type))return null;
  const day=operation.type==='scheduleReleases'?operation.payload?.day:operation.payload?.data?.date;
  if(!validDay(day))return null;
  let requestId=operation.requestId;
  if(operation.type==='scheduleReleases'){
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(operation.requestId+':'+operation.payload.occurredAt));
    requestId=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  return {collection:operation.type,requestId,localRequestId:operation.requestId,createdAt:operation.createdAt,day,
    data:operation.type==='scheduleReleases'?operation.payload:operation.payload.data};
}
export function createProvisionalChannelClient({endpoint='',authSource=null,getSession=()=>null,fetchImpl=fetch,
  now=Date.now,eventTarget=globalThis.window,documentSource=globalThis.document,online=()=>globalThis.navigator?.onLine,onSchedule=()=>{},onStatus=()=>{},
  store,
  outbox,readCache=async()=>null,writeCache=async()=>{},getAppCheckHeaders=async()=>({})}={}){
  const dataByScope=new Map(),flights=new Map(),stops=new Set();let stopped=false,retryAt=0,epoch=0,sessionKey='',grantExpiresAt=0,lastAuthorization='',authorizeRetryAt=0,timer=null;
  const enabled=validChannelEndpoint(endpoint);
  const current=(uid,generation=epoch)=>enabled&&!stopped&&generation===epoch&&authSource?.currentUser?.uid===uid&&getSession()?.status==='signed-in'&&getSession()?.user?.uid===uid&&getSession()?.profile?.active===true&&getSession()?.profile?.access===true;
  const accessKey=()=>{const s=getSession();return JSON.stringify([s?.status,s?.user?.uid,s?.profile?.role,s?.profile?.active,s?.profile?.access,s?.profile?.sigla,s?.profile?.permissions]);};
  const scopeKey=(uid,collection,day)=>JSON.stringify([uid,collection,day]);
  const emit=(collection,day)=>eventTarget.dispatchEvent(new CustomEvent('sahmt-channel-data',{detail:{collection,day}}));
  const single=(key,action)=>{if(flights.has(key))return flights.get(key);const task=Promise.resolve().then(action).finally(()=>{if(flights.get(key)===task)flights.delete(key);});flights.set(key,task);return task;};
  const serial=(key,action)=>{const before=flights.get(key)||Promise.resolve();const task=before.catch(()=>{}).then(action).finally(()=>{if(flights.get(key)===task)flights.delete(key);});flights.set(key,task);return task;};
  const status=(code)=>onStatus({code,enabled,authorizedUntil:grantExpiresAt||null});
  async function request(uid,body){
    const generation=epoch;
    if(!current(uid,generation)||!online()||now()<retryAt)throw Object.assign(Error('CHANNEL_NOT_READY'),{code:'CHANNEL_NOT_READY'});
    const user=authSource.currentUser;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const token=await Promise.race([user.getIdToken(),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('CHANNEL_TIMEOUT')),{once:true}))]);
      if(!current(uid,generation)||authSource.currentUser!==user)throw Error('CHANNEL_SESSION_CHANGED');
      const appCheckHeaders=await Promise.race([getAppCheckHeaders(),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('CHANNEL_TIMEOUT')),{once:true}))]);
      if(!current(uid,generation)||authSource.currentUser!==user)throw Error('CHANNEL_SESSION_CHANGED');
      const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...appCheckHeaders},body:JSON.stringify(body),
        credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
      const reader=response.body?.getReader();if(!reader)throw Error('CHANNEL_RESPONSE_INVALID');const chunks=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288)throw Error('CHANNEL_RESPONSE_TOO_LARGE');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(!current(uid,generation))throw Error('CHANNEL_SESSION_CHANGED');
      if(!response.ok){const code=/^CHANNEL_[A-Z_]+$/.test(value.code||'')?value.code:'CHANNEL_UNAVAILABLE';if(response.status===401||response.status===403){
        grantExpiresAt=0;dataByScope.clear();status(code);
        const deniedCollection=['CHANNEL_READ_DENIED','CHANNEL_WRITE_DENIED'].includes(code);
        if(deniedCollection&&body.collection&&body.day)await writeCache(uid,'provisionalChannel',body.collection+':'+body.day,{records:[],accessKey:accessKey(),expiresAt:0}).catch(()=>{});
        else await writeCache(uid,'provisionalChannel','access',{accessKey:accessKey(),denied:true}).catch(()=>{});
      }
        if([429,503,507].includes(response.status)){retryAt=now()+60000;status(code);}throw Object.assign(Error(code),{code,httpStatus:response.status});}
      return value;
    }finally{clearTimeout(timeout);}
  }
  async function authorize(refresh=false){
    const s=getSession(),uid=s?.user?.uid;
    // Never query Firestore through this endpoint while the FA profile is offline.
    if(!current(uid)||!online()||s.offline)return false;
    return single('authorize:'+uid,async()=>{
      const result=await request(uid,{action:'authorize',refresh});
      if(result.code!=='CHANNEL_AUTHORIZED'||!Number.isSafeInteger(result.expiresAt))throw Error('CHANNEL_RESPONSE_INVALID');
      grantExpiresAt=result.expiresAt;await writeCache(uid,'provisionalChannel','access',{accessKey:accessKey(),denied:false}).catch(()=>{});status('CHANNEL_READY');return true;
    });
  }
  async function share(){
    const uid=getSession()?.user?.uid,generation=epoch;if(!current(uid,generation)||!online())return;
    return single('share:'+uid,async()=>{
      for(const operation of await outbox.list(uid)){
        if(!current(uid,generation)||['failed','conflict'].includes(operation.status))continue;
        const wire=await provisionalWireOperation(operation);if(!wire)continue;
        await serial('mutation:'+uid+':'+wire.requestId,async()=>{
          if(!current(uid,generation))return;
          // Discard / successful commit may have removed this snapshot while it waited.
          const present=(await outbox.list(uid)).find(row=>row.requestId===operation.requestId);
          if(!present||(wire.collection==='scheduleReleases'&&present.payload.occurredAt!==wire.data.occurredAt))return;
          let receipt=(await store.list(uid)).find(row=>row.requestId===wire.requestId);
          if(receipt?.shared||receipt?.shareRejected||receipt?.deniedFor===sessionKey)return;
          await store.update(uid,wire.requestId,{collection:wire.collection,day:wire.day,localRequestId:wire.localRequestId,occurredAt:wire.data.occurredAt||null,shared:false,attempted:true});
          let result;try{const {localRequestId,...input}=wire;result=await request(uid,{action:'submit',...input});}
          catch(error){
            if(error.httpStatus===409){await outbox.update(uid,operation.requestId,{status:'conflict',lastErrorCode:error.code,lastError:'Registro provisório divergente; revise antes de reenviar.'});return;}
            if(error.httpStatus===400||error.code==='CHANNEL_WRITE_DENIED'){
              await store.update(uid,wire.requestId,{shareError:error.code,...(error.httpStatus===400?{shareRejected:true}:{deniedFor:sessionKey})});return;
            }
            throw error;
          }
          if(!['CHANNEL_SHARED','CHANNEL_ALREADY_SHARED'].includes(result.code))throw Error('CHANNEL_RESPONSE_INVALID');
          if(!current(uid,generation))return;
          receipt=await store.update(uid,wire.requestId,{shared:true,state:result.state||'pending'});
          eventTarget.dispatchEvent(new CustomEvent('sahmt-continuity-stored',{detail:{uid,requestId:operation.requestId}}));
          if(receipt.committed)void acknowledge();
          status('CHANNEL_SHARED');emit(wire.collection,wire.day);
        });
      }
    }).catch(error=>{status(error.code||'CHANNEL_UNAVAILABLE');});
  }
  async function readShared(uid,collection,day){
    const key=scopeKey(uid,collection,day);
    return single('read:'+key,async()=>{
      const generation=epoch;let cursor=null,authorizedUntil=0;const records=[],own=[];
      for(let page=0;page<50;page++){
        const value=await request(uid,{action:'list',collection,day,cursor});
        if(value.code!=='CHANNEL_RECORDS'||!Array.isArray(value.records)||!Array.isArray(value.own))throw Error('CHANNEL_RESPONSE_INVALID');
        records.push(...value.records);own.push(...value.own);cursor=value.nextCursor;authorizedUntil=value.authorizedUntil||0;
        if(!cursor)break;if(page===49)throw Error('CHANNEL_REPORT_INCOMPLETE');
      }
      if(!current(uid,generation))throw Error('CHANNEL_SESSION_CHANGED');
      const previous=dataByScope.get(key),next={records,own,at:now(),expiresAt:authorizedUntil};dataByScope.set(key,next);
      if(Number.isSafeInteger(authorizedUntil)&&authorizedUntil>now()){grantExpiresAt=authorizedUntil;await writeCache(uid,'provisionalChannel','access',{accessKey:accessKey(),denied:false}).catch(()=>{});await writeCache(uid,'provisionalChannel',collection+':'+day,{...next,accessKey:accessKey(),expiresAt:Math.min(authorizedUntil,now()+86400000)}).catch(()=>{});}
      if(!current(uid,generation))throw Error('CHANNEL_SESSION_CHANGED');
      // Server-confirmed tombstones remove only receipt metadata, never an unsent local draft.
      for(const item of own)if(item.state==='confirmed')await store.remove(uid,item.requestId);
      if(collection==='scheduleReleases'){
        const receipts=await store.list(uid),operations=await outbox.list(uid);
        for(const item of own.filter(row=>row.state==='superseded')){
          const receipt=receipts.find(r=>r.requestId===item.requestId),operation=operations.find(op=>op.requestId===receipt?.localRequestId);
          if(operation?.payload?.occurredAt===receipt.occurredAt)await outbox.update(uid,operation.requestId,{status:'conflict',lastErrorCode:'CHANNEL_RELEASE_SUPERSEDED',lastError:'Há uma liberação mais recente no canal compartilhado. Revise a escala antes de reenviar.'});
        }
      }
      return {...next,changed:JSON.stringify(previous?.records)!==JSON.stringify(records)};
    });
  }
  async function hydrateShared(uid,collection,day){
    const key=scopeKey(uid,collection,day),generation=epoch;if(dataByScope.has(key)||!current(uid,generation))return false;
    const denial=await readCache(uid,'provisionalChannel','access').catch(()=>null);if(denial?.data?.denied&&denial.data.accessKey===accessKey())return false;
    const saved=await readCache(uid,'provisionalChannel',collection+':'+day).catch(()=>null),value=saved?.data;
    if(!current(uid,generation)||!value||value.accessKey!==accessKey()||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now()||!Array.isArray(value.records))return false;
    dataByScope.set(key,{records:value.records,own:[],at:value.at,expiresAt:value.expiresAt});return true;
  }
  async function dropShared(uid,collection,day,id){
    const key=scopeKey(uid,collection,day),value=dataByScope.get(key)||{};
    const next={...value,records:(value.records||[]).filter(row=>row.id!==id),own:[],at:now()};
    dataByScope.set(key,next);
    await writeCache(uid,'provisionalChannel',collection+':'+day,{...next,accessKey:accessKey(),expiresAt:Math.min(value.expiresAt||grantExpiresAt||now(),now()+86400000)}).catch(()=>{});
    emit(collection,day);
  }
  async function acknowledge(){
    const uid=getSession()?.user?.uid,generation=epoch;if(!current(uid,generation)||!online()||getSession()?.offline)return;
    return single('ack:'+uid,async()=>{
      for(const candidate of await store.list(uid)){
        if(!candidate.committed||candidate.ackAttempts>=3||now()<(candidate.nextAckAt||0)||!current(uid,generation))continue;
        await serial('mutation:'+uid+':'+candidate.requestId,async()=>{
          const receipt=(await store.list(uid)).find(row=>row.requestId===candidate.requestId);
          if(!receipt||!current(uid,generation))return;
          if(!receipt.attempted&&!receipt.shared){await store.remove(uid,receipt.requestId);return;}
          try{
            // A lost submit response is reconciled without a Firestore read first.
            if(!receipt.shared){
              const state=await request(uid,{action:'status',collection:receipt.collection,day:receipt.day,requestId:receipt.requestId});
              if(state.state==='confirmed'){await store.remove(uid,receipt.requestId);return;}
              if(state.state!=='pending'){await store.update(uid,receipt.requestId,{ackError:'CHANNEL_CONFIRMATION_CONFLICT'});return;}
              await store.update(uid,receipt.requestId,{shared:true});
            }
            const result=await request(uid,{action:'ack',collection:receipt.collection,day:receipt.day,requestId:receipt.requestId});
            if(result.code==='CHANNEL_CONFIRMED'){await store.remove(uid,receipt.requestId);await dropShared(uid,receipt.collection,receipt.day,receipt.requestId);}
          }catch(error){
            if([400,404,409].includes(error.httpStatus)){await store.update(uid,receipt.requestId,{ackError:error.code||'CHANNEL_CONFIRMATION_PENDING',ackAttempts:(receipt.ackAttempts||0)+1});return;}
            await store.update(uid,receipt.requestId,{nextAckAt:now()+300000});throw error;
          }
        });
      }
    }).catch(error=>status(error.code||'CHANNEL_CONFIRMATION_PENDING'));
  }
  async function seedReport(kind,scope){
    if(kind!=='checklist')return {records:[],stale:true,fromCache:true,hasPendingWrites:false};
    const saved=await readCache(scope.uid,'stations','all');if(!Array.isArray(saved?.data))return null;
    return {catalog:{records:saved.data,stale:true,fromCache:true,hasPendingWrites:false},report:{records:[],priorRecords:[],recordsUnavailable:true,historyIncomplete:true,stale:true,fromCache:true,hasPendingWrites:false}};
  }
  function watch(scope,onRecords){
    const collection=scope.kind==='checklist'?'checklists':scope.kind;
    if(!enabled||scope.mode!=='daily'||!CHANNEL_COLLECTIONS.includes(collection))return ()=>{};
    let closed=false,tickTimer,inFlight=false,again=false;
    const tick=async()=>{
      if(closed||!current(scope.uid))return;if(inFlight){again=true;return;}inFlight=true;clearTimeout(tickTimer);
      try{
        const saved=dataByScope.get(scopeKey(scope.uid,collection,scope.day));
        if(saved&&saved.expiresAt<=now()){dataByScope.delete(scopeKey(scope.uid,collection,scope.day));if(!closed&&current(scope.uid))onRecords([],null);}
        if(documentSource.visibilityState!=='hidden'&&await hydrateShared(scope.uid,collection,scope.day)){const saved=dataByScope.get(scopeKey(scope.uid,collection,scope.day));if(!closed&&current(scope.uid))onRecords(saved.records,await seedReport(scope.kind,scope));}
        if(documentSource.visibilityState!=='hidden'&&online()){
          const value=await readShared(scope.uid,collection,scope.day),seed=await seedReport(scope.kind,scope);
          if(!closed&&current(scope.uid))onRecords(value.records,seed);
        }
      }catch(error){if(!closed){status(error.code||'CHANNEL_UNAVAILABLE');if(error.httpStatus===401||error.httpStatus===403)onRecords([],null);}}
      finally{inFlight=false;if(!closed){tickTimer=setTimeout(tick,again?100:60000);again=false;}}
    };
    const changed=event=>{if(event.detail?.collection===collection&&event.detail?.day===scope.day)void tick();};
    eventTarget.addEventListener('sahmt-channel-data',changed);documentSource.addEventListener('visibilitychange',tick);void tick();
    const stop=()=>{closed=true;clearTimeout(tickTimer);eventTarget.removeEventListener('sahmt-channel-data',changed);documentSource.removeEventListener('visibilitychange',tick);stops.delete(stop);};stops.add(stop);return stop;
  }
  const adapter={watch,merge:(kind,payload,records)=>kind==='checklist'?{...payload,report:{...payload.report,records:mergeSharedChannelRecords('checklists',payload.report.records,records)}}:
    {...payload,records:mergeSharedChannelRecords(kind,payload.records,records)}};
  function projectSchedule(schedule,{uid,day}){
    const shared=dataByScope.get(scopeKey(uid,'scheduleReleases',day));if(!schedule||!current(uid)||!shared?.records.length||shared.expiresAt<=now())return schedule;
    let siglas=[...(schedule.highlights?.siglas||[])],releaseTimes={...(schedule.highlights?.releaseTimes||{})};const pending=[];
    for(const record of [...shared.records].reverse()){
      const previous=siglas;siglas=updateScheduleReleaseState(siglas,record).siglas;releaseTimes=updateScheduleReleaseTimes(releaseTimes,previous,siglas,record.occurredAt);pending.push(record.sigla,record.tokenSigla);
    }
    return {...schedule,highlights:{...schedule.highlights,siglas,releaseTimes},provisionalReleaseSiglas:pending,sharedProvisional:true};
  }
  async function assertReleaseCurrent(uid,wire){
    if(!current(uid))throw Object.assign(Error('A sessão mudou.'),{code:'unauthenticated'});
    const value=await readShared(uid,'scheduleReleases',wire.day);
    const own=value.own.find(row=>row.requestId===wire.requestId);
    if(own?.state==='superseded')throw Object.assign(Error('Há uma liberação mais recente no canal compartilhado. Revise a escala.'),{code:'stale-version'});
    const latest=value.records.find(row=>row.sigla===wire.data.sigla);
    if(latest&&latest.id!==wire.requestId)throw Object.assign(Error('Há uma liberação mais recente no canal compartilhado. Revise a escala.'),{code:'stale-version'});
  }
  async function withdraw(operation){
    const uid=getSession()?.user?.uid,generation=epoch,wire=await provisionalWireOperation(operation);if(!wire||!current(uid,generation))throw Error('CHANNEL_NOT_READY');
    return single('withdraw:'+uid+':'+wire.requestId,async()=>{
      // Separate lock key waits for an in-flight submit instead of returning its result.
      return serial('mutation:'+uid+':'+wire.requestId,async()=>{
        const receipt=(await store.list(uid)).find(row=>row.requestId===wire.requestId);
        if(receipt?.attempted||receipt?.shared){
          const response=await request(uid,{action:'withdraw',collection:wire.collection,day:wire.day,requestId:wire.requestId});
          if(!['CHANNEL_WITHDRAWN','CHANNEL_CONFIRMED'].includes(response.code))throw Error('CHANNEL_WITHDRAWAL_PENDING');
          await dropShared(uid,wire.collection,wire.day,wire.requestId);
        }
        if(!current(uid,generation))throw Error('CHANNEL_SESSION_CHANGED');
        await store.remove(uid,wire.requestId);
      });
    });
  }
  async function recover(day,collection){
    const uid=getSession()?.user?.uid;if(!validDay(day)||!CHANNEL_COLLECTIONS.includes(collection)||!current(uid))return {restored:0};
    // Explicit recovery also rearms capped confirmations; it never runs on a timer.
    for(const receipt of await store.list(uid))if(receipt.committed&&receipt.day===day&&receipt.collection===collection)await store.update(uid,receipt.requestId,{ackAttempts:0,ackError:null,nextAckAt:0});
    await acknowledge();
    const rows=await readShared(uid,collection,day),existing=await outbox.list(uid),receipts=await store.list(uid);let restored=0;
    for(const item of rows.own){
      if(!current(uid)||item.state!=='pending'||receipts.some(receipt=>receipt.requestId===item.requestId&&receipt.committed))continue;
      let requestId=item.requestId,resourceId=item.requestId,payload={collectionName:collection,data:item.data};
      if(collection==='scheduleReleases'){payload=item.data;requestId='schedule-release::'+uid+'::'+day+'::'+payload.sigla;resourceId=day+':'+payload.sigla;}
      if(existing.some(row=>row.requestId===requestId))continue;
      await outbox.enqueue({uid,type:collection,requestId,resourceId,payload,coalesce:false});restored++;
    }
    return {restored};
  }
  async function sessionChanged(){
    const s=getSession(),key=accessKey();
    if(key!==sessionKey){epoch++;sessionKey=key;dataByScope.clear();grantExpiresAt=0;retryAt=0;}
    const uid=s?.user?.uid;if(!current(uid))return;
    const fingerprint=key;
    if(!s.offline&&now()>=authorizeRetryAt&&(lastAuthorization!==fingerprint||grantExpiresAt-now()<2*3600000)){
      try{if(await authorize(lastAuthorization!==fingerprint&&Boolean(lastAuthorization)))lastAuthorization=fingerprint;}catch(error){authorizeRetryAt=now()+15*60000;status(error.code||'CHANNEL_AUTHORIZATION_PENDING');}
    }
    await share();await acknowledge();
  }
  async function pulse(){
    clearTimeout(timer);
    try{
      const s=getSession(),uid=s?.user?.uid;
      if(current(uid)&&documentSource.visibilityState!=='hidden'){
        const day=documentSource.querySelector('#schedule-date')?.value;
        if(validDay(day)&&await hydrateShared(uid,'scheduleReleases',day))onSchedule(day);
        if(online()){await share();if(validDay(day)){const value=await readShared(uid,'scheduleReleases',day);if(value.changed)onSchedule(day);}}
      }
    }catch(error){status(error.code||'CHANNEL_UNAVAILABLE');}
    finally{if(!stopped)timer=setTimeout(pulse,60000);}
  }
  const queued=()=>{void share();},synced=()=>{void acknowledge();},sessionEvent=()=>{void sessionChanged();};
  function start(reports){
    if(!enabled)return ()=>{};reports.configureSharedAdapter(adapter);
    eventTarget.addEventListener('sahmt-write-queued',queued);eventTarget.addEventListener('sahmt-write-synced',synced);eventTarget.addEventListener('sahmt-channel-confirm',synced);
    eventTarget.addEventListener('online',sessionEvent);eventTarget.addEventListener('sahmt-channel-session',sessionEvent);documentSource.addEventListener('visibilitychange',sessionEvent);
    void sessionChanged();void pulse();
    return ()=>{stopped=true;epoch++;clearTimeout(timer);for(const stop of [...stops])stop();reports.configureSharedAdapter(null);dataByScope.clear();
      eventTarget.removeEventListener('sahmt-write-queued',queued);eventTarget.removeEventListener('sahmt-write-synced',synced);eventTarget.removeEventListener('sahmt-channel-confirm',synced);
      eventTarget.removeEventListener('online',sessionEvent);eventTarget.removeEventListener('sahmt-channel-session',sessionEvent);documentSource.removeEventListener('visibilitychange',sessionEvent);};
  }
  async function mirrorSource(path){const uid=getSession()?.user?.uid;if(!current(uid)||!online()||getSession()?.offline)return false;await request(uid,{action:'source',path});return true;}
  return {start,authorize,share,acknowledge,watch,projectSchedule,recover,withdraw,assertReleaseCurrent,sessionChanged,mirrorSource,enabled,adapter};
}
