import {validateContinuityProfile,validateContinuityResource,continuityEntriesForActor,CONTINUITY_MAX_AGE_MS,CONTINUITY_MAX_BODY_BYTES} from '../src/remote-continuity-contract.js';
import {channelActorFromProfile,validDay,validId,channelError} from '../src/provisional-channel-contract.js';
import {readChannelJson} from './identity.js';
const response=(body,status=200)=>Response.json(body,{status});
const internal=(stub,path,body)=>stub.fetch(new Request('https://channel.internal/'+path,{method:'POST',body:JSON.stringify(body)}));
const authority=(env,uid)=>env.OPERATIONAL_CHANNEL_AUTHORIZATION.get(env.OPERATIONAL_CHANNEL_AUTHORIZATION.idFromName(uid));
const state=env=>env.OPERATIONAL_CHANNEL_STATE.get(env.OPERATIONAL_CHANNEL_STATE.idFromName('continuity:base'));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const failure=(code,status=400)=>{throw channelError(code,status);};
export async function continuityRequestSignature(secret,body,timestamp,nonce){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
 const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'\n'+nonce+'\n'+hex(digest))));
}
export function setupContinuityAuthority(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS continuity_profile (id INTEGER PRIMARY KEY CHECK(id=1), verified_at INTEGER NOT NULL, content TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS continuity_journal (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL)');
}
export function continuityAuthorityAction(sql,path,body){
 if(!path.startsWith('/continuity-'))return null;
 if(path==='/continuity-profile-put'){
  const value=validateContinuityProfile(body.profile,body.now),prior=sql.exec('SELECT verified_at,content FROM continuity_profile WHERE id=1').toArray()[0];
  const grant=sql.exec('SELECT content FROM channel_grant WHERE id=1').toArray()[0],current=grant?JSON.parse(grant.content):null;
  if(prior&&prior.verified_at>value.verifiedAt||current?.revoked&&(!current.revokedAt||value.verifiedAt<=current.revokedAt))return response({code:'CONTINUITY_OLDER_PROFILE_PRESERVED',changed:false});
  if(prior&&prior.verified_at===value.verifiedAt&&canonical(JSON.parse(prior.content))!==canonical(value))return response({code:'CONTINUITY_PROFILE_CONFLICT'},409);
  sql.exec('INSERT OR REPLACE INTO continuity_profile VALUES(1,?,?)',value.verifiedAt,JSON.stringify(value));
  if(!value.profile.active||!value.profile.access)sql.exec('INSERT OR REPLACE INTO channel_grant VALUES(1,?)',JSON.stringify({revoked:true,revokedAt:value.verifiedAt}));
  else if(current?.revoked)sql.exec('DELETE FROM channel_grant WHERE id=1');
  return response({code:'CONTINUITY_PROFILE_STORED',changed:true});
 }
 if(path==='/continuity-profile-get'){
  const grant=sql.exec('SELECT content FROM channel_grant WHERE id=1').toArray()[0],current=grant?JSON.parse(grant.content):null;
  const row=sql.exec('SELECT content FROM continuity_profile WHERE id=1').toArray()[0];
  return response({profile:current?.revoked?null:row?JSON.parse(row.content):null,revoked:current?.revoked===true});
 }
 if(path==='/continuity-journal-put'){
  const op=body.operation;if(!validId(op?.requestId)||!validId(op.uid))failure('CONTINUITY_OPERATION_INVALID');
  const prior=sql.exec('SELECT content,state FROM continuity_journal WHERE id=?',op.requestId).toArray()[0];
  if(prior){const same=canonical({...JSON.parse(prior.content),createdAt:0})===canonical({...op,createdAt:0});return response({code:same?'CONTINUITY_OPERATION_STORED':'CONTINUITY_OPERATION_CONFLICT',state:prior.state},same?200:409);}
  const {count}=sql.exec("SELECT COUNT(*) AS count FROM continuity_journal WHERE state='pending'").one();if(count>=2000)return response({code:'CONTINUITY_JOURNAL_FULL'},507);
  sql.exec("INSERT INTO continuity_journal VALUES(?,?,?,'pending')",op.requestId,op.createdAt,JSON.stringify(op));return response({code:'CONTINUITY_OPERATION_STORED',state:'pending'});
 }
 if(path==='/continuity-journal-state'){
  if(!validId(body.requestId)||!['withdrawn','confirmed','superseded','conflict'].includes(body.state))failure('CONTINUITY_OPERATION_INVALID');
  sql.exec('UPDATE continuity_journal SET state=? WHERE id=?',body.state,body.requestId);return response({code:'CONTINUITY_OPERATION_UPDATED'});
 }
 if(path==='/continuity-recover'){
  const after=body.after||'';if(typeof after!=='string'||after.length>128)failure('CONTINUITY_CURSOR_INVALID');
  const rows=sql.exec("SELECT id,content,state FROM continuity_journal WHERE state IN ('pending','conflict') AND id>? ORDER BY id LIMIT 41",after).toArray();
  return response({operations:rows.slice(0,40).map(row=>({...JSON.parse(row.content),state:row.state})),nextCursor:rows.length>40?rows[39].id:null});
 }
 return response({code:'CONTINUITY_ACTION_INVALID'},400);
}
export function setupContinuityState(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS continuity_pending (id TEXT PRIMARY KEY, uid TEXT NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS continuity_resources (kind TEXT NOT NULL, id TEXT NOT NULL, verified_at INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(kind,id))');
 sql.exec('CREATE TABLE IF NOT EXISTS continuity_imports (nonce TEXT PRIMARY KEY, created_at INTEGER NOT NULL)');
}
export function continuityStateAction(sql,path,body){
 if(!path.startsWith('/continuity-'))return null;
 if(path==='/continuity-pending-put'){
  const operation=body.operation,key=operation.uid+':'+operation.requestId;
  const prior=sql.exec('SELECT state FROM continuity_pending WHERE id=?',key).toArray()[0];
  if(!prior){const {count}=sql.exec("SELECT COUNT(*) AS count FROM continuity_pending WHERE state='pending'").one();if(count>=10000)return response({code:'CONTINUITY_JOURNAL_FULL'},507);
   sql.exec("INSERT INTO continuity_pending VALUES(?,?,?,'pending')",key,operation.uid,JSON.stringify(operation));}
  return response({code:'CONTINUITY_PENDING_STORED'});
 }
 if(path==='/continuity-pending-state'){
  sql.exec('UPDATE continuity_pending SET state=? WHERE id=?',body.state,body.uid+':'+body.requestId);return response({code:'CONTINUITY_PENDING_UPDATED'});
 }
 if(path==='/continuity-drain'){
  const rows=sql.exec("SELECT content FROM continuity_pending WHERE state='pending' ORDER BY id LIMIT 20").toArray();
  return response({code:'CONTINUITY_DRAIN',operations:rows.map(row=>JSON.parse(row.content))});
 }
 if(path==='/continuity-commit'){
  const {collection,day,fields,now}=body;
  if(!validDay(day)||!['events','labels','checklists','scheduleReleases'].includes(collection)||!fields||typeof fields!=='object')failure('CONTINUITY_OPERATION_INVALID');
  const kind=collection==='scheduleReleases'?'scheduleDays':collection;
  const rows=sql.exec('SELECT content FROM continuity_resources WHERE kind=? AND (id=? OR id=?)',kind,day,day.slice(0,7)).toArray();
  const changes=[];
  for(const row of rows){
   const prior=JSON.parse(row.content);let data;
   if(kind==='scheduleDays'){
    if(Number(prior.data.version||0)>Number(fields.version||0))continue;
    data={...fields,id:day};
   }else{
    const records=[...(prior.data.records||[])],index=records.findIndex(record=>record.id===fields.id);
    if(index>=0&&Number(records[index].version||0)>Number(fields.version||0))continue;
    if(index<0)records.push(fields);else records[index]=fields;
    data={...prior.data,records};
   }
   changes.push(validateContinuityResource({...prior,data,verifiedAt:now,revision:'commit:'+String(now)},now));
  }
  for(const value of changes)sql.exec('UPDATE continuity_resources SET verified_at=?,content=? WHERE kind=? AND id=?',value.verifiedAt,JSON.stringify(value),value.kind,value.id);
  return response({code:'CONTINUITY_COMMIT_STORED',resources:changes.length});
 }
 if(path==='/continuity-import-nonce'){
  sql.exec('DELETE FROM continuity_imports WHERE created_at<?',body.now-600000);
  if(sql.exec('SELECT nonce FROM continuity_imports WHERE nonce=?',body.nonce).toArray().length)return response({code:'CONTINUITY_IMPORT_REPLAY'},409);
  sql.exec('INSERT INTO continuity_imports VALUES(?,?)',body.nonce,body.now);return response({code:'CONTINUITY_IMPORT_ACCEPTED'});
 }
 if(path==='/continuity-resource-put'){
  const value=validateContinuityResource(body.resource,body.now),prior=sql.exec('SELECT verified_at,content FROM continuity_resources WHERE kind=? AND id=?',value.kind,value.id).toArray()[0];
  if(prior&&prior.verified_at>value.verifiedAt)return response({code:'CONTINUITY_OLDER_RESOURCE_PRESERVED',changed:false});
  if(prior&&prior.verified_at===value.verifiedAt&&canonical(JSON.parse(prior.content))!==canonical(value))return response({code:'CONTINUITY_RESOURCE_CONFLICT'},409);
  const {count}=sql.exec('SELECT COUNT(*) AS count FROM continuity_resources').one();if(!prior&&count>=160)return response({code:'CONTINUITY_SNAPSHOT_FULL'},507);
  sql.exec('INSERT OR REPLACE INTO continuity_resources VALUES(?,?,?,?)',value.kind,value.id,value.verifiedAt,JSON.stringify(value));return response({code:'CONTINUITY_RESOURCE_STORED',changed:true});
 }
 if(path==='/continuity-resource-get'){
  if(!validDay(body.day))failure('CONTINUITY_DAY_INVALID');
  const rows=sql.exec('SELECT content FROM continuity_resources WHERE verified_at>=?',body.now-CONTINUITY_MAX_AGE_MS).toArray();
  const resources=rows.map(row=>JSON.parse(row.content)).filter(row=>['scheduleDays','vacations'].includes(row.kind)?row.id===body.day:['events','labels','checklists'].includes(row.kind)?row.id===body.day||row.id===body.day.slice(0,7):true);
  return response({resources});
 }
 return response({code:'CONTINUITY_ACTION_INVALID'},400);
}
export async function importContinuitySnapshot(request,env,now){
 const secret=env.CONTINUITY_IMPORT_SECRET,time=request.headers.get('X-Continuity-Time')||'',nonce=request.headers.get('X-Continuity-Nonce')||'',signature=request.headers.get('X-Continuity-Signature')||'';
 if(typeof secret!=='string'||secret.length<32)failure('CONTINUITY_IMPORT_NOT_CONFIGURED',503);
 if(!/^\d{13}$/.test(time)||Math.abs(now-Number(time))>300000||! /^[A-Za-z0-9_-]{24,100}$/.test(nonce)||! /^[a-f0-9]{64}$/.test(signature))failure('CONTINUITY_IMPORT_DENIED',401);
 const body=await readChannelJson(request,CONTINUITY_MAX_BODY_BYTES),expected=await continuityRequestSignature(secret,JSON.stringify(body),time,nonce);
 let difference=0;for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^signature.charCodeAt(i);if(difference)failure('CONTINUITY_IMPORT_DENIED',401);
 if(body?.schemaVersion!==1)failure('CONTINUITY_IMPORT_INVALID');
 if(['drain','complete'].includes(body.action)){
  const nonceResponse=await internal(state(env),'continuity-import-nonce',{nonce,now});if(!nonceResponse.ok)return nonceResponse;
  if(body.action==='drain')return internal(state(env),'continuity-drain',{});
  if(!validId(body.uid)||!validId(body.requestId)||!['confirmed','conflict'].includes(body.state))failure('CONTINUITY_OPERATION_INVALID');
  const pending=await (await internal(state(env),'continuity-drain',{})).json();
  const operation=pending.operations.find(row=>row.uid===body.uid&&row.requestId===body.requestId);
  if(!operation)return response({code:'CONTINUITY_COMPLETION_ALREADY_PROCESSED'});
  if(body.state==='confirmed'){
   if(!body.record||typeof body.record!=='object')failure('CONTINUITY_OPERATION_INVALID');
   await recordContinuityCommit(env,operation.collection,operation.day,body.record,now);
  }
  const stub=env.OPERATIONAL_CHANNEL_STATE.get(env.OPERATIONAL_CHANNEL_STATE.idFromName(operation.collection+':'+operation.day));
  const result=await internal(stub,'continuity-record-state',{uid:body.uid,requestId:body.requestId,state:body.state});if(!result.ok)return result;
  await setContinuityOperationState(env,body.uid,body.requestId,body.state);
  return response({code:'CONTINUITY_COMPLETED',state:body.state});
 }
 if(!Array.isArray(body.profiles)||body.profiles.length>200||!Array.isArray(body.resources)||body.resources.length>160)failure('CONTINUITY_IMPORT_INVALID');
 const profiles=body.profiles.map(p=>validateContinuityProfile(p,now)),resources=body.resources.map(r=>validateContinuityResource(r,now));
 if(new Set(profiles.map(p=>p.uid)).size!==profiles.length||new Set(resources.map(r=>r.kind+':'+r.id)).size!==resources.length)failure('CONTINUITY_IMPORT_DUPLICATE');
 const nonceResponse=await internal(state(env),'continuity-import-nonce',{nonce,now});if(!nonceResponse.ok)return nonceResponse;
 for(const profile of profiles){const result=await internal(authority(env,profile.uid),'continuity-profile-put',{profile,now});if(!result.ok)return result;}
 for(const resource of resources){const result=await internal(state(env),'continuity-resource-put',{resource,now});if(!result.ok)return result;}
 return response({code:'CONTINUITY_IMPORTED',profiles:profiles.length,resources:resources.length});
}
export async function bootstrapContinuity(env,uid,day,now,{recoverOnly=false,after=null}={}){
 if(env.OPERATIONAL_CONTINUITY_ENABLED!=='true')failure('CONTINUITY_DISABLED',503);
 if(!validDay(day))failure('CONTINUITY_DAY_INVALID');
 const auth=authority(env,uid),stored=await (await internal(auth,'continuity-profile-get',{now})).json();
 if(stored.revoked)failure('CONTINUITY_ACCESS_DENIED',403);
 if(!stored.profile)failure('CONTINUITY_PROFILE_MISSING',503);
 const profile=validateContinuityProfile(stored.profile,now);if(profile.uid!==uid||!profile.profile.active||!profile.profile.access)failure('CONTINUITY_ACCESS_DENIED',403);
 const actor={...channelActorFromProfile(uid,profile.profile,now),fromContinuity:true};actor.expiresAt=Math.min(actor.expiresAt,profile.verifiedAt+CONTINUITY_MAX_AGE_MS);
 const granted=await internal(auth,'put',{actor,now});if(!granted.ok)return granted;
 const recovery=await (await internal(auth,'continuity-recover',{now,after})).json();
 if(recoverOnly)return response({code:'CONTINUITY_RECOVERY',...recovery});
 const {resources}=await (await internal(state(env),'continuity-resource-get',{day,now})).json();
 const entries=continuityEntriesForActor(profile,resources,{day,now});
 const payload={code:'CONTINUITY_READY',profile:profile.profile,profileVerifiedAt:profile.verifiedAt,authorizedUntil:actor.expiresAt,entries,...recovery};
 if(JSON.stringify(payload).length>CONTINUITY_MAX_BODY_BYTES)failure('CONTINUITY_BOOTSTRAP_TOO_LARGE',507);
 return response(payload);
}
export async function recordContinuitySubmission(env,actor,submission){
 if(env.OPERATIONAL_CONTINUITY_ENABLED!=='true')return;
 const operation={uid:actor.uid,requestId:submission.requestId,collection:submission.collection,day:submission.record.date,data:submission.data,createdAt:Date.parse(submission.record.createdAt)};
 const result=await internal(authority(env,actor.uid),'continuity-journal-put',{operation});if(!result.ok){const value=await result.json();failure(value.code,result.status);}
 const indexed=await internal(state(env),'continuity-pending-put',{operation});if(!indexed.ok)failure('CONTINUITY_JOURNAL_UNAVAILABLE',503);
}
export async function setContinuityOperationState(env,uid,requestId,newState){
 if(env.OPERATIONAL_CONTINUITY_ENABLED!=='true')return;
 const result=await internal(authority(env,uid),'continuity-journal-state',{requestId,state:newState});if(!result.ok)failure('CONTINUITY_JOURNAL_UNAVAILABLE',503);
 const indexed=await internal(state(env),'continuity-pending-state',{uid,requestId,state:newState});if(!indexed.ok)failure('CONTINUITY_JOURNAL_UNAVAILABLE',503);
}
export async function recordContinuityCommit(env,collection,day,fields,now){
 if(env.OPERATIONAL_CONTINUITY_ENABLED!=='true')return;
 const result=await internal(state(env),'continuity-commit',{collection,day,fields,now});
 if(!result.ok)failure('CONTINUITY_SNAPSHOT_UNAVAILABLE',503);
}
