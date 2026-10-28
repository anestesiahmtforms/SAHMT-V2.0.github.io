import {isDosimetryYear,validateDosimetryRecord} from '../src/dosimetry-domain.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const email=v=>String(v||'').trim().toLowerCase();
export function createDosimetryService({store}={}){
 if(!store?.transaction)throw Error('DOSIMETRY_STORE_REQUIRED');
 return {async execute(action,input,identity){
  if(action!=='GET_OWN'||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!isDosimetryYear(input.year))fail('DOSIMETRY_INVALID_INPUT');
  if(!identity?.uid||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(identity.uid)||identity.emailVerified!==true||identity.provider!=='google.com'||!email(identity.email).includes('@'))fail('DOSIMETRY_UNAUTHENTICATED',401);
  return store.transaction(async tx=>{
   const profile=await tx.get('users',identity.uid);
   if(!profile||profile.uid!==identity.uid||email(profile.email)!==email(identity.email)||profile.active!==true||profile.access!==true)fail('DOSIMETRY_FORBIDDEN',403);
   const raw=await tx.get('occupationalDosimetry',`${identity.uid}_${input.year}`);
   if(!raw)return {year:input.year,record:null};
   let record;try{record=validateDosimetryRecord(raw);}catch{fail('DOSIMETRY_RECORD_UNAVAILABLE',503);}
   if(record.year!==input.year||record.uid!==identity.uid||email(record.email)!==email(identity.email))fail('DOSIMETRY_RECORD_UNAVAILABLE',503);
   return {year:input.year,record:{sourceName:record.sourceName,issuedOn:record.issuedOn,year:record.year,unit:record.unit,quantity:record.quantity,monitorType:record.monitorType,months:record.months}};
  });
 }};
}
