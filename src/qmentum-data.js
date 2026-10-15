import * as sdk from 'firebase/firestore';
import {calculateMonth,canClose,periodKey,validateDefinitions,validateInputs} from './qmentum-engine.js';
import {QMENTUM_ENGINE} from './qmentum-catalog.js';
import {participationId,validateParticipation} from './qmentum-participation.js';
const unitPattern=/^[A-Za-z0-9_-]{1,80}$/;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export function transitionMonth(current,action,role,reason,results) {
 if(!['collector','reviewer','manager'].includes(role))throw Error('QMENTUM_PERMISSION_DENIED');
 if(!['SAVE','REVIEW','CLOSE','REOPEN','IMPORT','REBASE'].includes(action))throw Error('QMENTUM_ACTION_INVALID');
 if(current?.status==='CLOSED'&&action!=='REOPEN')throw Error('QMENTUM_MONTH_CLOSED');
 if(action==='REOPEN'){
  if(role!=='manager'||current?.status!=='CLOSED'||String(reason||'').trim().length<8)throw Error('QMENTUM_REOPEN_DENIED');
  return 'DRAFT';
 }
 if(action==='REVIEW'){
  if(!['reviewer','manager'].includes(role)||current?.status!=='DRAFT'||Object.values(results).some(r=>r.status==='INCONSISTENT'))throw Error('QMENTUM_REVIEW_DENIED');
  return 'REVIEWED';
 }
 if(action==='CLOSE'){
  if(!['reviewer','manager'].includes(role)||current?.status!=='REVIEWED'||!canClose(results))throw Error('QMENTUM_CLOSE_PENDING');
  return 'CLOSED';
 }
 if(action==='IMPORT'&&(role!=='manager'||current))throw Error('QMENTUM_IMPORT_CONFLICT');
 if(action==='REBASE'&&(role!=='manager'||current?.status!=='DRAFT'||String(reason||'').trim().length<8))throw Error('QMENTUM_REBASE_DENIED');
 return 'DRAFT';
}
export function createQmentumRepository({db,auth,uid,isCurrent=()=>true,firestore=sdk}={}) {
 const api=firestore;
 const ensure=()=>{
  if(db?.app?.options?.projectId!=='sahmt-17a16'||auth?.app?.options?.projectId!=='sahmt-17a16')throw Error('QMENTUM_FA_REQUIRED');
  if(!uid||!isCurrent()||auth.currentUser?.uid!==uid)throw Error('QMENTUM_SESSION_CHANGED');
 };
 const ref=(...segments)=>api.doc(db,...segments);
 const read=async(...segments)=>{ensure();const snapshot=await api.getDocFromServer(ref(...segments));ensure();return snapshot.exists()?snapshot.data():null;};
 const materialize=async documents=>{
  const versions=new Map();
  for(const d of documents)if(!versions.has(d.definitionVersion)){const definitions=await read('qmentumDefinitions',String(d.definitionVersion));validateDefinitions(definitions);versions.set(d.definitionVersion,definitions);}
  return documents.map(d=>({...d,results:calculateMonth(d.inputs,versions.get(d.definitionVersion),{inputVersion:d.version,calculatedAt:null})}));
 };
 const access=async(unitId=null)=>{
  ensure();const user=auth.currentUser,token=await user.getIdTokenResult();ensure();
  if(token.claims?.aud!=='sahmt-17a16'||token.claims?.iss!=='https://securetoken.google.com/sahmt-17a16'||token.claims?.sub!==uid)throw Error('QMENTUM_FA_AUTH_REQUIRED');
  const p=await read('users',uid);if(!p||p.uid!==uid||p.active!==true||p.access!==true)throw Error('QMENTUM_PERMISSION_DENIED');
  const a=await read('qmentumAccess',uid);
  if(!a||a.active!==true||a.uid!==uid||!['collector','reviewer','manager'].includes(a.role)||!Array.isArray(a.units)||a.units.length>20||a.units.some(u=>!unitPattern.test(u))||unitId!==null&&!a.units.includes(unitId))throw Error('QMENTUM_PERMISSION_DENIED');
  return a;
 };
 const open=async()=>{
  const a=await access();const units=(await Promise.all(a.units.map(id=>read('qmentumUnits',id)))).filter(u=>u?.active===true);
  const config=await read('qmentumConfig','current');
  if(config?.enabled!==true||!Number.isSafeInteger(config.definitionVersion))throw Error('QMENTUM_CONFIG_REQUIRED');
  const definitions=await read('qmentumDefinitions',String(config.definitionVersion));validateDefinitions(definitions);
  return {access:a,units,definitions};
 };
 const month=async(unitId,year,month)=>{await access(unitId);const d=await read('qmentumUnits',unitId,'months',periodKey(year,month));return d?(await materialize([d]))[0]:null;};
 const year=async(unitId,year)=>{
  await access(unitId);periodKey(year,1);
  const response=await api.getDocsFromServer(api.query(api.collection(db,'qmentumUnits',unitId,'months'),api.where('year','==',year),api.orderBy('month','asc'),api.limit(12)));
  ensure();return materialize(response.docs.map(d=>({...d.data(),id:d.id})));
 };
 const history=async(unitId,year,month)=>{
  await access(unitId);
  const response=await api.getDocsFromServer(api.query(api.collection(db,'qmentumUnits',unitId,'months',periodKey(year,month),'history'),api.orderBy('version','desc'),api.limit(30)));
  ensure();return materialize(response.docs.map(d=>({...d.data(),id:d.id})));
 };
 const save=async({unitId,year,month,inputs,baseVersion=0,definitionVersion,referenceDate,action='SAVE',reason='',importHash=null}={})=>{
  const a=await access(unitId),period=periodKey(year,month);
  if(!unitPattern.test(unitId)||!Number.isSafeInteger(baseVersion)||baseVersion<0||typeof reason!=='string'||reason.length>1000||!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate||'')||referenceDate.slice(0,7)!==period)throw Error('QMENTUM_INPUT_INVALID');
  if(importHash!==null&&!/^[a-f0-9]{64}$/.test(importHash))throw Error('QMENTUM_HASH_INVALID');
  validateInputs(inputs);
  const target=ref('qmentumUnits',unitId,'months',period);
  const result=await api.runTransaction(db,async tx=>{
   ensure();const [prior,unit,config]=await Promise.all([tx.get(target),tx.get(ref('qmentumUnits',unitId)),tx.get(ref('qmentumConfig','current'))]);
   if(!unit.exists()||unit.data().active!==true||config.data()?.enabled!==true)throw Error('QMENTUM_CONFIG_REQUIRED');
   const current=prior.exists()?prior.data():null;
   if(action==='IMPORT'&&current?.importHash===importHash)return current;
   if((current?.version||0)!==baseVersion)throw Error('QMENTUM_VERSION_CONFLICT');
   const version=action==='REBASE'?config.data().definitionVersion:current?.definitionVersion||definitionVersion||config.data().definitionVersion;
   const defsSnap=await tx.get(ref('qmentumDefinitions',String(version)));
   if(!defsSnap.exists())throw Error('QMENTUM_DEFINITION_MISSING');
   const defs=validateDefinitions(defsSnap.data());
   if(defs.validFrom>period)throw Error('QMENTUM_DEFINITION_NOT_EFFECTIVE');
   const frozen=['REVIEW','CLOSE','REOPEN','REBASE'].includes(action);
   if(frozen&&canonical(inputs)!==canonical(current?.inputs))throw Error('QMENTUM_SAVE_BEFORE_REVIEW');
   if(action==='IMPORT'){
    const batch=await tx.get(ref('qmentumUnits',unitId,'imports',importHash));
    if(!batch.exists()||batch.data().status!=='STAGED'||batch.data().year!==year||batch.data().unitId!==unitId)throw Error('QMENTUM_IMPORT_NOT_STAGED');
   }
   const results=calculateMonth(inputs,defs,{inputVersion:baseVersion+1,calculatedAt:null});
   const status=transitionMonth(current,action,a.role,reason,results);
   const timestamp=api.serverTimestamp();
   const data={schemaVersion:1,unitId,year,month,period,version:baseVersion+1,status,inputs,results,definitionVersion:version,referenceVersion:defs.referenceVersion,engineVersion:QMENTUM_ENGINE,referenceDate,importHash:current?.importHash||importHash,createdBy:current?.createdBy||uid,createdAt:current?.createdAt||timestamp,updatedBy:uid,updatedAt:timestamp,action,reason:reason.trim(),reviewedBy:action==='REVIEW'?uid:action==='SAVE'||action==='REOPEN'?null:current?.reviewedBy||null};
   if(bytes(data)>160000)throw Error('QMENTUM_DOCUMENT_TOO_LARGE');
   ensure();tx.set(target,data);tx.set(ref('qmentumUnits',unitId,'months',period,'history',String(data.version)),data);
   for(let group=0;group<12;group++)tx.set(ref('qmentumUnits',unitId,'months',period,'validation',`${data.version}_${group}`),{group,snapshot:data});
   return data;
  });ensure();return result;
 };
 const stageImport=async({preview,backupReference,sourceCells})=>{
  const a=await access(preview.unitId);if(a.role!=='manager'||preview.year===null||!/^https:\/\/(drive|docs)\.google\.com\//.test(backupReference||'')&&!/^LOCAL_BACKUP_CONFIRMED$/.test(backupReference||''))throw Error('QMENTUM_IMPORT_BACKUP_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(preview.hash)||!Array.isArray(sourceCells))throw Error('QMENTUM_IMPORT_INVALID');
  const chunks=[];let chunk=[];
  for(const cell of sourceCells){if(bytes(cell)>20000)throw Error('QMENTUM_SOURCE_CELL_TOO_LARGE');if(bytes([...chunk,cell])>60000){chunks.push(chunk);chunk=[];}chunk.push(cell);}if(chunk.length)chunks.push(chunk);
  if(chunks.length>40)throw Error('QMENTUM_IMPORT_TOO_LARGE');
  const root=ref('qmentumUnits',preview.unitId,'imports',preview.hash);
  await api.runTransaction(db,async tx=>{
   const prior=await tx.get(root);if(prior.exists()){if(prior.data().year!==preview.year)throw Error('QMENTUM_IMPORT_YEAR_CONFLICT');return;}
   ensure();tx.set(root,{schemaVersion:1,hash:preview.hash,unitId:preview.unitId,year:preview.year,status:'STAGED',backupReference,chunkCount:chunks.length,createdBy:uid,createdAt:api.serverTimestamp(),sheetNames:preview.sourceSheetNames});
   chunks.forEach((cells,index)=>tx.set(ref('qmentumUnits',preview.unitId,'imports',preview.hash,'cells',String(index)),{cells,hash:preview.hash,index}));
  });ensure();return {status:'STAGED',chunks:chunks.length};
 };
 const publishDefinition=async(definitions)=>{
  const a=await access();if(a.role!=='manager')throw Error('QMENTUM_PERMISSION_DENIED');validateDefinitions(definitions);
  const target=ref('qmentumDefinitions',String(definitions.version));
  await api.runTransaction(db,async tx=>{
   const [prior,config]=await Promise.all([tx.get(target),tx.get(ref('qmentumConfig','current'))]);
   if(prior.exists()||definitions.version!==config.data()?.definitionVersion+1)throw Error('QMENTUM_VERSION_CONFLICT');
   const data={...definitions,createdBy:uid,createdAt:api.serverTimestamp()};
   ensure();tx.set(target,data);
   for(let group=0;group<3;group++)tx.set(ref('qmentumDefinitions',String(definitions.version),'validation',String(group)),{snapshot:data});
   tx.update(ref('qmentumConfig','current'),{definitionVersion:definitions.version});
  });ensure();
 };
 const quarterlyAnalyses=async(unitId,year,quarter,indicatorId)=>{
  await access(unitId);periodKey(year,1);if(![1,2,3,4].includes(quarter))throw Error('QMENTUM_QUARTER_INVALID');
  const response=await api.getDocsFromServer(api.query(api.collection(db,'qmentumUnits',unitId,'quarterlyAnalyses'),api.where('year','==',year),api.where('quarter','==',quarter),api.where('indicatorId','==',indicatorId),api.orderBy('generatedAt','desc'),api.limit(10)));
  ensure();return response.docs.map(d=>({...d.data(),id:d.id}));
 };
 const requestAnalysisReview=async({unitId,analysisId,signature,reason})=>{
  const a=await access(unitId);if(!['reviewer','manager'].includes(a.role)||!/^[a-f0-9]{64}$/.test(analysisId)||!/^[a-f0-9]{64}$/.test(signature)||typeof reason!=='string'||reason.trim().length<8||reason.length>1000)throw Error('QMENTUM_REVIEW_DENIED');
  const id=analysisId+'_'+uid,target=ref('qmentumAnalysisReviewRequests',id);
  await api.runTransaction(db,async tx=>{const old=await tx.get(target);if(old.exists())return;ensure();tx.set(target,{unitId,analysisId,signature,reason:reason.trim(),actorUid:uid,status:'PENDING',createdAt:api.serverTimestamp()});});ensure();return {code:'QMENTUM_REVIEW_PENDING'};
 };
 const participate=async({unitId,analysisId,signature,modality,suggestion=''})=>{
  await access(unitId);const text=validateParticipation({analysisId,uid,modality,suggestion}),id=participationId(analysisId,uid,modality);
  if(!/^[a-f0-9]{64}$/.test(signature))throw Error('QMENTUM_PARTICIPATION_INVALID');
  await api.runTransaction(db,async tx=>{const target=ref('qmentumParticipations',id),old=await tx.get(target);if(old.exists())return;ensure();tx.set(target,{unitId,analysisId,signature,actorUid:uid,modality,suggestion:text,status:'PENDING',createdAt:api.serverTimestamp()});});ensure();return {code:'QMENTUM_PARTICIPATION_PENDING'};
 };
 const participations=async(unitId,analysisId)=>{
  const a=await access(unitId),filters=[api.where('unitId','==',unitId),api.where('analysisId','==',analysisId)];
  if(a.role!=='manager')filters.push(api.where('actorUid','==',uid));
  const snap=await api.getDocsFromServer(api.query(api.collection(db,'qmentumParticipations'),...filters,api.limit(100)));ensure();return snap.docs.map(d=>({...d.data(),id:d.id}));
 };
 const reviewSuggestion=async({unitId,participation,decision,reason})=>{
  const a=await access(unitId);if(a.role!=='manager'||participation.actorUid===uid||participation.unitId!==unitId||participation.modality!=='SUGGESTION'||!['APPROVE','REJECT'].includes(decision)||typeof reason!=='string'||reason.trim().length<8||reason.length>1000)throw Error('QMENTUM_SUGGESTION_REVIEW_DENIED');
  const id=participationId(participation.analysisId,participation.actorUid,'SUGGESTION'),target=ref('qmentumParticipationReviews',id);
  await api.runTransaction(db,async tx=>{if((await tx.get(target)).exists())return;ensure();tx.set(target,{participationId:id,unitId,actorUid:uid,decision,reason:reason.trim(),status:'PENDING',createdAt:api.serverTimestamp()});});ensure();
 };
 return {open,access,month,year,history,save,stageImport,publishDefinition,quarterlyAnalyses,requestAnalysisReview,participate,participations,reviewSuggestion,definition:async version=>{await access();return read('qmentumDefinitions',String(version));}};
}

export function createDraftStore(storage=globalThis.sessionStorage) {
 const key=({uid,unitId,period})=>{if(!uid||!unitPattern.test(unitId)||!/^\d{4}-\d{2}$/.test(period))throw Error('QMENTUM_DRAFT_SCOPE_INVALID');return `sahmt:qmentum:FA:${uid}:${unitId}:${period}`;};
 return {read:scope=>{try{const value=JSON.parse(storage.getItem(key(scope))||'null');return value&&Date.now()-value.savedAt<86400000?value:null;}catch{return null;}},save:(scope,value)=>storage.setItem(key(scope),JSON.stringify({...value,savedAt:Date.now()})),remove:scope=>storage.removeItem(key(scope))};
}
