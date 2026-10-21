/** Bounded reconciliation. An empty remote queue performs ZERO Firestore calls. */
function sincronizarCanalOperacionalRemotoV1() {
  const p=PropertiesService.getScriptProperties();
  if(p.getProperty('SAHMT_CONTINUITY_SYNC_ENABLED')!=='YES')return {code:'CONTINUITY_SYNC_DISABLED'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'CONTINUITY_SYNC_BUSY'};
  try {
    if(Number(p.getProperty('SAHMT_CONTINUITY_PAUSE_UNTIL')||0)>Date.now())return {code:'CONTINUITY_SYNC_PAUSED'};
    if(p.getProperty('SAHMT_CONTINUITY_SEED_PENDING')==='YES')return ocsSeed_();
    const remote=ocsRemote_({schemaVersion:1,action:'drain'});
    if(!remote||remote.code!=='CONTINUITY_DRAIN'||!Array.isArray(remote.operations)||remote.operations.length>20)throw Error('CONTINUITY_DRAIN_INVALID');
    if(!remote.operations.length)return {code:'CONTINUITY_SYNC_IDLE',firestoreReads:0,firestoreWrites:0};
    const profiles={},reads={count:0},writes={count:0};let confirmed=0,conflicts=0;
    for(const operation of remote.operations){
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(operation.uid||''))throw Error('CONTINUITY_ID_INVALID');
      if(!Object.prototype.hasOwnProperty.call(profiles,operation.uid))profiles[operation.uid]=ocsGet_('users/'+operation.uid,reads);
      const profile=profiles[operation.uid],body=profile&&profile.data;
      const result=SahmtContinuity.reconcileContinuityOperation(operation,body||{}, {
        now:Date.now(),getDocument:function(path){return ocsGet_(path,reads);},
        commit:function(batch){ocsCommit_(batch);writes.count+=batch.length;}
      });
      // The private mirror is refreshed only from this actual server read.
      if(body)ocsRemote_({schemaVersion:1,profiles:[{schemaVersion:1,uid:operation.uid,verifiedAt:Date.now(),profile:body}],resources:[]});
      ocsRemote_({schemaVersion:1,action:'complete',uid:operation.uid,requestId:operation.requestId,state:result.state,...(result.state==='confirmed'?{record:result.record}:{})});
      if(result.state==='confirmed')confirmed++;else conflicts++;
    }
    return {code:'CONTINUITY_SYNC_FINISHED',confirmed:confirmed,conflicts:conflicts,firestoreReads:reads.count,firestoreWrites:writes.count};
  } catch(error) {
    const code=String(error.message||'');
    if(code==='CONTINUITY_FIRESTORE_429')p.setProperty('SAHMT_CONTINUITY_PAUSE_UNTIL',String(Date.now()+3600000));
    console.log(JSON.stringify({code:/^CONTINUITY_[A-Z_0-9]+$/.test(code)?code:'CONTINUITY_SYNC_UNAVAILABLE'}));
    return {code:/^CONTINUITY_[A-Z_0-9]+$/.test(code)?code:'CONTINUITY_SYNC_UNAVAILABLE'};
  } finally {lock.releaseLock();}
}
function ocsRemote_(body){
 const p=PropertiesService.getScriptProperties(),endpoint=p.getProperty('SAHMT_CONTINUITY_ENDPOINT'),secret=p.getProperty('SAHMT_CONTINUITY_IMPORT_SECRET');
 if(!/^https:\/\/sahmt-operational-channel\.[a-z0-9-]+\.workers\.dev\/v1\/operational-continuity\/import$/.test(endpoint||'')||!secret||secret.length<32)throw Error('CONTINUITY_CONFIG_MISSING');
 const text=JSON.stringify(body),time=String(Date.now()),nonce=Utilities.getUuid().replace(/-/g,''),hex=function(bytes){return bytes.map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');};
 const digest=hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8));
 const signature=hex(Utilities.computeHmacSha256Signature(time+'\n'+nonce+'\n'+digest,secret,Utilities.Charset.UTF_8));
 const r=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',payload:text,headers:{Origin:'https://anestesiahmtforms.github.io','X-Continuity-Time':time,'X-Continuity-Nonce':nonce,'X-Continuity-Signature':signature},muteHttpExceptions:true,followRedirects:false});
 if(r.getResponseCode()!==200)throw Error('CONTINUITY_REMOTE_'+r.getResponseCode());
 const value=JSON.parse(r.getContentText());if(!/^CONTINUITY_/.test(value.code||''))throw Error('CONTINUITY_REMOTE_INVALID');return value;
}
function ocsFirestore_(suffix,options){
 const url='https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents'+suffix;
 const r=UrlFetchApp.fetch(url,Object.assign({method:'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,followRedirects:false},options||{}));
 if(r.getResponseCode()===404)return null;
 if(r.getResponseCode()!==200)throw Error('CONTINUITY_FIRESTORE_'+r.getResponseCode());
 return JSON.parse(r.getContentText());
}
function ocsGet_(path,reads){
 if(!/^(users|events|labels|checklists|scheduleDays)\/[A-Za-z0-9_-]{1,128}$/.test(path))throw Error('CONTINUITY_PATH_INVALID');
 reads.count++;const value=ocsFirestore_('/'+path);return value?{data:ocsDecode_(value.fields),updateTime:value.updateTime}:null;
}
function ocsDecode_(fields){
 const decode=function(field){if('nullValue' in field)return null;if('stringValue' in field)return field.stringValue;if('booleanValue' in field)return field.booleanValue;if('integerValue' in field)return Number(field.integerValue);if('doubleValue' in field)return field.doubleValue;if('timestampValue' in field)return field.timestampValue;if('arrayValue' in field)return (field.arrayValue.values||[]).map(decode);if('mapValue' in field)return ocsDecode_(field.mapValue.fields||{});throw Error('CONTINUITY_FIELD_INVALID');};
 return Object.fromEntries(Object.entries(fields||{}).map(function(pair){return [pair[0],decode(pair[1])];}));
}
function ocsEncode_(value,key){
 if(value===null)return {nullValue:null};if(typeof value==='boolean')return {booleanValue:value};
 if(typeof value==='number')return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
 if(typeof value==='string')return /^(createdAt|updatedAt)$/.test(key||'')&&/^\d{4}-\d\d-\d\dT/.test(value)?{timestampValue:value}:{stringValue:value};
 if(Array.isArray(value))return {arrayValue:{values:value.map(function(item){return ocsEncode_(item);})}};
 if(value&&typeof value==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(function(pair){return [pair[0],ocsEncode_(pair[1],pair[0])];}))}};
 throw Error('CONTINUITY_FIELD_INVALID');
}
function ocsCommit_(batch){
 if(!Array.isArray(batch)||batch.length<1||batch.length>2)throw Error('CONTINUITY_BATCH_INVALID');
 ocsFirestore_(':commit',{method:'post',contentType:'application/json',payload:JSON.stringify({writes:batch.map(function(write){
  return {update:{name:'projects/sahmt-17a16/databases/(default)/documents/'+write.path,fields:ocsEncode_(write.record).mapValue.fields},currentDocument:write.currentDocument};
 })})});
}
/** Initial bounded snapshot only. No recurring collection scans after success. */
function ocsSeed_(){
 const p=PropertiesService.getScriptProperties(),now=Date.now(),day=Utilities.formatDate(new Date(now),'America/Sao_Paulo','yyyy-MM-dd'),resources=[];
 const docs=function(name,max,where){
  const query={from:[{collectionId:name}],limit:max+1};if(where)query.where=where;
  const result=ocsFirestore_(':runQuery',{method:'post',contentType:'application/json',payload:JSON.stringify({structuredQuery:query})});
  const rows=(result||[]).filter(function(row){return row.document;}).map(function(row){const doc=row.document;return {id:doc.name.split('/').pop(),data:ocsDecode_(doc.fields)};});
  if(rows.length>max)throw Error('CONTINUITY_SEED_CAPACITY');return rows;
 };
 // First request gates the whole job: quota failure prevents every later read.
 const users=docs('users',200),profiles=users.map(function(row){
  if(row.data.uid&&row.data.uid!==row.id)throw Error('CONTINUITY_UID_CONFLICT');
  return {schemaVersion:1,uid:row.id,verifiedAt:now,profile:Object.assign({},row.data,{uid:row.id})};
 });
 const put=function(kind,id,data){resources.push({schemaVersion:1,kind:kind,id:id,data:data,verifiedAt:now,revision:'seed:'+now,complete:true});};
 const read=function(path){const value=ocsFirestore_('/'+path);if(!value)throw Error('CONTINUITY_SEED_RESOURCE_MISSING');return ocsDecode_(value.fields);};
 const app=read('appConfig/app');put('appConfig','app',{features:app.features});
 const stations=docs('stations',200).map(function(row){return Object.assign({id:row.id},row.data);});put('stations','all',stations);
 const contacts=docs('contacts',200).map(function(row){return Object.assign({id:row.id},row.data);}).filter(function(row){return row.active===true;});put('contacts','active',contacts);
 const members=new Map();docs('eventMembers',200).forEach(function(row){members.set(row.id,Object.assign({id:row.id},row.data));});contacts.forEach(function(row){if(row.sigla)members.set(row.sigla,{id:row.sigla,sigla:row.sigla,name:row.name,active:true});});put('eventMembers','all',Array.from(members.values()));
 const staff=read('appConfig/labelStaff');put('labelStaff','all',staff.active===true&&Array.isArray(staff.siglas)?staff.siglas:[]);
 put('eventCatalogs','operational',read('eventCatalogs/operational'));
 put('vacations',day,docs('vacations',200).map(function(row){return Object.assign({id:row.id},row.data);}).filter(function(row){return row.active===true&&row.start<=day&&row.end>=day;}));
 const schedule=read('scheduleDays/'+day);put('scheduleDays',day,Object.assign({id:day},schedule));
 for(const kind of ['events','labels','checklists']){
  const rows=docs(kind,500,{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'date'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:day.slice(0,7)+'-01'}}},{fieldFilter:{field:{fieldPath:'date'},op:'LESS_THAN_OR_EQUAL',value:{stringValue:day}}}]}}).map(function(row){return Object.assign({id:row.id},row.data);});
  put(kind,day.slice(0,7),{records:rows,hasMore:false,...(kind==='checklists'?{stationIds:stations.map(function(row){return row.id;}),priorRecords:[]}: {})});
 }
 // Separate bounded requests prevent an aggregate body from exceeding 512 KiB.
 ocsRemote_({schemaVersion:1,profiles:profiles,resources:[]});
 for(const resource of resources)ocsRemote_({schemaVersion:1,profiles:[],resources:[resource]});
 p.setProperty('SAHMT_CONTINUITY_SEED_PENDING','NO');p.setProperty('SAHMT_CONTINUITY_SEED_READY',String(now));
 console.log(JSON.stringify({code:'CONTINUITY_SEED_READY',profiles:profiles.length,resources:resources.length,recurringFullScans:false}));
 return {code:'CONTINUITY_SEED_READY',profiles:profiles.length,resources:resources.length};
}
function instalarSincronizadorCanalRemotoV1(){
 if(String(Session.getEffectiveUser().getEmail()).toLowerCase()!=='anestesiahmtforms@gmail.com')throw Error('CONTINUITY_OWNER_REQUIRED');
 ocsRemote_({schemaVersion:1,action:'drain'});
 const triggers=ScriptApp.getProjectTriggers().filter(function(trigger){return trigger.getHandlerFunction()==='sincronizarCanalOperacionalRemotoV1';});
 if(triggers.length>1)throw Error('CONTINUITY_DUPLICATE_TRIGGER');
 if(!triggers.length)ScriptApp.newTrigger('sincronizarCanalOperacionalRemotoV1').timeBased().everyMinutes(15).create();
 PropertiesService.getScriptProperties().setProperty('SAHMT_CONTINUITY_SYNC_ENABLED','YES');
 console.log(JSON.stringify({code:'CONTINUITY_SYNC_INSTALLED',intervalMinutes:15,emptyQueueFirestoreReads:0}));
}
function desativarSincronizadorCanalRemotoV1(){
 PropertiesService.getScriptProperties().setProperty('SAHMT_CONTINUITY_SYNC_ENABLED','NO');
 ScriptApp.getProjectTriggers().filter(function(trigger){return trigger.getHandlerFunction()==='sincronizarCanalOperacionalRemotoV1';}).forEach(function(trigger){ScriptApp.deleteTrigger(trigger);});
 console.log(JSON.stringify({code:'CONTINUITY_SYNC_DISABLED',pendingRemoteRecordsPreserved:true}));
}
