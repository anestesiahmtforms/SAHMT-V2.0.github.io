import {validateProfessionalAnswers,legacyProfessionalAnswers,REGISTRATION_CYCLE} from '../src/registration-domain.js';
import {assignedInstitutionalGroup,institutionalAssignmentKey,researchGroup} from '../src/institutional-group.js';
import {assertFolderReadable} from '../server/folder-read-policy.js';
import {SURVEY_ACTIVITIES} from '../communication/obligations.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const validUid=uid=>typeof uid==='string'&&/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(uid);
const registrationActivity=Object.freeze({kind:'SURVEY',id:'professional',title:SURVEY_ACTIVITIES.professional,cycle:REGISTRATION_CYCLE});
const institutionalMailbox=email=>/^anestesiahmtforms(?:[2-5])?@gmail\.com$/i.test(email);
export const registrationAdmin=p=>p?.role==='administrador_app'||p?.permissions?.admin===true;
const linkedProfile=(profile,{uid,email})=>Boolean(profile&&profile.uid===uid&&profile.email?.trim().toLowerCase()===email.trim().toLowerCase()&&profile.active===true&&profile.access===true);
const canSaveRegistration=(profile,affiliation,email)=>Boolean(researchGroup(affiliation))&&
 (affiliation==='team'||registrationAdmin(profile))&&!institutionalMailbox(email);
export async function registrationActor(store,identity,{admin=false,team=false}={}){
 if(!identity?.uid||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(identity.uid)||identity.provider!=='google.com'||identity.emailVerified!==true||!/^\S+@\S+\.\S+$/.test(identity.email||''))fail('REGISTRATION_UNAUTHENTICATED',401);
 const p=await store.get('users',identity.uid);if(!linkedProfile(p,identity)||admin&&!registrationAdmin(p))fail('REGISTRATION_FORBIDDEN',403);
 if(team&&!registrationAdmin(p)){const assignment=await store.get('userCategories',await institutionalAssignmentKey(identity.email));if(assignedInstitutionalGroup(assignment,identity)!=='team')fail('REGISTRATION_FORBIDDEN',403);}
 return p;
}

async function registrationAvailable(store) {
 const policy=await store.get('runtimePolicy','folders');
 if(policy===null)return true; // Same policy as the existing professional registration route.
 try {assertFolderReadable(policy,'consultas/cadastro-profissional');return true;}
 catch(error){if(error.code==='FOLDER_DISABLED')return false;throw error;}
}

async function ownRegistrationComplete(store,{uid,email}) {
 const record=await store.get('professionalRegistrations',uid+'_'+REGISTRATION_CYCLE);
 if(!record)return false;
 if(record.uid!==uid||record.email!==email.toLowerCase()||record.cycle!==REGISTRATION_CYCLE||
    !Number.isSafeInteger(record.version)||record.version<1||record.truth!==true)fail('REGISTRATION_UNAVAILABLE',503);
 return true;
}

export const professionalObligationActions=new Set(['OBLIGATION_CATALOG','OBLIGATION_ELIGIBILITY','OBLIGATION_STATUS']);

async function registrationObligation(store,action,input,identity) {
 const catalog=action==='OBLIGATION_CATALOG',eligibility=action==='OBLIGATION_ELIGIBILITY';
 if(!exact(input,catalog?[]:['survey','cycle',...(eligibility?['recipients']:[])])||
    !catalog&&(input.survey!==registrationActivity.id||input.cycle!==registrationActivity.cycle))fail('REGISTRATION_INVALID_INPUT');
 if(eligibility&&(!Array.isArray(input.recipients)||input.recipients.length>8||
    input.recipients.some(person=>!exact(person,['uid','email'])||!validUid(person.uid)||
      typeof person.email!=='string'||person.email.length>254||!/^\S+@\S+\.\S+$/.test(person.email.trim()))||
    new Set(input.recipients.map(person=>person.uid)).size!==input.recipients.length))fail('REGISTRATION_INVALID_INPUT');
 return store.transaction(async tx=>{
  const profile=await registrationActor(tx,identity,{admin:catalog||eligibility});
  if(catalog)return {items:await registrationAvailable(tx)?[registrationActivity]:[]};
  if(!eligibility){
   if(await ownRegistrationComplete(tx,identity))return {completed:true};
   const assignment=await tx.get('userCategories',await institutionalAssignmentKey(identity.email));
   if(!canSaveRegistration(profile,assignedInstitutionalGroup(assignment,identity),identity.email))
    return {completed:false,unavailable:true,reason:'REGISTRATION_FORBIDDEN'};
   if(!await registrationAvailable(tx))return {completed:false,unavailable:true,reason:'REGISTRATION_FOLDER_DISABLED'};
   return {completed:false};
  }
  const available=await registrationAvailable(tx),eligibleUids=[],excluded=[];
  for(const recipient of input.recipients){
   const email=recipient.email.trim().toLowerCase();
   const assignment=available?await tx.get('userCategories',await institutionalAssignmentKey(email)):null;
   const uid=assignment?.uid;
   const member=validUid(uid)?await tx.get('users',uid):null;
   if(available&&linkedProfile(member,{uid,email})&&canSaveRegistration(member,assignedInstitutionalGroup(assignment,{uid,email}),email))
    eligibleUids.push(recipient.uid);
   else excluded.push({uid:recipient.uid,reason:available?'REGISTRATION_FORBIDDEN':'REGISTRATION_FOLDER_DISABLED'});
  }
  return {eligibleUids,excluded};
 });
}
export function createProfessionalRegistrationService({store,drive,now=Date.now}={}){
 return {async execute(action,input,identity){
  if(professionalObligationActions.has(action))return registrationObligation(store,action,input,identity);
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
   if(affiliation!=='team'&&!registrationAdmin(current))fail('REGISTRATION_FORBIDDEN',403);
   if(record&&(record.uid!==identity.uid||record.email!==identity.email.toLowerCase()||record.cycle!==REGISTRATION_CYCLE||!Number.isSafeInteger(record.version)))fail('REGISTRATION_UNAVAILABLE',503);
   if(action==='BOOTSTRAP')return {record,isAdmin:registrationAdmin(current),profile:{email:identity.email.toLowerCase(),displayName:current.displayName||current.name||'',group}};
   if(!group||institutionalMailbox(identity.email))fail('REGISTRATION_GROUP_UNAVAILABLE',422);
   if((record?.version||0)!==input.expectedVersion)fail('REGISTRATION_VERSION_CONFLICT',409);
   const schemaVersion=Array.isArray(answers.surgicalAreas)?2:1;
   if(record?.schemaVersion===2&&schemaVersion===1)fail('REGISTRATION_SCHEMA_CHANGED',409);
   const legacyAnswers=record?.legacyAnswers||legacyProfessionalAnswers(record?.answers);
   const saved={schemaVersion,cycle:REGISTRATION_CYCLE,uid:identity.uid,email:identity.email.toLowerCase(),group,answers,
    ...(schemaVersion===2&&Object.keys(legacyAnswers).length?{legacyAnswers}:{}),
    truth:true,version:input.expectedVersion+1,createdAt:record?.createdAt||now(),updatedAt:now()};
   if(record)tx.set('professionalRegistrations',ownId,saved);else tx.create('professionalRegistrations',ownId,saved);return {record:saved};
  });
  if(action==='BOOTSTRAP')result.drive=await drive?.status(identity)||{connected:false,canConnect:registrationAdmin(profile)};
  return result;
 }};
}
