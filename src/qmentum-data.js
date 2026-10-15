import * as sdk from 'firebase/firestore';
import {calculateMonth,periodKey,validateDefinitions,validateInputs} from './qmentum-engine.js';
import {createQmentumCommandSender} from './qmentum-command.js';
import {participationId,validateParticipation} from './qmentum-participation.js';
const unitPattern=/^[A-Za-z0-9_-]{1,80}$/;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export {transitionMonth} from './qmentum-workflow.js';
export function createQmentumRepository({db,auth,uid,isCurrent=()=>true,firestore=sdk,writeCommand,writeEndpoint}={}) {
 const api=firestore,definitions=new Map();
 const ensure=()=>{
  if(db?.app?.options?.projectId!=='sahmt-17a16'||auth?.app?.options?.projectId!=='sahmt-17a16')throw Error('QMENTUM_FA_REQUIRED');
  if(!uid||!isCurrent()||auth.currentUser?.uid!==uid){definitions.clear();throw Error('QMENTUM_SESSION_CHANGED');}
 };
 const sendCommand=writeCommand||createQmentumCommandSender({db,auth,uid,ensure,firestore:api,endpoint:writeEndpoint});
 const ref=(...segments)=>api.doc(db,...segments);
 const read=async(...segments)=>{ensure();const snapshot=await api.getDocFromServer(ref(...segments));ensure();return snapshot.exists()?snapshot.data():null;};
 const definition=async version=>{
  ensure();if(!Number.isSafeInteger(version)||version<1)throw Error('QMENTUM_DEFINITION_INVALID');
  if(!definitions.has(version)){
   const pending=read('qmentumDefinitions',String(version)).then(value=>{validateDefinitions(value);if(value.version!==version)throw Error('QMENTUM_DEFINITION_INVALID');return structuredClone(value);});
   definitions.set(version,pending);pending.catch(()=>{if(definitions.get(version)===pending)definitions.delete(version);});
  }
  const value=await definitions.get(version);ensure();return structuredClone(value);
 };
 const materialize=async documents=>{
  const versions=new Map();
  for(const d of documents)if(!versions.has(d.definitionVersion)){versions.set(d.definitionVersion,await definition(d.definitionVersion));}
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
  const definitions=await definition(config.definitionVersion);
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
 const save=async({unitId,year,month,inputs,baseVersion=0,definitionVersion=null,referenceDate,action='SAVE',reason='',importHash=null}={})=>{
  await access(unitId);periodKey(year,month);validateInputs(inputs);
  const result=await sendCommand('SAVE_MONTH',{unitId,year,month,inputs,baseVersion,definitionVersion,referenceDate,action,reason,importHash});ensure();return result;
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
  const {version,validFrom,reason,referenceVersion,items}=definitions;
  await sendCommand('PUBLISH_DEFINITION',{definitions:{version,validFrom,reason,referenceVersion,items}});ensure();
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
 return {open,access,month,year,history,save,stageImport,publishDefinition,quarterlyAnalyses,requestAnalysisReview,participate,participations,reviewSuggestion,definition:async version=>{await access();const config=await read('qmentumConfig','current');if(config?.enabled!==true)throw Error('QMENTUM_CONFIG_REQUIRED');return definition(version);}};
}

export function createDraftStore(storage=globalThis.sessionStorage) {
 const key=({uid,unitId,period})=>{if(!uid||!unitPattern.test(unitId)||!/^\d{4}-\d{2}$/.test(period))throw Error('QMENTUM_DRAFT_SCOPE_INVALID');return `sahmt:qmentum:FA:${uid}:${unitId}:${period}`;};
 return {read:scope=>{try{const value=JSON.parse(storage.getItem(key(scope))||'null');return value&&Date.now()-value.savedAt<86400000?value:null;}catch{return null;}},save:(scope,value)=>storage.setItem(key(scope),JSON.stringify({...value,savedAt:Date.now()})),remove:scope=>storage.removeItem(key(scope))};
}
