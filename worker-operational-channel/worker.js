import {CHANNEL_COLLECTIONS, CHANNEL_GRANT_MS, parseChannelPolicy, channelActorFromProfile, normalizeChannelSubmission, canReadChannelCollection,
  canReadChannelRecord,canWriteChannel,validDay,validId,channelError} from '../src/provisional-channel-contract.js';
import {createChannelIdentityVerifier,readChannelJson} from './identity.js';
import {updateScheduleReleaseState} from '../src/schedule-release.js';
import {issueRealtimeTicket,upgradeRealtime,setupRealtime,acceptRealtimeSocket,broadcastRealtime,realtimeSocketMessage,notifyRealtime} from './realtime.js';
import {importContinuitySnapshot,bootstrapContinuity,setupContinuityAuthority,continuityAuthorityAction,setupContinuityState,continuityStateAction,recordContinuitySubmission,setContinuityOperationState,recordContinuityCommit,recordContinuitySourceChange} from './continuity.js';
const PREFIX='https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents/';
const json=(body,status=200,origin)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  ...(origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})}});
function decodeField(field) {
  if('nullValue' in field)return null;
  if('stringValue' in field)return field.stringValue;
  if('booleanValue' in field)return field.booleanValue;
  if('integerValue' in field)return Number(field.integerValue);
  if('doubleValue' in field)return field.doubleValue;
  if('timestampValue' in field)return field.timestampValue;
  if('arrayValue' in field)return(field.arrayValue.values||[]).map(decodeField);
  if('mapValue' in field)return Object.fromEntries(Object.entries(field.mapValue.fields||{}).map(([k,v])=>[k,decodeField(v)]));
  throw channelError('CHANNEL_FIRESTORE_PROOF_INVALID',409);
}
function decodeDocument(document,path) {
  if(document.name!=='projects/sahmt-17a16/databases/(default)/documents/'+path||!document.fields)throw channelError('CHANNEL_FIRESTORE_PROOF_INVALID',409);
  return Object.fromEntries(Object.entries(document.fields).map(([key,value])=>[key,decodeField(value)]));
}
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const internal=(stub,path,body)=>stub.fetch(new Request('https://channel.internal/'+path,{method:'POST',body:JSON.stringify(body)}));
export function createOperationalChannelWorker({fetchImpl=fetch,now=Date.now,verifyIdentity=createChannelIdentityVerifier({fetchImpl,now})}={}) {
  async function firestore(path,bearer,appCheckToken) {
    let response;try {response=await fetchImpl(PREFIX+path,{headers:{Authorization:bearer,'Cache-Control':'no-store',...(appCheckToken?{'X-Firebase-AppCheck':appCheckToken}:{})},redirect:'manual',signal:AbortSignal.timeout(5000)});}catch{throw channelError('CHANNEL_FIRESTORE_UNAVAILABLE',503);}
    if(response.status!==200){await response.body?.cancel();throw channelError([401,403,404].includes(response.status)?'CHANNEL_PROFILE_DENIED':'CHANNEL_FIRESTORE_UNAVAILABLE',[401,403,404].includes(response.status)?403:503);}
    return decodeDocument(await readChannelJson(response,49152),path);
  }
  return {async fetch(request,env) {
    const origin=request.headers.get('Origin'),allowed=['https://anestesiahmtforms.github.io'];
    if(env.CHANNEL_PILOT_ORIGIN)try{const u=new URL(env.CHANNEL_PILOT_ORIGIN);if(u.protocol==='https:'&&u.origin===env.CHANNEL_PILOT_ORIGIN)allowed.push(u.origin);}catch{}
    if(!allowed.includes(origin))return json({code:'CHANNEL_ORIGIN_DENIED'},403);
    const url=new URL(request.url);
    if(!['/v1/operational-channel','/v1/operational-channel/events','/v1/operational-continuity/import'].includes(url.pathname)||url.search)return json({code:'CHANNEL_ROUTE_INVALID'},404,origin);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization,Content-Type,X-Firebase-AppCheck','Access-Control-Max-Age':'3600',Vary:'Origin'}});
    if(request.method!==(url.pathname==='/v1/operational-channel/events'?'GET':'POST'))return json({code:'CHANNEL_METHOD_DENIED'},405,origin);
    if(env.OPERATIONAL_CHANNEL_ENABLED!=='true'&&url.pathname!=='/v1/operational-continuity/import')return json({code:'CHANNEL_DISABLED'},503,origin);
    try {
      if(!env.OPERATIONAL_CHANNEL_STATE?.idFromName||!env.OPERATIONAL_CHANNEL_AUTHORIZATION?.idFromName)throw channelError('CHANNEL_BINDING_MISSING',503);
      if(url.pathname==='/v1/operational-channel/events')return await upgradeRealtime(request,env,now());
      if(url.pathname==='/v1/operational-continuity/import'){const result=await importContinuitySnapshot(request,env,now());return json(await result.json(),result.status,origin);}
      const body=await readChannelJson(request);
      if(!body||!['authorize','submit','list','ack','withdraw','status','bootstrap','recover','source','watch'].includes(body.action))throw channelError('CHANNEL_REQUEST_INVALID');
      const bearer=request.headers.get('Authorization')||'';
      if(!/^Bearer [A-Za-z0-9_.-]{100,16000}$/.test(bearer))throw channelError('CHANNEL_AUTH_INVALID',401);
      const appCheckToken=request.headers.get('X-Firebase-AppCheck');
      if(appCheckToken&&!/^[A-Za-z0-9_.-]{100,16000}$/.test(appCheckToken))throw channelError('CHANNEL_APP_CHECK_INVALID',401);
      const identity=await verifyIdentity(bearer.slice(7),env.FA_FIREBASE_WEB_API_KEY,appCheckToken);
      if(body.action==='source'){
        if(env.OPERATIONAL_CONTINUITY_ENABLED!=='true')throw channelError('CONTINUITY_DISABLED',503);
        if(Object.keys(body).some(key=>!['action','path'].includes(key))||! /^(users|stations|contacts|eventMembers|appConfig|eventCatalogs|vacations|scheduleDays|events|labels|checklists)\/[A-Za-z0-9_-]{1,128}$/.test(body.path||''))throw channelError('CHANNEL_REQUEST_INVALID');
        const data=await firestore(body.path,bearer,appCheckToken),result=await recordContinuitySourceChange(env,body.path,data,now());
        return json({code:'CHANNEL_SOURCE_UPDATED'},result.status,origin);
      }
      if(['bootstrap','recover'].includes(body.action)){
        if(Object.keys(body).some(key=>!['action','day','after'].includes(key)))throw channelError('CHANNEL_REQUEST_INVALID');
        const result=await bootstrapContinuity(env,identity.uid,body.day,now(),{recoverOnly:body.action==='recover',after:body.after});return json(await result.json(),result.status,origin);
      }
      const authority=env.OPERATIONAL_CHANNEL_AUTHORIZATION.get(env.OPERATIONAL_CHANNEL_AUTHORIZATION.idFromName(identity.uid));
      let grantResponse=await internal(authority,'get',{now:now()}),grant=await grantResponse.json(),actor=grant.actor;
      if(body.action==='authorize') {
        if(Object.keys(body).some(key=>!['action','refresh'].includes(key))||body.refresh!==undefined&&typeof body.refresh!=='boolean')throw channelError('CHANNEL_REQUEST_INVALID');
        if(!actor||actor.fromContinuity||body.refresh===true||actor.expiresAt<=now()||now()-actor.verifiedAt>=12*3600000) {
          // One profile read on initial enrollment / real profile refresh. Never
          // invoked by submit/list polling, so quota exhaustion does not create a loop.
          if(actor&&body.refresh===true&&now()-actor.verifiedAt<60000)return json({code:'CHANNEL_AUTHORIZED',expiresAt:actor.expiresAt},200,origin);
          let profile;
          try {profile=await firestore('users/'+encodeURIComponent(identity.uid),bearer,appCheckToken);actor=channelActorFromProfile(identity.uid,profile,now());}
          catch(error){if(error.status===403)await internal(authority,'revoke',{now:now()});throw error;}
          await internal(authority,'put',{actor,now:now()});
          if(env.OPERATIONAL_CONTINUITY_ENABLED==='true')await internal(authority,'continuity-profile-put',{profile:{schemaVersion:1,uid:identity.uid,verifiedAt:now(),profile:{...profile,uid:profile.uid||identity.uid}},now:now()});
        }
        if(!actor.active||!actor.access)throw channelError('CHANNEL_USER_DENIED',403);
        return json({code:'CHANNEL_AUTHORIZED',expiresAt:actor.expiresAt},200,origin);
      }
      if(!actor&&!grant.revoked&&env.OPERATIONAL_CHANNEL_AUTHORIZATION_JSON) {
        const policy=parseChannelPolicy(env.OPERATIONAL_CHANNEL_AUTHORIZATION_JSON,now());actor=policy.users.get(identity.uid);
        if(actor)await internal(authority,'put',{actor,now:now()});
      }
      if(!actor||actor.uid!==identity.uid||!actor.active||!actor.access)throw channelError('CHANNEL_USER_DENIED',403);
      if(actor.expiresAt<=now()||actor.verifiedAt>now()||actor.expiresAt-actor.verifiedAt>CHANNEL_GRANT_MS)throw channelError('CHANNEL_AUTHORIZATION_EXPIRED',403);
      if(body.action==='watch'){
        if(Object.keys(body).some(key=>key!=='action'))throw channelError('CHANNEL_REQUEST_INVALID');
        return json(await issueRealtimeTicket(env,actor,now()),200,origin);
      }
      const collection=body.collection,day=body.day;
      if(!CHANNEL_COLLECTIONS.includes(collection)||!validDay(day))throw channelError('CHANNEL_REQUEST_INVALID');
      const keys={submit:['action','collection','day','requestId','data','createdAt'],list:['action','collection','day','cursor'],ack:['action','collection','day','requestId'],withdraw:['action','collection','day','requestId'],status:['action','collection','day','requestId']};
      if(Object.keys(body).some(key=>!keys[body.action].includes(key)))throw channelError('CHANNEL_REQUEST_INVALID');
      const stub=env.OPERATIONAL_CHANNEL_STATE.get(env.OPERATIONAL_CHANNEL_STATE.idFromName(collection+':'+day));
      if(body.action==='submit') {
        const submission=normalizeChannelSubmission({collection,requestId:body.requestId,data:body.data,createdAt:body.createdAt},actor,now());
        if(submission.record.date!==day)throw channelError('CHANNEL_DATE_INVALID');
        const response=await internal(stub,'submit',{submission,actor,now:now()}),value=await response.json();
        if(response.ok){
          await recordContinuitySubmission(env,actor,submission);
          for(const prior of value._superseded||[])await setContinuityOperationState(env,prior.uid,prior.requestId,'superseded');
          await notifyRealtime(env,collection,day);
        }
        delete value._superseded;
        return json(value,response.status,origin);
      }
      if(body.action==='list') {
        if(!canReadChannelCollection(collection,actor))throw channelError('CHANNEL_READ_DENIED',403);
        const response=await internal(stub,'list',{actor,now:now(),cursor:body.cursor||null});return json({...await response.json(),authorizedUntil:actor.expiresAt},response.status,origin);
      }
      if(!validId(body.requestId)||!canWriteChannel(collection,actor))throw channelError('CHANNEL_WRITE_DENIED',403);
      if(body.action==='withdraw'){const response=await internal(stub,'withdraw',{actor,collection,requestId:body.requestId,now:now()}),value=await response.json();if(response.ok){await setContinuityOperationState(env,actor.uid,body.requestId,value.code==='CHANNEL_CONFIRMED'?'confirmed':'withdrawn');await notifyRealtime(env,collection,day);}return json(value,response.status,origin);}
      const pendingResponse=await internal(stub,'get',{actor,requestId:body.requestId,now:now()}),pending=await pendingResponse.json();
      if(pendingResponse.status!==200)return json(pending,pendingResponse.status,origin);
      if(body.action==='status')return json({code:'CHANNEL_RECEIPT',state:pending.state},200,origin);
      if(pending.state==='confirmed'){await setContinuityOperationState(env,actor.uid,body.requestId,'confirmed');return json({code:'CHANNEL_CONFIRMED'},200,origin);}
      if(pending.state!=='pending')return json({code:'CHANNEL_CONFIRMATION_CONFLICT'},409,origin);
      // Only an explicit post-commit acknowledgment reads Firestore; polling never does.
      const path=collection==='scheduleReleases'?'scheduleDays/'+day:collection+'/'+body.requestId;
      let fields;try{fields=await firestore(path,bearer,appCheckToken);}catch(error){return json({code:error.status===409?'CHANNEL_CONFIRMATION_CONFLICT':'CHANNEL_CONFIRMATION_PENDING'},[403,409].includes(error.status)?409:503,origin);}
      const matches=collection==='scheduleReleases'?!updateScheduleReleaseState(fields.highlights?.siglas||[],pending.data).changed:
        fields.id===body.requestId&&fields.clientMutationId===body.requestId&&fields.createdByUid===actor.uid&&
        Object.entries(pending.data).filter(([key])=>!['createdByName','updatedByName'].includes(key)).every(([key,value])=>canonical(fields[key])===canonical(value));
      if(!matches)return json({code:'CHANNEL_CONFIRMATION_CONFLICT'},409,origin);
      await recordContinuityCommit(env,collection,day,fields,now());
      const response=await internal(stub,'ack',{actor,requestId:body.requestId,now:now()});if(response.ok){await setContinuityOperationState(env,actor.uid,body.requestId,'confirmed');await notifyRealtime(env,collection,day);}return json(await response.json(),response.status,origin);
    }catch(error){return json({code:/^(?:CHANNEL|CONTINUITY)_[A-Z_]+$/.test(error.code||'')?error.code:'CHANNEL_UNAVAILABLE'},error.status||503,origin);}
  }};
}
export class OperationalChannelAuthorization {
  constructor(ctx){this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS channel_grant (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL)');setupContinuityAuthority(this.sql);}
  async fetch(request){
    if(request.method!=='POST'||new URL(request.url).origin!=='https://channel.internal')return json({code:'CHANNEL_INTERNAL_DENIED'},403);
    const body=await readChannelJson(request,8192),path=new URL(request.url).pathname;
    const continuity=continuityAuthorityAction(this.sql,path,body);if(continuity)return continuity;
    if(path==='/get'){const row=this.sql.exec('SELECT content FROM channel_grant WHERE id=1').toArray()[0];const value=row?JSON.parse(row.content):null;return json({actor:value?.revoked?null:value,revoked:value?.revoked===true});}
    if(path==='/revoke'){this.sql.exec('INSERT OR REPLACE INTO channel_grant VALUES(1,?)',JSON.stringify({revoked:true,revokedAt:body.now}));return json({code:'CHANNEL_AUTHORIZATION_REVOKED'});}
    if(path==='/put'){
      const actor=body.actor;
      if(!validId(actor?.uid)||!Number.isSafeInteger(actor.expiresAt)||actor.expiresAt<=body.now||actor.expiresAt-actor.verifiedAt>CHANNEL_GRANT_MS)return json({code:'CHANNEL_POLICY_INVALID'},400);
      this.sql.exec('INSERT OR REPLACE INTO channel_grant VALUES(1,?)',JSON.stringify(actor));return json({code:'CHANNEL_AUTHORIZED'});
    }
    return json({code:'CHANNEL_INTERNAL_INVALID'},400);
  }
}
export class OperationalChannelState {
  constructor(ctx){
    this.ctx=ctx;this.storage=ctx.storage;this.sql=ctx.storage.sql;
    setupRealtime(this.sql);
    setupContinuityState(this.sql);
    this.sql.exec('CREATE TABLE IF NOT EXISTS channel_records (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,owner TEXT NOT NULL,collection TEXT NOT NULL,receipt_at INTEGER NOT NULL,content TEXT NOT NULL,state TEXT NOT NULL,release_key TEXT)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS channel_state ON channel_records(state,seq)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS channel_release_key ON channel_records(release_key,state)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS channel_rate (actor TEXT PRIMARY KEY,window_at INTEGER NOT NULL,requests INTEGER NOT NULL)');
  }
  async fetch(request){
    const url=new URL(request.url);
    if(url.origin!=='https://channel.internal'||request.method!==(url.pathname==='/realtime-connect'?'GET':'POST'))return json({code:'CHANNEL_INTERNAL_DENIED'},403);
    try{
      if(url.pathname==='/realtime-connect')return acceptRealtimeSocket(this.ctx,this.sql,JSON.parse(request.headers.get('X-Realtime-Grant')),Date.now());
      const path=new URL(request.url).pathname,body=await readChannelJson(request,path.startsWith('/continuity-')?524288:49152),actor=body.actor;
      if(path==='/realtime-notify')return broadcastRealtime(this.ctx,body,Date.now());
      if(path==='/continuity-record-status'||path==='/continuity-claim'){
        const row=this.sql.exec('SELECT owner,state FROM channel_records WHERE id=?',body.requestId).toArray()[0];
        if(!row||row.owner!==body.uid)return json({code:'CONTINUITY_OPERATION_MISSING',state:null});
        if(path==='/continuity-record-status')return json({code:'CONTINUITY_OPERATION_STATUS',state:row.state});
        if(!['pending','processing'].includes(row.state))return json({code:'CONTINUITY_CLAIM_REFUSED',state:row.state});
        this.sql.exec("UPDATE channel_records SET state='processing' WHERE id=?",body.requestId);return json({code:'CONTINUITY_CLAIMED',state:'processing'});
      }
      if(path==='/continuity-record-state'){
        if(!validId(body.uid)||!validId(body.requestId)||!['confirmed','conflict'].includes(body.state))throw channelError('CONTINUITY_OPERATION_INVALID');
        this.sql.exec('UPDATE channel_records SET state=? WHERE id=? AND owner=?',body.state,body.requestId,body.uid);return json({code:'CONTINUITY_RECORD_UPDATED'});
      }
      const continuity=continuityStateAction(this.sql,path,body);if(continuity)return continuity;
      if(!validId(actor?.uid)||!Number.isSafeInteger(body.now)||!actor.active||!actor.access||actor.expiresAt<=body.now)throw channelError('CHANNEL_INTERNAL_INVALID');
      return this.storage.transactionSync(()=>{
        const rate=this.sql.exec('SELECT * FROM channel_rate WHERE actor=?',actor.uid).toArray()[0],fresh=!rate||body.now-rate.window_at>=60000;
        if(!fresh&&rate.requests>=180)return json({code:'CHANNEL_RATE_LIMIT'},429);
        this.sql.exec('INSERT OR REPLACE INTO channel_rate VALUES(?,?,?)',actor.uid,fresh?body.now:rate.window_at,fresh?1:rate.requests+1);
        this.sql.exec("DELETE FROM channel_records WHERE state='confirmed' AND receipt_at<?",body.now-7*86400000);
        if(path==='/submit'){
          const s=body.submission;
          if(!s||!validId(s.requestId)||s.record.createdByUid!==actor.uid||!canWriteChannel(s.collection,actor))throw channelError('CHANNEL_WRITE_DENIED',403);
          const existing=this.sql.exec('SELECT content,state FROM channel_records WHERE id=?',s.requestId).toArray()[0];
          if(existing){const row=JSON.parse(existing.content),same=canonical(row.data)===canonical(s.data)&&row.record.createdByUid===actor.uid;
            return json({code:same?'CHANNEL_ALREADY_SHARED':'CHANNEL_ID_CONFLICT',state:existing.state,requestId:s.requestId,_superseded:row.superseded||[]},same?200:409);}
          const {count}=this.sql.exec('SELECT COUNT(*) AS count FROM channel_records').one();if(count>=2000)return json({code:'CHANNEL_CAPACITY_REACHED'},507);
          const releaseKey=s.collection==='scheduleReleases'?s.data.sigla:null;
          let superseded=[];
          if(releaseKey){
            if(this.sql.exec("SELECT id FROM channel_records WHERE release_key=? AND state='processing' LIMIT 1",releaseKey).toArray().length)return json({code:'CHANNEL_RECONCILIATION_IN_PROGRESS'},409);
            const latest=this.sql.exec("SELECT content FROM channel_records WHERE release_key=? ORDER BY seq DESC LIMIT 1",releaseKey).toArray()[0];
            if(latest){const prior=JSON.parse(latest.content);if(prior.record.createdByUid===actor.uid&&prior.data.occurredAt>s.data.occurredAt)return json({code:'CHANNEL_STALE_RELEASE'},409);}
            superseded=this.sql.exec("SELECT id,owner FROM channel_records WHERE release_key=? AND state='pending'",releaseKey).toArray().map(row=>({uid:row.owner,requestId:row.id}));
            this.sql.exec("UPDATE channel_records SET state='superseded' WHERE release_key=? AND state='pending'",releaseKey);
          }
          this.sql.exec('INSERT INTO channel_records(id,owner,collection,receipt_at,content,state,release_key) VALUES(?,?,?,?,?,?,?)',s.requestId,actor.uid,s.collection,body.now,JSON.stringify({...s,superseded}),'pending',releaseKey);
          return json({code:'CHANNEL_SHARED',requestId:s.requestId,state:'pending',provisional:true,_superseded:superseded});
        }
        if(path==='/list'){
          const cursor=body.cursor;if(cursor&&(!Number.isSafeInteger(cursor.before)||!Number.isSafeInteger(cursor.ceiling)||cursor.before<1||cursor.ceiling<1))throw channelError('CHANNEL_CURSOR_INVALID');
          const ceiling=cursor?.ceiling ?? this.sql.exec('SELECT COALESCE(MAX(seq),0) AS seq FROM channel_records').one().seq;
          const rows=this.sql.exec('SELECT seq,id,content,state FROM channel_records WHERE seq<=? AND seq<? ORDER BY seq DESC LIMIT 41',ceiling,cursor?.before ?? ceiling+1).toArray();
          const page=rows.slice(0,40),last=page.at(-1);
          const decoded=page.map(row=>({...JSON.parse(row.content),state:row.state}));
          return json({code:'CHANNEL_RECORDS',records:decoded.filter(s=>['pending','processing'].includes(s.state)&&canReadChannelRecord(s.collection,s.record,actor)).map(s=>s.record),
            own:decoded.filter(s=>s.record.createdByUid===actor.uid).map(s=>({requestId:s.requestId,collection:s.collection,data:s.state==='pending'?s.data:null,state:s.state,receivedAt:s.record.receivedAt})),
            nextCursor:rows.length>40?{before:last.seq,ceiling}:null,provisional:true});
        }
        const row=this.sql.exec('SELECT content,state FROM channel_records WHERE id=?',body.requestId).toArray()[0],value=row?JSON.parse(row.content):null;
        if(path==='/withdraw'&&row?.state==='processing')return json({code:'CHANNEL_RECONCILIATION_IN_PROGRESS'},409);
        if(path==='/withdraw'&&!value){
          // Tombstone fences a delayed submit whose HTTP response was lost. No record body is retained.
          const {count}=this.sql.exec('SELECT COUNT(*) AS count FROM channel_records').one();if(count>=2000)return json({code:'CHANNEL_CAPACITY_REACHED'},507);
          const tombstone={collection:body.collection,requestId:body.requestId,data:null,record:{createdByUid:actor.uid,receivedAt:body.now}};
          this.sql.exec('INSERT INTO channel_records(id,owner,collection,receipt_at,content,state,release_key) VALUES(?,?,?,?,?,?,?)',body.requestId,actor.uid,body.collection,body.now,JSON.stringify(tombstone),'withdrawn',null);
          return json({code:'CHANNEL_WITHDRAWN'});
        }
        if(!value||value.record.createdByUid!==actor.uid)return json({code:'CHANNEL_RECORD_UNKNOWN'},404);
        if(path==='/get')return json({...value,state:row.state});
        if(path==='/withdraw'){if(row.state==='confirmed')return json({code:'CHANNEL_CONFIRMED'});this.sql.exec("UPDATE channel_records SET state='withdrawn' WHERE id=? AND state!='confirmed'",body.requestId);return json({code:'CHANNEL_WITHDRAWN'});}
        if(path==='/ack'){if(row.state!=='pending'&&row.state!=='confirmed')return json({code:'CHANNEL_CONFIRMATION_CONFLICT'},409);this.sql.exec("UPDATE channel_records SET state='confirmed' WHERE id=?",body.requestId);return json({code:'CHANNEL_CONFIRMED'});}
        return json({code:'CHANNEL_INTERNAL_INVALID'},400);
      });
    }catch(error){return json({code:/^CHANNEL_[A-Z_]+$/.test(error.code||'')?error.code:'CHANNEL_STORAGE_UNAVAILABLE'},error.status||503);}
  }
  webSocketMessage(socket,message){realtimeSocketMessage(socket,message,Date.now());}
  webSocketClose(socket,code){try{socket.close(code,'Closed');}catch{}}
  webSocketError(socket){try{socket.close(1011,'Reconnect');}catch{}}
}
export default createOperationalChannelWorker();
