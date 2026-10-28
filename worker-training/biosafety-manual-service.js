import {validateManualRecord} from '../src/biosafety-manual-policy.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const email=value=>String(value||'').trim().toLowerCase();
export function createBiosafetyManualService({store}={}){
 if(!store?.transaction)throw Error('MANUAL_STORE_REQUIRED');
 return {async execute(action,input,identity){
  if(action!=='GET_MANUAL'||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)fail('MANUAL_INVALID_INPUT');
  if(!identity?.uid||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(identity.uid)||identity.emailVerified!==true||identity.provider!=='google.com'||!email(identity.email).includes('@'))fail('MANUAL_UNAUTHENTICATED',401);
  return store.transaction(async tx=>{
   const profile=await tx.get('users',identity.uid);
   if(!profile||profile.uid!==identity.uid||email(profile.email)!==email(identity.email)||profile.active!==true||profile.access!==true)fail('MANUAL_FORBIDDEN',403);
   const raw=await tx.get('institutionalBiosafetyManuals','hmt');if(!raw)fail('MANUAL_NOT_FOUND',404);
   let record;try{record=await validateManualRecord(raw);}catch{fail('MANUAL_UNAVAILABLE',503);}
   return {title:record.title,documentCode:record.documentCode,revision:record.revision,issuedOn:record.issuedOn,html:record.html};
  });
 }};
}
