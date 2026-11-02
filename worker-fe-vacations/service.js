import {vacationSlot,vacationSigla,vacationOverlap} from '../src/vacations-2027-domain.js';
import {vacationHash,assertVacationSnapshot} from './snapshot.js';
export {vacationHash} from './snapshot.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export const vacationAdmin=p=>p?.role==='administrador_app'||p?.permissions?.admin===true;
export function createVacationService({store,now=Date.now}){
 async function actor(identity,tx=store){
  if(!identity?.uid||identity.emailVerified!==true||identity.provider!=='google.com'||typeof identity.email!=='string')fail('VACATIONS_FORBIDDEN',403);
  const p=await tx.get('users',identity.uid);
  if(!p||p.uid!==identity.uid||p.email?.trim().toLowerCase()!==identity.email.trim().toLowerCase()||p.active!==true||p.access!==true)fail('VACATIONS_FORBIDDEN',403);
  return p;
 }
 async function load(identity){
  const [profile,raw,binding,settings]=await Promise.all([actor(identity),store.get('vacations2027Schedules','current'),store.get('vacations2027Identities',await vacationHash(identity.email.trim().toLowerCase())),store.get('vacations2027Settings','current')]);
  const data=assertVacationSnapshot(raw);
  return {status:'READY',storage:'FIRESTORE',finalized:true,changeRequestUrl:settings?.schemaVersion===1&&settings.contactSigla==='FR'&&/^https:\/\/wa\.me\/55\d{10,11}$/.test(settings.changeRequestUrl||'')?settings.changeRequestUrl:null,
   isAdmin:vacationAdmin(profile),ownSigla:binding?.schemaVersion===1&&binding.email===identity.email.trim().toLowerCase()&&data.siglas.includes(binding.sigla)?binding.sigla:null,version:data.version,revision:data.revision,months:data.months,siglas:data.siglas,rules:data.rules};
 }
 return {async execute(action,input,identity){
  if(!identity?.uid||identity.emailVerified!==true||identity.provider!=='google.com'||typeof identity.email!=='string')fail('VACATIONS_FORBIDDEN',403);
  if(action==='LOAD'&&exact(input,[]))return load(identity);
  const profile=await actor(identity);if(!vacationAdmin(profile))fail('VACATIONS_FORBIDDEN',403);
  if(action==='REFRESH'&&exact(input,[]))return load(identity);
  if(action==='AUDIT'&&exact(input,[])){const history=await store.get('vacations2027History','current');return {rows:(history?.rows||[]).slice(0,200)};}
  if(action!=='UPDATE'||!exact(input,['changes','justification','expectedVersion','operationId']))fail('VACATIONS_INPUT_INVALID');
  const {changes,justification,expectedVersion,operationId}=input;
  if(!Array.isArray(changes)||changes.length<1||changes.length>2||new Set(changes.map(c=>c?.slotId)).size!==changes.length||changes.some(c=>!exact(c,['slotId','value'])||!vacationSlot(c.slotId)||typeof c.value!=='string'||c.value.length>120||/[\x00-\x1f]/.test(c.value))||typeof justification!=='string'||justification.trim().length<3||justification.length>1000||!/^[a-f0-9]{64}$/.test(expectedVersion)||!/^[a-f0-9-]{36}$/.test(operationId))fail('VACATIONS_INPUT_INVALID');
  const payloadHash=await vacationHash(input);
  const replayed=await store.transaction(async tx=>{
   if(!vacationAdmin(await actor(identity,tx)))fail('VACATIONS_FORBIDDEN',403);
   const [raw,receipt,history]=await Promise.all([tx.get('vacations2027Schedules','current'),tx.get('vacations2027Operations',operationId),tx.get('vacations2027History','current')]);
   if(receipt){if(receipt.payloadHash!==payloadHash||receipt.actorUid!==identity.uid)fail('VACATIONS_CONFLICT',409);if(receipt.status==='CONFIRMED')return true;fail('VACATIONS_PENDING',409);}
   const data=assertVacationSnapshot(raw);if(data.version!==expectedVersion)fail('VACATIONS_CONFLICT',409);
   if(changes.some(c=>c.value.trim()&&!data.siglas.includes(vacationSigla(c.value))))fail('VACATIONS_INPUT_INVALID');
   const months=structuredClone(data.months),rows=[],at=new Date(now()).toISOString();
   for(const change of changes){const where=vacationSlot(change.slotId),week=months.find(m=>m.id===where.month).weeks[where.week],slot=week.slots[where.slot],previousValue=slot.value;if(previousValue===change.value)continue;slot.value=change.value;week.overlapDays=vacationOverlap(week.slots.map(s=>s.value),data.rules);rows.push({at,type:'fe_admin_override',sigla:change.value,slot:change.slotId,result:'OK',justification:justification.trim(),actor:identity.email,actorUid:identity.uid,previousValue,operationId});}
   if(rows.length){const version=await vacationHash({months,rules:data.rules,siglas:data.siglas});tx.set('vacations2027Schedules','current',{...data,months,version,revision:data.revision+1,updatedAt:now()});tx.set('vacations2027History','current',{schemaVersion:2,rows:[...rows,...(history?.rows||[])].slice(0,200)});tx.create('vacations2027Audit',operationId,{schemaVersion:2,actorUid:identity.uid,actor:identity.email,at,revision:data.revision+1,rows});}
   tx.create('vacations2027Operations',operationId,{payloadHash,actorUid:identity.uid,status:'CONFIRMED',createdAt:now(),finishedAt:now(),storage:'FIRESTORE'});return false;
  });
  return {...await load(identity),saved:true,...(replayed?{replayed:true}:{})};
 }};
}
