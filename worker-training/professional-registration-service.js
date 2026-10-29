import {validateProfessionalAnswers,REGISTRATION_CYCLE} from '../src/registration-domain.js';
import {assignedInstitutionalGroup,institutionalAssignmentKey,researchGroup} from '../src/institutional-group.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const registrationAdmin=p=>p?.role==='administrador_app'||p?.permissions?.admin===true;
export async function registrationActor(store,identity,{admin=false}={}){
 if(!identity?.uid||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(identity.uid)||identity.provider!=='google.com'||identity.emailVerified!==true||!/^\S+@\S+\.\S+$/.test(identity.email||''))fail('REGISTRATION_UNAUTHENTICATED',401);
 const p=await store.get('users',identity.uid);if(!p||p.uid!==identity.uid||p.email?.trim().toLowerCase()!==identity.email.trim().toLowerCase()||p.active!==true||p.access!==true||admin&&!registrationAdmin(p))fail('REGISTRATION_FORBIDDEN',403);return p;
}
export function createProfessionalRegistrationService({store,drive,now=Date.now}={}){
 return {async execute(action,input,identity){
  const profile=await registrationActor(store,identity);const ownId=identity.uid+'_'+REGISTRATION_CYCLE;
  if(action==='LIST'){
   if(!exact(input,[]))fail('REGISTRATION_INVALID_INPUT');await registrationActor(store,identity,{admin:true});const rows=await store.list('professionalRegistrations',[{field:'cycle',op:'EQUAL',value:REGISTRATION_CYCLE}],1000);await registrationActor(store,identity,{admin:true});return {rows:rows.map(r=>({uid:r.uid,email:r.email,fullName:r.answers?.fullName||'',group:r.group,version:r.version,updatedAt:r.updatedAt}))};
  }
  if(action==='DETAIL'){
   if(!exact(input,['uid'])||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(input.uid))fail('REGISTRATION_INVALID_INPUT');await registrationActor(store,identity,{admin:true});const record=await store.get('professionalRegistrations',input.uid+'_'+REGISTRATION_CYCLE);if(record&&(record.uid!==input.uid||record.cycle!==REGISTRATION_CYCLE))fail('REGISTRATION_UNAVAILABLE',503);await registrationActor(store,identity,{admin:true});return {record};
  }
  if(!['BOOTSTRAP','SAVE'].includes(action)||!exact(input,action==='BOOTSTRAP'?[]:['expectedVersion','answers','truth']))fail('REGISTRATION_INVALID_INPUT');
  let answers;if(action==='SAVE'){if(input.truth!==true||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)fail('REGISTRATION_INVALID_INPUT');answers=validateProfessionalAnswers(input.answers);}
  const result=await store.transaction(async tx=>{
   const current=await registrationActor(tx,identity),assignment=await tx.get('userCategories',await institutionalAssignmentKey(identity.email)),affiliation=assignedInstitutionalGroup(assignment,identity),group=researchGroup(affiliation),record=await tx.get('professionalRegistrations',ownId);
   if(record&&(record.uid!==identity.uid||record.email!==identity.email.toLowerCase()||record.cycle!==REGISTRATION_CYCLE||!Number.isSafeInteger(record.version)))fail('REGISTRATION_UNAVAILABLE',503);
   if(action==='BOOTSTRAP')return {record,isAdmin:registrationAdmin(current),profile:{email:identity.email.toLowerCase(),displayName:current.displayName||current.name||'',group}};
   if(!group||/^anestesiahmtforms(?:[2-5])?@gmail\.com$/i.test(identity.email))fail('REGISTRATION_GROUP_UNAVAILABLE',422);
   if((record?.version||0)!==input.expectedVersion)fail('REGISTRATION_VERSION_CONFLICT',409);
   const saved={schemaVersion:1,cycle:REGISTRATION_CYCLE,uid:identity.uid,email:identity.email.toLowerCase(),group,answers,truth:true,version:input.expectedVersion+1,createdAt:record?.createdAt||now(),updatedAt:now()};if(record)tx.set('professionalRegistrations',ownId,saved);else tx.create('professionalRegistrations',ownId,saved);return {record:saved};
  });
  if(action==='BOOTSTRAP')result.drive=await drive?.status(identity)||{connected:false,canConnect:registrationAdmin(profile)};
  return result;
 }};
}
