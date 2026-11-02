const FA_PERFORMANCE=Object.freeze({project:'sahmt-17a16',executor:'anestesiahmtforms@gmail.com',script:'1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD'});
function faPerformanceIdentity_(){if(Session.getEffectiveUser().getEmail().toLowerCase()!==FA_PERFORMANCE.executor||ScriptApp.getScriptId()!==FA_PERFORMANCE.script)throw Error('FA_EXECUTOR_MISMATCH');}
function faPerformanceDecode_(v){if(v.nullValue!==undefined)return null;if(v.stringValue!==undefined)return v.stringValue;if(v.booleanValue!==undefined)return v.booleanValue;if(v.integerValue!==undefined)return Number(v.integerValue);if(v.doubleValue!==undefined)return v.doubleValue;if(v.timestampValue!==undefined)return Date.parse(v.timestampValue);if(v.arrayValue)return (v.arrayValue.values||[]).map(faPerformanceDecode_);if(v.mapValue)return faPerformanceFields_(v.mapValue.fields||{});throw Error('FA_VALUE_INVALID');}
function faPerformanceFields_(fields){return Object.fromEntries(Object.keys(fields).map(k=>[k,faPerformanceDecode_(fields[k])]));}
function faPerformanceEncode_(v){if(v===null)return {nullValue:null};if(typeof v==='string')return {stringValue:v};if(typeof v==='boolean')return {booleanValue:v};if(typeof v==='number'&&isFinite(v))return Number.isSafeInteger(v)?{integerValue:String(v)}:{doubleValue:v};if(Array.isArray(v))return {arrayValue:{values:v.map(faPerformanceEncode_)}};if(v&&typeof v==='object')return {mapValue:{fields:faPerformanceEncodeFields_(v)}};throw Error('FA_VALUE_INVALID');}
function faPerformanceEncodeFields_(o){return Object.fromEntries(Object.keys(o).map(k=>[k,faPerformanceEncode_(o[k])]));}
function faPerformanceHttp_(suffix,body){
 faPerformanceIdentity_();
 if(!/^\/(?:faPerformanceRuntime\/(?:current|lease)|faPerformanceReference\/team)$/.test(suffix)&&![':runQuery',':commit'].includes(suffix))throw Error('FA_HTTP_SCOPE_DENIED');
 const response=sahmtUrlFetchRun_(function(){return UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+FA_PERFORMANCE.project+'/databases/(default)/documents'+suffix,{method:body===undefined?'get':'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,...(body===undefined?{}:{payload:JSON.stringify(body)})});});
 const status=response.getResponseCode();if(status===404&&body===undefined)return null;
 if(status!==200)throw Error('FA_FIRESTORE_HTTP_'+status);return JSON.parse(response.getContentText());
}
function faPerformanceRead_(collection,maximum,snapshot){
 const projection={users:['uid','sigla','email','displayName','active','access'],contacts:['sigla','email','active'],events:['eventType','delayMultiple','date','memberSigla','active','status','createdAt'],checklistSignatures:['date','responsibleUid','signerUid','signedAt','acknowledgedAt','declaration','snapshot','revision'],checklistSignatureRequests:['day','signerUid','requestedAt','validatedAt','status','finalSignatureId'],faPerformanceAwards:null};
 if(!Object.prototype.hasOwnProperty.call(projection,collection))throw Error('FA_READ_SCOPE_DENIED');
 const query={from:[{collectionId:collection}],limit:maximum+1};
 if(projection[collection])query.select={fields:projection[collection].map(fieldPath=>({fieldPath:fieldPath}))};
 const response=faPerformanceHttp_(':runQuery',{structuredQuery:query,...(snapshot.readTime?{readTime:snapshot.readTime}:{})});
 if(!Array.isArray(response)||!response.length||response.some(row=>row.error))throw Error('FA_INPUT_INCOMPLETE');
 if(!snapshot.readTime){snapshot.readTime=response[response.length-1].readTime;if(!snapshot.readTime)throw Error('FA_INPUT_INCOMPLETE');}
 const rows=response.filter(row=>row.document).map(row=>Object.assign(faPerformanceFields_(row.document.fields||{}),{id:row.document.name.split('/').pop(),documentCreatedAt:Date.parse(row.document.createTime)}));
 if(rows.length>maximum)throw Error('FA_INPUT_INCOMPLETE');return rows;
}
function faPerformanceWrite_(collection,id,value){
 if(!['faPerformanceRuntime','faPerformanceReference','faPerformanceAwards','faPerformanceLedger','faPerformanceSummaries'].includes(collection)||!/^[A-Za-z0-9_.@+:%-]{1,512}$/.test(id))throw Error('FA_WRITE_SCOPE_DENIED');
 return {update:{name:'projects/'+FA_PERFORMANCE.project+'/databases/(default)/documents/'+collection+'/'+id,fields:faPerformanceEncodeFields_(value)}};
}
function faPerformanceRuntime_(document){
 const r=document&&faPerformanceFields_(document.fields||{});
 if(!r||r.schemaVersion!==1||r.projectId!==FA_PERFORMANCE.project||r.mode!=='FA_ONLY'||r.enabled!==true||!isFinite(Date.parse(r.effectiveFrom))||r.automaticExternalSync!==false)throw Error('FA_RUNTIME_CONFLICT');return r;
}
// Dedicated compare-and-set lease: never hold the central ScriptLock or its read-budget UserLock.
function faPerformanceAcquire_(){
 const raw=faPerformanceHttp_('/faPerformanceRuntime/lease'),old=raw&&faPerformanceFields_(raw.fields||{}),now=Date.now();
 if(old&&(!Number.isFinite(old.expiresAt)||old.expiresAt>now))throw Error('FA_BUSY');
 const token=Utilities.getUuid(),write=faPerformanceWrite_('faPerformanceRuntime','lease',{token:token,expiresAt:now+600000});
 if(raw&&!raw.updateTime)throw Error('FA_LEASE_INVALID');
 write.currentDocument=raw?{updateTime:raw.updateTime}:{exists:false};
 try{faPerformanceHttp_(':commit',{writes:[write]});}catch(error){if(/FA_FIRESTORE_HTTP_(409|412)/.test(error.message))throw Error('FA_BUSY');throw error;}return token;
}
function faPerformanceAssertLease_(token){const raw=faPerformanceHttp_('/faPerformanceRuntime/lease'),lease=raw&&faPerformanceFields_(raw.fields||{});if(!lease||lease.token!==token||lease.expiresAt<=Date.now())throw Error('FA_LEASE_LOST');}
function faPerformanceRelease_(token){
 try{const raw=faPerformanceHttp_('/faPerformanceRuntime/lease');if(!raw||faPerformanceFields_(raw.fields||{}).token!==token)return;const write=faPerformanceWrite_('faPerformanceRuntime','lease',{token:token,expiresAt:0});write.currentDocument={updateTime:raw.updateTime};faPerformanceHttp_(':commit',{writes:[write]});}catch(_){console.log(JSON.stringify({code:'FA_LEASE_RELEASE_PENDING'}));}
}
function instalarDesempenhoFaV1(){
 faPerformanceIdentity_();const lease=faPerformanceAcquire_();
 try{
  const existing=faPerformanceHttp_('/faPerformanceRuntime/current');let r;
  if(existing)r=faPerformanceRuntime_(existing);
  else{
   r={schemaVersion:1,projectId:FA_PERFORMANCE.project,mode:'FA_ONLY',enabled:true,effectiveFrom:new Date().toISOString(),historyImported:0,automaticExternalSync:false};
   const write=faPerformanceWrite_('faPerformanceRuntime','current',r);write.currentDocument={exists:false};faPerformanceHttp_(':commit',{writes:[write]});
  }
  PropertiesService.getScriptProperties().setProperty('SAHMT_FA_PERFORMANCE_MODE','FA_ONLY');
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='executarDesempenhoFaV1'))ScriptApp.newTrigger('executarDesempenhoFaV1').timeBased().everyMinutes(15).create();
  const result={code:'FA_PERFORMANCE_INSTALLED',effectiveFrom:r.effectiveFrom,historyImported:0,automaticExternalSync:false,triggers:ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='executarDesempenhoFaV1').length};console.log(JSON.stringify(result));return result;
 }finally{faPerformanceRelease_(lease);}
}
function faPerformanceOnly_(){return PropertiesService.getScriptProperties().getProperty('SAHMT_FA_PERFORMANCE_MODE')==='FA_ONLY';}
function iniciarDesempenhoFaV1(){instalarDesempenhoFaV1();return executarDesempenhoFaV1();}
function executarDesempenhoFaV1(){
 faPerformanceIdentity_();const lease=faPerformanceAcquire_();
 try{
  const runtime=faPerformanceRuntime_(faPerformanceHttp_('/faPerformanceRuntime/current')),effectiveFrom=Date.parse(runtime.effectiveFrom);
  const snapshot={},read=(c,n)=>faPerformanceRead_(c,n,snapshot),profiles=read('users',400),contacts=read('contacts',500);
  const events=read('events',10000).filter(e=>e.documentCreatedAt>=effectiveFrom);
  const signatures=read('checklistSignatures',10000).map(s=>Object.assign(s,{snapshotValid:!!s.snapshot&&s.snapshot.date===s.date&&s.snapshot.responsibleUid===s.responsibleUid&&s.id===s.date+'_'+s.revision&&s.revision===checklistStoredSnapshotRevision_(s.snapshot)}));
  const requests=read('checklistSignatureRequests',10000),previousAwards=read('faPerformanceAwards',20000),now=Date.parse(snapshot.readTime);
  const projection=FaPerformanceDomain.projectFaPerformance({events:events,signatures:signatures,requests:requests,profiles:profiles,contacts:contacts,previousAwards:previousAwards,effectiveFrom:effectiveFrom,cutoffDay:new Date(effectiveFrom-10800000).toISOString().slice(0,10),now:now,complete:true});
  const previous=faPerformanceHttp_('/faPerformanceReference/team'),revision=(previous&&faPerformanceFields_(previous.fields).revision||0)+1;
  faPerformanceAssertLease_(lease);faPerformanceHttp_(':commit',{writes:[faPerformanceWrite_('faPerformanceReference','team',{status:'PENDING',revision:revision,startedAt:now})]});
  const ledgerByAward=new Map(projection.ledger.map(l=>[l.awardId,l])),groups=[];
  projection.awards.forEach(a=>{const writes=[faPerformanceWrite_('faPerformanceAwards',a.id,Object.assign({},a,{revision:revision}))],l=ledgerByAward.get(a.id);if(l)writes.push(faPerformanceWrite_('faPerformanceLedger',l.id,l));groups.push(writes);});
  Object.keys(projection.totals).forEach(uid=>{const p=profiles.find(p=>p.uid===uid);groups.push([faPerformanceWrite_('faPerformanceSummaries',uid,{uid:uid,displayName:String(p.displayName||p.sigla||uid).slice(0,120),total:projection.totals[uid],revision:revision,updatedAt:now})]);});
  // Keep each award and its audit delta in the same atomic commit, including retries.
  for(let offset=0;offset<groups.length;offset+=150){faPerformanceAssertLease_(lease);const state=faPerformanceRuntime_(faPerformanceHttp_('/faPerformanceRuntime/current'));if(state.effectiveFrom!==runtime.effectiveFrom)throw Error('FA_ACTIVATION_CHANGED');faPerformanceHttp_(':commit',{writes:groups.slice(offset,offset+150).flat()});}
  const final=faPerformanceRuntime_(faPerformanceHttp_('/faPerformanceRuntime/current'));if(final.effectiveFrom!==runtime.effectiveFrom)throw Error('FA_ACTIVATION_CHANGED');
  faPerformanceAssertLease_(lease);faPerformanceHttp_(':commit',{writes:[faPerformanceWrite_('faPerformanceReference','team',{status:'CONFIRMED',revision:revision,maxPerformance:projection.maxPerformance,eligibleCount:Object.keys(projection.totals).length,pending:projection.pending,confirmedAt:now})]});
  const report={code:'FA_PERFORMANCE_CYCLE',revision:revision,summaries:Object.keys(projection.totals).length,awards:projection.awards.length,changes:projection.ledger.length,pending:projection.pending,automaticExternalSync:false};console.log(JSON.stringify(report));return report;
 }finally{faPerformanceRelease_(lease);}
}
