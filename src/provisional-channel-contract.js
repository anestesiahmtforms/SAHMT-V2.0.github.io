import {updateScheduleReleaseState} from './schedule-release.js';
export const CHANNEL_COLLECTIONS = Object.freeze(['events', 'labels', 'checklists', 'scheduleReleases']);
export const CHANNEL_PERMISSIONS = Object.freeze(['admin','scheduleRead','scheduleWrite','checklistSign','eventsRead','eventsWrite','labelsRead','labelsWrite','labelsManage','checklistRead','checklistWrite']);
export const CHANNEL_GRANT_MS = 24 * 60 * 60 * 1000;
export const channelError = (code, status = 400) => Object.assign(new Error(code), {code, status});
const requireValue = (condition, code, status) => {if (!condition) throw channelError(code, status);};
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(0,4)) > 0 && Number.isFinite(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10) === day;
}
export const channelDay = now => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(now);
export function channelActorFromProfile(uid, profile, now = Date.now()) {
  requireValue(validId(uid) && profile && typeof profile === 'object' && !Array.isArray(profile), 'CHANNEL_PROFILE_INVALID',403);
  const permissions = {};
  const admin = profile.role === 'administrador_app' || profile.permissions?.admin === true;
  for (const key of CHANNEL_PERMISSIONS) permissions[key] = admin || profile.permissions?.[key] === true;
  return {uid, displayName:String(profile.displayName || '').slice(0,120), sigla:String(profile.sigla || '').trim().toUpperCase().slice(0,20),
    active:profile.active === true, access:profile.access === true, permissions, verifiedAt:now, expiresAt:now + CHANNEL_GRANT_MS};
}
export function parseChannelPolicy(raw, now = Date.now()) {
  let value; try {value = JSON.parse(raw);} catch {throw channelError('CHANNEL_POLICY_MISSING',503);}
  requireValue(value?.schemaVersion === 1 && value.projectId === 'sahmt-17a16' && Array.isArray(value.users) && value.users.length <= 200 &&
    Number.isSafeInteger(value.issuedAt) && Number.isSafeInteger(value.expiresAt) && value.issuedAt <= now &&
    value.expiresAt > now && value.expiresAt - value.issuedAt <= CHANNEL_GRANT_MS, 'CHANNEL_POLICY_EXPIRED_OR_INVALID',503);
  const users = new Map();
  for (const row of value.users) {
    requireValue(validId(row.uid) && !users.has(row.uid) && typeof row.displayName === 'string' && row.displayName.length <= 120 &&
      typeof row.sigla === 'string' && row.sigla.length <= 20 && typeof row.active === 'boolean' && typeof row.access === 'boolean' &&
      row.permissions && Object.keys(row.permissions).every(key => CHANNEL_PERMISSIONS.includes(key) && typeof row.permissions[key] === 'boolean'), 'CHANNEL_POLICY_INVALID',503);
    users.set(row.uid, {...row,verifiedAt:value.issuedAt,expiresAt:value.expiresAt});
  }
  return {users, expiresAt:value.expiresAt};
}
export function channelCan(actor, permission) {return actor?.active === true && actor?.access === true && (actor.permissions?.admin === true || actor.permissions?.[permission] === true);}
export function canReadChannelCollection(collection, actor) {
  const keys = {scheduleReleases:['scheduleRead','scheduleWrite','eventsRead','eventsWrite','checklistSign'],checklists:['checklistRead'],events:['eventsRead','eventsWrite'],labels:['labelsRead','labelsWrite','labelsManage']};
  return (keys[collection] || []).some(permission => channelCan(actor,permission));
}
export function canReadChannelRecord(collection, record, actor) {
  if (!canReadChannelCollection(collection,actor)) return false;
  if (collection === 'scheduleReleases' || collection === 'checklists') return true;
  if (collection === 'events') return channelCan(actor,'admin') || record.createdByUid === actor.uid || Boolean(actor.sigla && [record.memberSigla,record.scheduleSigla].includes(actor.sigla));
  return channelCan(actor,'labelsManage') || record.createdByUid === actor.uid || Boolean(actor.sigla && record.staffSiglas?.includes(actor.sigla));
}
export function canWriteChannel(collection, actor) {
  return CHANNEL_COLLECTIONS.includes(collection) && channelCan(actor,{events:'eventsWrite',labels:'labelsWrite',checklists:'checklistWrite',scheduleReleases:'scheduleWrite'}[collection]);
}
const fields = {
  scheduleReleases:['day','sigla','marked','groupSiglas','tokenSigla','occurredAt','expectedVersion'],
  events:['date','memberSigla','scheduleSigla','memberStatus','eventType','description','delayMultiple','substitute','shift','payer','creditor','amountToPay','status','createdByName','updatedByName'],
  labels:['date','patientName','procedureCode','encounterCode','type','amount','insurance','creditor','staffSiglas','consultation','status','createdByName','updatedByName'],
  checklists:['date','stationId','condition','status','occurrence','responsibleUid','responsibleName','responsibleEmail','createdByName']
};
const text = (value,max,required=false) => typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim()));
export function normalizeChannelSubmission(input, actor, now = Date.now()) {
  requireValue(input && Object.keys(input).every(key=>['collection','requestId','data','createdAt'].includes(key)) && CHANNEL_COLLECTIONS.includes(input.collection) && validId(input.requestId), 'CHANNEL_RECORD_INVALID');
  requireValue(canWriteChannel(input.collection,actor),'CHANNEL_WRITE_DENIED',403);
  const data = input.data,collection=input.collection,day=collection==='scheduleReleases'?data?.day:data?.date;
  requireValue(data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).every(key=>fields[collection].includes(key)) && validDay(day),'CHANNEL_RECORD_INVALID');
  const today=channelDay(now);
  requireValue(day <= today && Date.parse(today) - Date.parse(day) <= 7*86400000,'CHANNEL_DATE_INVALID');
  for (const [key,value] of Object.entries(data)) requireValue(value === null || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e13) ||
    text(value, ['description','occurrence'].includes(key)?2000:160) ||
    (['staffSiglas','groupSiglas'].includes(key) && Array.isArray(value) && value.length <= 30 && value.every(item=>/^(?:[A-Z]{2}|L2)$/.test(item))), 'CHANNEL_FIELD_INVALID');
  if(collection==='scheduleReleases') {
    try {updateScheduleReleaseState([],data);} catch {throw channelError('CHANNEL_RELEASE_INVALID');}
    requireValue((data.expectedVersion===undefined||Number.isSafeInteger(data.expectedVersion)&&data.expectedVersion>=0) && Number.isSafeInteger(data.occurredAt) && data.occurredAt > 0 && data.occurredAt <= now + 60000,'CHANNEL_RELEASE_INVALID');
  }
  if(collection==='checklists') requireValue(validId(data.stationId) && ['SIM','NAO'].includes(data.condition) && text(data.occurrence,500) && (data.condition!=='SIM'||data.occurrence==='') &&
    (data.condition!=='NAO'||data.occurrence.trim()) && data.status===(data.condition==='SIM'?'COMPLETED':'MAINTENANCE') &&
    ['responsibleUid','responsibleName','responsibleEmail'].every(key=>data[key]===null),'CHANNEL_CHECKLIST_INVALID');
  if(collection==='labels') requireValue(text(data.patientName,160,true) && text(data.encounterCode,80,true) && text(data.procedureCode,80) &&
    text(data.insurance,120) && ['Particular','Complementação','Convênio','Consulta Pré-anestésica','SADT'].includes(data.type) &&
    ['Caixa','Plantão','Plantão/Caixa'].includes(data.creditor) && (data.amount===null||Number.isFinite(data.amount)&&data.amount>=0) &&
    Array.isArray(data.staffSiglas) && data.staffSiglas.length<=20 && (data.creditor==='Caixa'?data.staffSiglas.length===0:data.staffSiglas.length>0) &&
    data.consultation===(data.type==='Consulta Pré-anestésica') && data.status==='CONFIRMED','CHANNEL_LABEL_INVALID');
  if(collection==='events') requireValue(text(data.eventType,160,true) && text(data.description,2000) &&
    (data.delayMultiple===null || Number.isFinite(data.delayMultiple)&&data.delayMultiple>=0) && Number.isFinite(data.amountToPay)&&data.amountToPay>=0 &&
    ['memberSigla','scheduleSigla','memberStatus','substitute','shift','payer','creditor','status'].every(key=>text(data[key],160)), 'CHANNEL_EVENT_INVALID');
  // Author fields are derived from the trusted profile, never from browser claims.
  const normalized = collection==='scheduleReleases'?{...data}:collection==='checklists'?{...data,createdByName:actor.displayName}:{...data,createdByName:actor.displayName,updatedByName:actor.displayName};
  const createdAt = Number.isSafeInteger(input.createdAt) && input.createdAt > 0 && input.createdAt <= now + 60000 ? input.createdAt : now;
  const record={...normalized,date:day,id:input.requestId,clientMutationId:input.requestId,createdByUid:actor.uid,updatedByUid:actor.uid,
    createdByName:actor.displayName,updatedByName:actor.displayName,createdAt:new Date(createdAt).toISOString(),updatedAt:new Date(now).toISOString(),
    receivedAt:now,version:1,active:true,provisionalShared:true,pendingFirestore:true,pendingSync:collection==='checklists'};
  return {collection,requestId:input.requestId,data:normalized,record};
}
export function mergeSharedChannelRecords(kind, remote = [], shared = []) {
  const officialIds=new Set(remote.filter(row=>!row.provisionalShared && !row.pendingFirestore && !row.pendingSync && !row.hasPendingWrites)
    .flatMap(row=>[row.id,row.clientMutationId,row.lastRequestId].filter(Boolean)));
  const rows=new Map(remote.map(row=>[row.id,row]));
  for(const record of shared) if(record?.provisionalShared===true && validId(record.id) && !officialIds.has(record.id)) {
    const existing=rows.get(record.id);
    if(!existing)rows.set(record.id,{...record,pendingFirestore:true,pendingSync:kind==='checklists'});
    else if(existing.pendingFirestore||existing.pendingSync)rows.set(record.id,{...existing,provisionalShared:true});
  }
  return [...rows.values()].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || Date.parse(b.createdAt)-Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}
