const FB_PERFORMANCE=Object.freeze({project:'sahmt-gestao-5ae66',executor:'anestesiahmtforms2@gmail.com',folder:'1SiIvED7gjlsA0tA5SqGAUE3U3jCHRuSj'});
function fbPerformanceIdentity_(){if(Session.getEffectiveUser().getEmail().toLowerCase()!==FB_PERFORMANCE.executor)throw Error('FB_EXECUTOR_MISMATCH');}
function fbPerformanceDecode_(v){if(v.nullValue!==undefined)return null;if(v.stringValue!==undefined)return v.stringValue;if(v.booleanValue!==undefined)return v.booleanValue;if(v.integerValue!==undefined)return Number(v.integerValue);if(v.doubleValue!==undefined)return v.doubleValue;if(v.timestampValue!==undefined)return Date.parse(v.timestampValue);if(v.arrayValue)return (v.arrayValue.values||[]).map(fbPerformanceDecode_);if(v.mapValue)return fbPerformanceFields_(v.mapValue.fields||{});throw Error('FB_VALUE_INVALID');}
function fbPerformanceFields_(fields){return Object.fromEntries(Object.keys(fields).map(k=>[k,fbPerformanceDecode_(fields[k])]));}
function fbPerformanceEncode_(v){if(v===null)return {nullValue:null};if(typeof v==='string')return {stringValue:v};if(typeof v==='boolean')return {booleanValue:v};if(typeof v==='number'&&isFinite(v))return Number.isSafeInteger(v)?{integerValue:String(v)}:{doubleValue:v};if(Array.isArray(v))return {arrayValue:{values:v.map(fbPerformanceEncode_)}};if(v&&typeof v==='object')return {mapValue:{fields:fbPerformanceEncodeFields_(v)}};throw Error('FB_VALUE_INVALID');}
function fbPerformanceEncodeFields_(o){return Object.fromEntries(Object.keys(o).map(k=>[k,fbPerformanceEncode_(o[k])]));}
function fbPerformanceHttp_(suffix,body){
 fbPerformanceIdentity_();
 if(!/^\/(?:fbPerformanceRuntime\/current|fbPerformanceReference\/team|fbPerformanceControl\/centralCutover)$/.test(suffix)&&![':runQuery',':commit'].includes(suffix))throw Error('FB_HTTP_SCOPE_DENIED');
 const response=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+FB_PERFORMANCE.project+'/databases/(default)/documents'+suffix,{method:body===undefined?'get':'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,...(body===undefined?{}:{payload:JSON.stringify(body)})});
 const status=response.getResponseCode();if(status===404&&body===undefined)return null;
 if(status!==200)throw Error('FB_FIRESTORE_HTTP_'+status);
 return JSON.parse(response.getContentText());
}
function fbPerformanceRead_(collection,maximum,readTime){
 const allowed=['users','evaluationAwards','evaluationLedger','evaluationFormConfigs','scores','evaluationParticipations','htmlTrainingStates','htmlTrainings'];
 if(!allowed.includes(collection))throw Error('FB_COLLECTION_DENIED');
 const projection={htmlTrainings:['title'],htmlTrainingStates:['uid','trainingId','version','attempts','suggestionDecision'],users:['uid','active','access'],evaluationAwards:['uid','category','modality','points','originalPoints','awardVersion','lastLedgerId','creditScopeId','activityId','areaId','version','updatedAt','sourceType','sourceId','evidence','approvedByUid'],evaluationLedger:['awardId','uid','category','modality','creditScopeId','activityId','version','points','originalPoints','correctedPoints','pointsBefore','awardVersion','correctsId','createdAt','sourceType','sourceId','evidence','approvedByUid'],evaluationFormConfigs:['creditScopeId','version'],scores:['uid','sourceType','sourceId','ruleId','originProjectId','points','createdAt'],evaluationParticipations:['uid','activityId','creditScopeId','version','status','responseId','submittedAt']};
 const rows=fbPerformanceHttp_(':runQuery',{...(readTime?{readTime:readTime}:{}),structuredQuery:{from:[{collectionId:collection}],select:{fields:projection[collection].map(fieldPath=>({fieldPath:fieldPath}))},limit:maximum+1}}).filter(row=>row.document).map(row=>Object.assign({id:row.document.name.split('/').pop()},fbPerformanceFields_(row.document.fields||{})));
 if(rows.length>maximum)throw Error('FB_BOUNDED_READ_EXCEEDED');return rows;
}
function fbPerformanceWrite_(collection,id,value){
 if(!['fbPerformanceRuntime','fbPerformanceReference','fbPerformanceAwards','fbPerformanceLedger','fbPerformanceSummaries'].includes(collection)||!/^[A-Za-z0-9_.@+:%-]{1,512}$/.test(id))throw Error('FB_WRITE_SCOPE_DENIED');
 return {update:{name:'projects/'+FB_PERFORMANCE.project+'/databases/(default)/documents/'+collection+'/'+id,fields:fbPerformanceEncodeFields_(value)}};
}
function prepararDesempenhoFbV1(){
 fbPerformanceIdentity_();const old=fbPerformanceHttp_('/fbPerformanceRuntime/current');
 const report={code:'FB_PERFORMANCE_PREPARED',projectId:FB_PERFORMANCE.project,enabled:old?fbPerformanceFields_(old.fields).enabled===true:false,automaticExternalSync:false,historyImported:0};console.log(JSON.stringify(report));return report;
}
function ativarDesempenhoFbV1(){
 fbPerformanceIdentity_();const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('FB_BUSY');
 try{
  const old=fbPerformanceHttp_('/fbPerformanceRuntime/current');
  if(old){const r=fbPerformanceFields_(old.fields);if(r.schemaVersion!==1||r.projectId!==FB_PERFORMANCE.project||r.mode!=='FB_ONLY'||r.enabled!==true||!isFinite(Date.parse(r.effectiveFrom)))throw Error('FB_RUNTIME_CONFLICT');fbPerformanceEnsureTrigger_();return {code:'FB_ALREADY_ACTIVE',effectiveFrom:r.effectiveFrom};}
  const cutoverDocument=fbPerformanceHttp_('/fbPerformanceControl/centralCutover'),cutover=cutoverDocument&&fbPerformanceFields_(cutoverDocument.fields||{});
  if(!cutover||cutover.schemaVersion!==1||cutover.status!=='ACTIVE'||cutover.mode!=='FB_ONLY'||!isFinite(Date.parse(cutover.activateNotBefore)))throw Error('FB_CENTRAL_CUTOVER_REQUIRED');
  const runtime={schemaVersion:1,projectId:FB_PERFORMANCE.project,mode:'FB_ONLY',enabled:true,effectiveFrom:new Date(Math.max(Date.now()+1000,Date.parse(cutover.activateNotBefore))).toISOString(),historyImported:0,automaticExternalSync:false};
  const write=fbPerformanceWrite_('fbPerformanceRuntime','current',runtime);write.currentDocument={exists:false};fbPerformanceHttp_(':commit',{writes:[write]});
  fbPerformanceEnsureTrigger_();
  const report={code:'FB_PERFORMANCE_ACTIVE',effectiveFrom:runtime.effectiveFrom,triggers:1,historyImported:0,automaticExternalSync:false};console.log(JSON.stringify(report));return report;
 }finally{lock.releaseLock();}
}
function fbPerformanceEnsureTrigger_(){if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='executarDesempenhoFbV1'))ScriptApp.newTrigger('executarDesempenhoFbV1').timeBased().everyMinutes(15).create();}
function instalarDesempenhoFbV1(){
 fbPerformanceIdentity_();
 const script=DriveApp.getFileById(ScriptApp.getScriptId()),folder=DriveApp.getFolderById(FB_PERFORMANCE.folder);
 if(script.getOwner().getEmail().toLowerCase()!==FB_PERFORMANCE.executor||folder.getOwner().getEmail().toLowerCase()!==FB_PERFORMANCE.executor)throw Error('FB_DRIVE_OWNER_MISMATCH');
 script.moveTo(folder);
 const parents=script.getParents();let found=false;while(parents.hasNext())if(parents.next().getId()===FB_PERFORMANCE.folder)found=true;
 if(!found)throw Error('FB_SCRIPT_FOLDER_MISMATCH');
 const result=ativarDesempenhoFbV1();
 const report=Object.assign({},result,{code:'FB_PERFORMANCE_INSTALLED',scriptId:ScriptApp.getScriptId(),folderId:FB_PERFORMANCE.folder,historyImported:0});
 console.log(JSON.stringify(report));return report;
}
function executarDesempenhoFbV1(){
 fbPerformanceIdentity_();const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{
  const raw=fbPerformanceHttp_('/fbPerformanceRuntime/current'),runtime=raw&&fbPerformanceFields_(raw.fields||{});
  const effectiveFrom=Date.parse(runtime&&runtime.effectiveFrom);
  if(!runtime||runtime.enabled!==true||runtime.projectId!==FB_PERFORMANCE.project||runtime.mode!=='FB_ONLY'||!isFinite(effectiveFrom)||Date.now()<effectiveFrom)throw Error('FB_NOT_ACTIVE');
  // Pin every input collection to the same committed Firestore snapshot.
  const readTime=new Date(Date.now()-1000).toISOString(),read=(collection,maximum)=>fbPerformanceRead_(collection,maximum,readTime);
  const projection=FbPerformanceDomain.projectFbPerformance({awards:read('evaluationAwards',10000),configs:read('evaluationFormConfigs',500),scores:read('scores',10000),participations:read('evaluationParticipations',10000),ledger:read('evaluationLedger',20000),profiles:read('users',400),htmlStates:read('htmlTrainingStates',10000),htmlTrainings:read('htmlTrainings',500),effectiveFrom:effectiveFrom});
  const previous=fbPerformanceHttp_('/fbPerformanceReference/team'),revision=(previous&&fbPerformanceFields_(previous.fields).revision||0)+1,now=Date.now();
  const writes=[];
  projection.awards.forEach(row=>writes.push(fbPerformanceWrite_('fbPerformanceAwards',row.id,Object.assign({},row,{revision:revision}))));
  projection.ledger.forEach(row=>writes.push(fbPerformanceWrite_('fbPerformanceLedger',row.id,Object.assign({},row,{revision:revision}))));
  Object.keys(projection.totals).forEach(uid=>writes.push(fbPerformanceWrite_('fbPerformanceSummaries',uid,{uid:uid,total:projection.totals[uid],revision:revision,updatedAt:now})));
  // Rows use stable IDs, so hide the reference before any row is overwritten.
  fbPerformanceHttp_(':commit',{writes:[fbPerformanceWrite_('fbPerformanceReference','team',{status:'PENDING',revision:revision,startedAt:now})]});
  for(let offset=0;offset<writes.length;offset+=300){const state=fbPerformanceFields_(fbPerformanceHttp_('/fbPerformanceRuntime/current').fields);if(state.enabled!==true)throw Error('FB_ACTIVATION_CHANGED');fbPerformanceHttp_(':commit',{writes:writes.slice(offset,offset+300)});}
  const finalRuntime=fbPerformanceFields_(fbPerformanceHttp_('/fbPerformanceRuntime/current').fields);
  if(finalRuntime.enabled!==true||finalRuntime.mode!==runtime.mode||finalRuntime.projectId!==runtime.projectId||finalRuntime.effectiveFrom!==runtime.effectiveFrom)throw Error('FB_ACTIVATION_CHANGED');
  fbPerformanceHttp_(':commit',{writes:[fbPerformanceWrite_('fbPerformanceReference','team',{status:'CONFIRMED',revision:revision,maxPerformance:projection.maxPerformance,eligibleCount:projection.eligibleCount,confirmedAt:now})]});
  const report={code:'FB_PERFORMANCE_CYCLE',projectId:FB_PERFORMANCE.project,revision:revision,awards:projection.awards.length,summaries:Object.keys(projection.totals).length,externalOrHistoricalExcluded:projection.excluded};console.log(JSON.stringify(report));return report;
 }finally{lock.releaseLock();}
}
