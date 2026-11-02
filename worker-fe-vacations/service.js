import {vacationSchedule,vacationSlot,vacationSigla} from '../src/vacations-2027-domain.js';
export const vacationHash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export const vacationAdmin=p=>p?.role==='administrador_app'||p?.permissions?.admin===true;
export function createVacationService({store,sheets,now=Date.now}){
 async function actor(identity,tx=store){
  if(!identity?.uid||identity.emailVerified!==true||identity.provider!=='google.com'||typeof identity.email!=='string')fail('VACATIONS_FORBIDDEN',403);
  const p=await tx.get('users',identity.uid);
  if(!p||p.uid!==identity.uid||p.email?.trim().toLowerCase()!==identity.email.trim().toLowerCase()||p.active!==true||p.access!==true)fail('VACATIONS_FORBIDDEN',403);
  return p;
 }
 async function load(profile,identity){
  const data=await sheets.read(),parsed=vacationSchedule(data.values,data.rules),[binding,settings]=await Promise.all([store.get('vacations2027Identities',await vacationHash(identity.email.trim().toLowerCase())),store.get('vacations2027Settings','current')]);
  return {status:'READY',finalized:true,changeRequestUrl:settings?.schemaVersion===1&&settings.contactSigla==='FR'&&/^https:\/\/wa\.me\/55\d{10,11}$/.test(settings.changeRequestUrl||'')?settings.changeRequestUrl:null,isAdmin:vacationAdmin(profile),ownSigla:binding?.schemaVersion===1&&binding.email===identity.email.trim().toLowerCase()&&parsed.siglas.includes(binding.sigla)?binding.sigla:null,version:await vacationHash(data),...parsed};
 }
 return {async execute(action,input,identity){
  const profile=await actor(identity),admin=vacationAdmin(profile);
  if(action==='LOAD'&&exact(input,[]))return load(profile,identity);
  if(action==='AUDIT'&&exact(input,[])){if(!admin)fail('VACATIONS_FORBIDDEN',403);return {rows:await sheets.audit()};}
  if(action!=='UPDATE'||!exact(input,['changes','justification','expectedVersion','operationId']))fail('VACATIONS_INPUT_INVALID');
  if(!admin)fail('VACATIONS_FORBIDDEN',403);
  const {changes,justification,expectedVersion,operationId}=input;
  if(!Array.isArray(changes)||changes.length<1||changes.length>2||new Set(changes.map(c=>c?.slotId)).size!==changes.length||changes.some(c=>!exact(c,['slotId','value'])||!vacationSlot(c.slotId)||typeof c.value!=='string'||c.value.length>120||/[\x00-\x1f]/.test(c.value))||typeof justification!=='string'||justification.trim().length<3||justification.length>1000||!/^[a-f0-9]{64}$/.test(expectedVersion)||!/^[a-f0-9-]{36}$/.test(operationId))fail('VACATIONS_INPUT_INVALID');
  const payloadHash=await vacationHash(input),owner=operationId;
  const prior=await store.transaction(async tx=>{
   if(!vacationAdmin(await actor(identity,tx)))fail('VACATIONS_FORBIDDEN',403);
   const receipt=await tx.get('vacations2027Operations',operationId),lock=await tx.get('vacations2027Locks','sheet');
   if(receipt){if(receipt.payloadHash!==payloadHash||receipt.actorUid!==identity.uid)fail('VACATIONS_CONFLICT',409);if(receipt.status==='CONFIRMED')return true;fail('VACATIONS_PENDING',409);}
   if(lock?.until>now())fail('VACATIONS_BUSY',409);
   tx.set('vacations2027Locks','sheet',{owner,until:now()+180000});tx.create('vacations2027Operations',operationId,{payloadHash,actorUid:identity.uid,status:'PENDING',createdAt:now()});return false;
  });
  if(prior)return {...await load(profile,identity),saved:true,replayed:true};
  let status='FAILED';
  try{
   const data=await sheets.read();if(await vacationHash(data)!==expectedVersion)fail('VACATIONS_CONFLICT',409);
   const siglas=vacationSchedule(data.values,data.rules).siglas;
   if(changes.some(c=>c.value.trim()&&!siglas.includes(vacationSigla(c.value))))fail('VACATIONS_INPUT_INVALID');
   if(!vacationAdmin(await actor(identity)))fail('VACATIONS_FORBIDDEN',403);
   const updates=changes.map(c=>{const slot=vacationSlot(c.slotId);return {...c,slot,previousValue:String(data.values[slot.row-1]?.[slot.column-1]??'')};}).filter(c=>c.value!==c.previousValue);
   if(updates.length){status='PENDING';await sheets.update({updates,justification:justification.trim(),actor:identity,operationId,at:new Date(now()).toISOString()});}
   status='CONFIRMED';
  }finally{
   await store.transaction(async tx=>{const lock=await tx.get('vacations2027Locks','sheet'),receipt=await tx.get('vacations2027Operations',operationId);if(lock?.owner===owner)tx.set('vacations2027Locks','sheet',{owner,until:0});if(receipt)tx.set('vacations2027Operations',operationId,{...receipt,status,finishedAt:now()});});
  }
  return {...await load(profile,identity),saved:true};
 }};
}
