/** Exports FJ event awards without reading FA or FB. */
var FJ_FK_PERFORMANCE_START_ = Date.parse('2026-12-01T03:00:00.000Z');

function fjFkNormalize_(value) {
  return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
}

function fjFkList_(collection, cutoff, filters) {
  var prefix='projects/'+SAHMT_V2_CONFIG.projectId+'/databases/(default)/documents/'+collection+'/';
  var rows=[],cursor=null;
  for(;;){
    var query={from:[{collectionId:collection}],select:{fields:['uid','sigla','email','active','sheetDeleted','eventType','delayMultiple','date','memberSigla','status','createdAt'].map(function(fieldPath){return {fieldPath:fieldPath};})},
      orderBy:collection==='events'?[{field:{fieldPath:'createdAt'},direction:'ASCENDING'},{field:{fieldPath:'__name__'},direction:'ASCENDING'}]:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:1000};
    if(filters)query.where={compositeFilter:{op:'AND',filters:filters}};
    if(cursor)query.startAt={values:collection==='events'?[{timestampValue:cursor.createdAt},{referenceValue:cursor.name}]:[{referenceValue:cursor.name}],before:false};
    var result=firestoreRequest_(firestoreDocumentsUrl_(':runQuery'),{method:'post',contentType:'application/json',
      payload:JSON.stringify({structuredQuery:query,readTime:new Date(cutoff).toISOString()})});
    if(!Array.isArray(result)||result.some(function(item){return item.error||item.readTime&&Date.parse(item.readTime)!==cutoff;}))throw Error('FJ_FK_SOURCE_QUERY_INCOMPLETE');
    var documents=result.filter(function(item){return item.document;}).map(function(item){return item.document;});
    documents.forEach(function(document){
      if(typeof document.name!=='string'||!document.name.startsWith(prefix)||document.name.slice(prefix.length).includes('/'))throw Error('FJ_FK_SOURCE_SCOPE_DENIED');
      rows.push(Object.assign({id:document.name.slice(prefix.length)},firestoreFieldsToJs_(document.fields||{})));
      if(rows.length>30000)throw Error('FJ_FK_SOURCE_BATCH_LIMIT');
    });
    if(documents.length<1000)break;
    var last=documents[documents.length-1];
    if(collection==='events'){
      var raw=last.fields&&last.fields.createdAt&&last.fields.createdAt.timestampValue;
      if(typeof raw!=='string')throw Error('FJ_FK_SOURCE_CURSOR_INVALID');
      cursor={createdAt:raw,name:last.name};
    }else cursor={name:last.name};
  }
  return rows;
}

function fjFkPerformanceRows_(cutoff,effectiveFrom,since) {
  var contacts=fjFkList_('contacts',cutoff).filter(function(row){return row.active===true&&typeof row.sigla==='string'&&typeof row.email==='string'&&row.email.indexOf('@')>0;});
  var contactsBySigla=new Map();
  contacts.forEach(function(contact){var key=fjFkNormalize_(contact.sigla);if(!contactsBySigla.has(key))contactsBySigla.set(key,[]);contactsBySigla.get(key).push(contact);});
  var filters=[
    {fieldFilter:{field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:new Date(since).toISOString()}}},
    {fieldFilter:{field:{fieldPath:'createdAt'},op:'LESS_THAN',value:{timestampValue:new Date(cutoff).toISOString()}}}
  ];
  var events=fjFkList_('events',cutoff,filters),cutoffDay=Utilities.formatDate(new Date(effectiveFrom),'America/Sao_Paulo','yyyy-MM-dd'),today=Utilities.formatDate(new Date(cutoff),'America/Sao_Paulo','yyyy-MM-dd');
  var rows=[];
  events.forEach(function(event){
    var eventType=fjFkNormalize_(event.eventType),status=fjFkNormalize_(event.status);
    if(eventType!=='ATRASO'||event.active===false||event.sheetDeleted===true||['CANCELLED','CANCELED','CANCELADO','EXCLUIDO','DELETED'].indexOf(status)>=0)return;
    var createdAt=event.createdAt instanceof Date?event.createdAt.getTime():NaN;
    if(!Number.isSafeInteger(createdAt)||createdAt<effectiveFrom||createdAt<since||createdAt>=cutoff||typeof event.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||event.date<cutoffDay||event.date>today)
      throw Error('FJ_FK_SOURCE_ROW_INVALID');
    var sigla=fjFkNormalize_(event.memberSigla),matches=contactsBySigla.get(sigla)||[];
    if(!sigla||matches.length!==1)throw Error('FJ_FK_SOURCE_IDENTITY_UNRESOLVED');
    var multiple=event.delayMultiple,valid=(typeof multiple==='number'&&Number.isInteger(multiple)||typeof multiple==='string'&&/^[0-6]$/.test(multiple))&&Number(multiple)>=0&&Number(multiple)<=6;
    if(!valid)throw Error('FJ_FK_SOURCE_POINTS_INVALID');
    rows.push({id:event.id,uid:sigla,category:'OPERATIONS',points:Number(multiple)===0?-0.5:-Number(multiple),createdAt:createdAt,label:'Atraso em escala'});
  });
  return rows;
}

function fjPublishFunctionalPerformance() {
  var properties=PropertiesService.getScriptProperties(),cutoff=Math.floor(Date.now()/1000)*1000;
  if(cutoff<=FJ_FK_PERFORMANCE_START_)return {code:'FJ_FK_PUSH_NOT_STARTED'};
  var previous=Number(properties.getProperty('FK_FJ_PERFORMANCE_LAST_PUSH')||0),effectiveFrom=FJ_FK_PERFORMANCE_START_;
  var since=Math.max(effectiveFrom,previous);
  if(!Number.isSafeInteger(since)||since>=cutoff)return {code:'FJ_FK_PUSH_NOT_DUE'};
  var rows=fjFkPerformanceRows_(cutoff,effectiveFrom,since);
  var result=fkPushPerformanceSourceSnapshot_('FJ',cutoff,effectiveFrom,rows);
  properties.setProperty('FK_FJ_PERFORMANCE_LAST_PUSH',String(cutoff));
  return result;
}

function fjEnsureFunctionalPerformanceTrigger() {
  var triggers=ScriptApp.getProjectTriggers();
  if(!triggers.some(function(trigger){return trigger.getHandlerFunction()==='fjPublishFunctionalPerformance';}))
    ScriptApp.newTrigger('fjPublishFunctionalPerformance').timeBased().everyDays(1).atHour(1).create();
  return {code:'FJ_FK_TRIGGER_READY'};
}
