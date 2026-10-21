import {validId,validDay,channelActorFromProfile,channelCan,canReadChannelRecord} from './provisional-channel-contract.js';
import {offlineOperationalCacheId} from './offline-operational-snapshot.js';

export const CONTINUITY_MAX_AGE_MS=7*86400000;
export const CONTINUITY_MAX_BODY_BYTES=524288;
export const CONTINUITY_KINDS=Object.freeze(['appConfig','stations','contacts','eventMembers','eventCatalogs','labelStaff','vacations','scheduleDays','events','labels','checklists']);
const roles=new Set(['','coordenador','conselho_diretor','gestor','anestesiologista','residente','temporario','administrador_app']);
const fail=code=>{throw Object.assign(Error(code),{code,status:400});};
const requireValue=(condition,code='CONTINUITY_SNAPSHOT_INVALID')=>{if(!condition)fail(code);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fresh=(at,now)=>Number.isSafeInteger(at)&&Number.isSafeInteger(now)&&at<=now&&now-at<=CONTINUITY_MAX_AGE_MS;
const text=(value,max)=>typeof value==='string'&&value.length<=max;
function safeTree(value,depth=0){
 requireValue(depth<=16);
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 if(typeof value==='string'){requireValue(value.length<=12000);return;}
 if(Array.isArray(value)){requireValue(value.length<=2000);for(const row of value)safeTree(row,depth+1);return;}
 requireValue(object(value)&&Object.keys(value).length<=150);
 for(const [key,item] of Object.entries(value)){requireValue(!['__proto__','constructor','prototype'].includes(key)&&(!/token|secret|password|credential|apiKey/i.test(key)||key==='tokenSigla'));safeTree(item,depth+1);}
}
export function validateContinuityProfile(value,now=Date.now()){
 requireValue(object(value)&&value.schemaVersion===1&&validId(value.uid)&&fresh(value.verifiedAt,now),'CONTINUITY_PROFILE_EXPIRED_OR_INVALID');
 const profile=value.profile;
 requireValue(object(profile)&&profile.uid===value.uid&&typeof profile.active==='boolean'&&typeof profile.access==='boolean'&&roles.has(profile.role||'')&&object(profile.permissions),'CONTINUITY_PROFILE_INVALID');
 requireValue(Object.keys(profile.permissions).length<=100&&Object.entries(profile.permissions).every(([key,permission])=>/^[a-zA-Z][a-zA-Z0-9]{0,69}$/.test(key)&&typeof permission==='boolean'),'CONTINUITY_PERMISSIONS_INVALID');
 for(const [key,max] of [['displayName',120],['email',254],['sigla',20],['phone',50]])requireValue(profile[key]===undefined||text(profile[key],max),'CONTINUITY_PROFILE_INVALID');
 return {schemaVersion:1,uid:value.uid,verifiedAt:value.verifiedAt,profile:{uid:value.uid,displayName:profile.displayName||'',email:profile.email||'',sigla:String(profile.sigla||'').trim().toUpperCase(),phone:profile.phone||'',role:profile.role||'',active:profile.active,access:profile.access,permissions:{...profile.permissions}}};
}
export function validateContinuityResource(value,now=Date.now()){
 requireValue(object(value)&&value.schemaVersion===1&&CONTINUITY_KINDS.includes(value.kind)&&text(value.id,100)&&value.id.length>0&&text(value.revision,128)&&value.revision.length>0&&fresh(value.verifiedAt,now)&&value.complete!==false);
 safeTree(value.data);
 requireValue(JSON.stringify(value.data).length<=180000);
 const arrays=['stations','contacts','eventMembers','labelStaff','vacations'];
 if(arrays.includes(value.kind))requireValue(Array.isArray(value.data));
 else requireValue(object(value.data));
 if(['scheduleDays','vacations'].includes(value.kind))requireValue(validDay(value.id));
 if(['events','labels','checklists'].includes(value.kind)){
  requireValue((validDay(value.id)||/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.id))&&Array.isArray(value.data.records)&&!value.data.hasMore&&!value.data.truncated);
  for(const record of [...value.data.records,...(value.data.priorRecords||[])])requireValue(object(record)&&validId(record.id)&&validDay(record.date)&&!record.pendingFirestore&&!record.pendingSync&&!record.hasPendingWrites&&!record.provisionalShared);
 }
 if(value.kind==='appConfig')requireValue(value.id==='app'&&object(value.data.features));
 if(['stations','eventMembers','labelStaff'].includes(value.kind))requireValue(value.id==='all');
 if(value.kind==='contacts')requireValue(value.id==='active');
 if(value.kind==='eventCatalogs')requireValue(value.id==='operational');
 return {schemaVersion:1,kind:value.kind,id:value.id,data:structuredClone(value.data),verifiedAt:value.verifiedAt,revision:value.revision,complete:true};
}
function allowedResource(kind,actor){
 const permissions={appConfig:['scheduleRead','eventsRead','eventsWrite','labelsRead','labelsWrite','labelsManage','checklistRead','checklistWrite','checklistSign'],stations:['checklistRead','checklistWrite','checklistSign'],
  contacts:['scheduleRead','eventsRead','eventsWrite','checklistRead','checklistSign'],vacations:['scheduleRead','eventsRead','eventsWrite','checklistSign'],scheduleDays:['scheduleRead','scheduleWrite','eventsRead','eventsWrite','checklistRead','checklistSign'],
  eventMembers:['eventsRead','eventsWrite'],eventCatalogs:['eventsRead','eventsWrite'],labelStaff:['labelsRead','labelsWrite','labelsManage'],events:['eventsRead','eventsWrite'],labels:['labelsRead','labelsWrite','labelsManage'],checklists:['checklistRead','checklistWrite','checklistSign']};
 return (permissions[kind]||[]).some(permission=>channelCan(actor,permission));
}
export function continuityEntriesForActor(profileEnvelope,resources,{day,now=Date.now()}={}){
 const profile=validateContinuityProfile(profileEnvelope,now),actor=channelActorFromProfile(profile.uid,profile.profile,now);
 requireValue(actor.active&&actor.access,'CONTINUITY_ACCESS_DENIED');requireValue(validDay(day)&&Array.isArray(resources)&&resources.length<=160);
 const entries=new Map(),validated=resources.map(value=>validateContinuityResource(value,now));
 const put=(resource,kind,id,data)=>{const key=kind+':'+id;if((entries.get(key)?.verifiedAt||0)>resource.verifiedAt)return;entries.set(key,{kind,id,data,verifiedAt:resource.verifiedAt,revision:resource.revision});};
 const reportRows=new Map();
 for(const resource of [...validated].sort((a,b)=>a.verifiedAt-b.verifiedAt)){
  if(!['events','labels','checklists'].includes(resource.kind))continue;
  const rows=reportRows.get(resource.kind)||new Map(),covers=date=>validDay(resource.id)?date===resource.id:date?.startsWith(resource.id+'-');
  for(const [id,record] of rows)if(covers(record.date))rows.delete(id);
  for(const record of resource.data.records)rows.set(record.id,record);
  reportRows.set(resource.kind,rows);
 }
 for(const input of validated){
  const resource={...input,data:['events','labels','checklists'].includes(input.kind)?{...input.data,records:[...reportRows.get(input.kind).values()].filter(row=>validDay(input.id)?row.date===input.id:row.date.startsWith(input.id+'-'))}:input.data};
  const {kind,id,data}=resource;if(!allowedResource(kind,actor))continue;
  if(!['events','labels','checklists'].includes(kind)){put(resource,kind,id,data);continue;}
  const rows=data.records.filter(row=>row.active!==false&&canReadChannelRecord(kind,row,actor));
  if(kind==='checklists'){
   put(resource,kind,validDay(id)?id:'month:'+id,{...data,records:rows});continue;
  }
  const broad=kind==='events'?channelCan(actor,'admin'):channelCan(actor,'labelsManage');
  const visibility=broad?'admin':actor.sigla||'uid:'+actor.uid;
  const month=id.slice(0,7),[year,number]=month.split('-').map(Number),last=String(new Date(Date.UTC(year,number,0)).getUTCDate()).padStart(2,'0');
  const periods=validDay(id)?[[id,id]]:[[month+'-01',month+'-'+last],[day,day]];
  for(const [from,to] of periods){
   const visible=rows.filter(row=>row.date>=from&&row.date<=to).sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
   for(const limit of kind==='labels'?[50,100]:[100])put(resource,kind,`report:${from}:${to}:${visibility}:${limit}`,{records:visible.slice(0,limit),hasMore:visible.length>limit});
   if(from===to)put(resource,'offlineOperational',offlineOperationalCacheId(kind,from,{sigla:actor.sigla,isAdmin:broad,canManage:broad}),{records:visible.slice(0,100)});
  }
 }
 return [...entries.values()];
}
