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

function faPerformanceOnly_(){return PropertiesService.getScriptProperties().getProperty('SAHMT_FA_PERFORMANCE_MODE')==='FA_ONLY';}



// FA is the entry shell. Its former performance producer is retired.
