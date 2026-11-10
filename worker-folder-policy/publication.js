import {assertFolderReadable} from '../server/folder-read-policy.js';
import {operationalFolders,initialOperationalFolderPolicy} from '../src/operational-folders.js';

export const folderPolicyTargets=Object.freeze(['FG','FH','FI','FJ','FF','FC','FD','FE','FB']);
const fail=(code,status)=>Object.assign(Error(code),{code,status});
const conflict=()=>fail('FOLDER_POLICY_CONFLICT',409);
const ordered=values=>[...new Set(values)].sort();
function comparable(value) {
 if(Array.isArray(value))return value.map(comparable);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.keys(value).sort().map(key=>[key,comparable(value[key])]));
}
const equals=(left,right)=>JSON.stringify(comparable(left))===JSON.stringify(comparable(right));

function validate(policy) {
 // This probe is outside the registry. It checks document shape without evaluating a managed folder.
 assertFolderReadable(policy,'policy-probe');
 if(policy.disabled.some(id=>!Object.hasOwn(operationalFolders,id)))throw fail('FOLDER_POLICY_INVALID',503);
 return policy;
}
function parseRequest(input) {
 if(!input||typeof input!=='object'||!Number.isSafeInteger(input.revision)||input.revision<0)throw fail('FOLDER_POLICY_INPUT',400);
 if(input.resume===true&&Object.keys(input).length===2)return input;
 if(input.initialize===true&&input.revision===0&&Object.keys(input).length===2)return input;
 if(Object.keys(input).length!==3||typeof input.id!=='string'||!Object.hasOwn(operationalFolders,input.id)||typeof input.enabled!=='boolean')
  throw fail('FOLDER_POLICY_INPUT',400);
 return input;
}
const mayPublish=(profile,actor)=>profile?.uid===actor&&profile.active===true&&profile.access===true&&
 (profile.role==='administrador_app'||profile.permissions?.admin===true);

export async function inspectFolderPublication({store,actor}) {
 if(typeof actor!=='string'||!actor||!mayPublish(await store.profile(actor),actor))throw fail('FOLDER_POLICY_FORBIDDEN',403);
 const source=await store.read('FA');
 const policy=source?validate(source.value):initialOperationalFolderPolicy;
 const stations=await Promise.all(folderPolicyTargets.map(async station=>{
  try {
   const record=await store.read(station);
   if(!record)return {station,state:'missing'};
   let replica;
   try{replica=validate(record.value);}catch{return {station,state:'invalid'};}
   const sameRevision=replica.revision===policy.revision;
   const prepared=sameRevision&&policy.pending?.phase==='prepare'&&equals(replica.disabled,policy.disabled);
   const expected=policy.pending?.disabled??policy.disabled;
   const matches=sameRevision&&equals(replica.disabled,expected);
   const restrictive=sameRevision&&policy.pending&&equals(replica.disabled,policy.disabled);
   const state=prepared?'prepared':matches?'current':restrictive?'prepared':replica.revision<policy.revision?'behind':'different';
   return {station,state,revision:replica.revision};
  }catch{return {station,state:'unavailable'};}
 }));
 const latest=await store.read('FA');
 if((latest?.version??null)!==(source?.version??null))throw conflict();
 return {revision:policy.revision,pending:!!policy.pending,initialized:!!source,stations};
}

async function replicate(store,target,policy,{prepared,settled}) {
 const current=await store.read(target);
 if(current){
  const existing=validate(current.value);
  if(existing.revision>policy.revision)throw conflict();
  if(existing.revision===policy.revision){
   if(equals(existing,policy))return;
   // A concurrent retry may have already released this destination.
   if(equals(existing,settled)&&equals(policy,prepared))return;
   if(!equals(existing,prepared)||!equals(policy,settled))throw conflict();
  }
 }
 await store.write(target,policy,current?.version??null);
}

export async function publishFolderAvailability({store,actor,data}) {
 const input=parseRequest(data);
 if(typeof actor!=='string'||!actor||!mayPublish(await store.profile(actor),actor))throw fail('FOLDER_POLICY_FORBIDDEN',403);
 let record=await store.read('FA');
 let current=record?validate(record.value):initialOperationalFolderPolicy;
 if(current.revision!==input.revision)throw conflict();
 if(input.resume===true){
  if(!current.pending)throw conflict();
 }else{
  if(current.pending)throw conflict();
  if(input.initialize){
   if(record)throw conflict();
   const replicas=await Promise.all(folderPolicyTargets.map(target=>store.read(target)));
   if(replicas.some(Boolean))throw conflict();
  }
  const disabled=new Set(current.disabled);
  if(!input.initialize){
   if(input.enabled)disabled.delete(input.id);else disabled.add(input.id);
  }
  const next=ordered(disabled);
  if(!input.initialize&&equals(next,current.disabled))return {revision:current.revision,pending:false};
  if(current.revision===Number.MAX_SAFE_INTEGER)throw conflict();
  // During activation, FA retains the restrictive state until each destination confirms.
  current={schemaVersion:1,revision:current.revision+1,disabled:ordered([...current.disabled,...next]),pending:{disabled:next,phase:input.enabled?'prepare':'release'}};
  record=await store.write('FA',current,record?.version??null);
 }
 const settled=validate({schemaVersion:1,revision:current.revision,disabled:current.pending.disabled});
 if(settled.disabled.some(id=>!current.disabled.includes(id)))throw fail('FOLDER_POLICY_INVALID',503);
 const prepared={schemaVersion:1,revision:current.revision,disabled:current.disabled};
 const pending=()=>({revision:current.revision,pending:true});
 async function distribute(policy){
  const results=await Promise.allSettled(folderPolicyTargets.map(target=>replicate(store,target,policy,{prepared,settled})));
  return results.every(result=>result.status==='fulfilled');
 }

 if(current.pending.phase==='prepare'){
  // Confirm the restrictive policy everywhere before releasing any destination.
  if(!await distribute(prepared))return pending();
  const releasing={...current,pending:{...current.pending,phase:'release'}};
  try{
   record=await store.write('FA',releasing,record.version);
  }catch(error){
   if(error.code!=='FOLDER_POLICY_CONFLICT')throw error;
   const latest=await store.read('FA');
   if(latest&&equals(latest.value,settled))return {revision:current.revision,pending:false};
   if(!latest||!equals(latest.value,releasing))throw error;
   record=latest;
  }
 }else if(current.pending.phase!==undefined&&current.pending.phase!=='release'){
  throw fail('FOLDER_POLICY_INVALID',503);
 }
 if(!await distribute(settled))return pending();
 try{
  await store.write('FA',settled,record.version);
 }catch(error){
  if(error.code!=='FOLDER_POLICY_CONFLICT')throw error;
  const latest=await store.read('FA');
  if(!latest||!equals(latest.value,settled))throw error;
 }
 return {revision:current.revision,pending:false};
}
