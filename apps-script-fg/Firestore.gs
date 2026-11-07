/** FG transaction boundary. FI/FJ are read-only inputs and never write targets. */
const FG_EXTERNAL_COLLECTIONS = Object.freeze({scheduleDays:'sahmt-escala-fj',vacations:'sahmt-escala-fj',events:'sahmt-operacional-fi',contacts:'sahmt-operacional-fi',userCategories:'sahmt-17a16'});
const FG_WRITABLE_COLLECTIONS = Object.freeze(['checklistSignatureRequests','checklistSignatures','checklistResponsibilities','checklistScienceRuntime','fgPerformanceRuntime','fgPerformanceReceipts','fgPerformanceLedger','fgPerformanceSummaries']);
const FG_TRANSACTIONS = new Map();
function fgCheckId_(id){if(typeof id!=='string'||!id||id.length>200||/[\s/\x00-\x1f]/.test(id)||['.','..'].includes(id))throw Error('FG_DOCUMENT_ID_INVALID');}
function fgCanonical_(value){
  if(Array.isArray(value))return value.map(fgCanonical_);
  return value&&typeof value==='object'&&!(value instanceof Date)?Object.fromEntries(Object.keys(value).sort().map(function(key){return [key,fgCanonical_(value[key])];})):value;
}
function fgExternalRequest_(collection,operation,body){
  const project=FG_EXTERNAL_COLLECTIONS[collection];
  if(!project||![':batchGet',':runQuery'].includes(operation))throw Error('FG_EXTERNAL_READ_SCOPE');
  if(collection==='userCategories'&&operation!==':batchGet')throw Error('FG_EXTERNAL_READ_SCOPE');
  const prefix='projects/'+project+'/databases/(default)/documents/';
  if(operation===':batchGet'){
    if(!Array.isArray(body.documents)||body.documents.length!==1||!body.documents[0].startsWith(prefix+collection+'/')||body.documents[0].slice((prefix+collection+'/').length).includes('/'))throw Error('FG_EXTERNAL_READ_SCOPE');
  }else if(body.structuredQuery.from.length!==1||body.structuredQuery.from[0].collectionId!==collection||body.structuredQuery.from[0].allDescendants)throw Error('FG_EXTERNAL_READ_SCOPE');
  const url='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents'+operation;
  const response=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify(body),headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,followRedirects:false});
  const status=response.getResponseCode();if(status<200||status>=300){const error=Error('FG_EXTERNAL_READ_HTTP_'+status);error.status=status;throw error;}
  const rows=JSON.parse(response.getContentText());
  if(!Array.isArray(rows)||rows.some(function(row){return row.error;}))throw Error('FG_EXTERNAL_READ_INCOMPLETE');
  rows.forEach(function(row){const name=row.document&&row.document.name||row.found&&row.found.name||row.missing;if(name&&(!name.startsWith(prefix+collection+'/')||name.slice((prefix+collection+'/').length).includes('/')))throw Error('FG_EXTERNAL_DOCUMENT_SCOPE');});
  return rows;
}
function fgRead_(collection,operation,body,transaction){
  if(FG_EXTERNAL_COLLECTIONS[collection]){
    const rows=fgExternalRequest_(collection,operation,body),context=transaction&&FG_TRANSACTIONS.get(transaction);
    if(context)context.observations.push({collection:collection,operation:operation,body:body,fingerprint:fgRowsFingerprint_(rows)});
    return rows;
  }
  const payload=Object.assign({},body,transaction?{transaction:transaction}:{});
  return firestoreRequest_(firestoreDocumentsUrl_(operation),{method:'post',contentType:'application/json',payload:JSON.stringify(payload)});
}
function fgRowsFingerprint_(rows){return JSON.stringify(fgCanonical_(rows.filter(function(row){return row.document||row.found||row.missing;}).map(function(row){return row.document||row.found||{missing:row.missing};})));}
function evaluationDocument_(document){
  const id=String(document.name).split('/').pop();
  return Object.assign(firestoreFieldsToJs_(document.fields||{}),{id:id,_documentName:document.name,_name:document.name,_updateTime:document.updateTime});
}
function evaluationGet_(collection,id,transaction,fields){
  fgCheckId_(id);const project=FG_EXTERNAL_COLLECTIONS[collection]||SAHMT_V2_CONFIG.projectId;
  const name='projects/'+project+'/databases/(default)/documents/'+collection+'/'+id;
  const rows=fgRead_(collection,':batchGet',{documents:[name],...(fields&&fields.length?{mask:{fieldPaths:fields}}:{})},transaction);
  if(!Array.isArray(rows)||rows.length!==1||rows[0].error)throw Error('FG_DOCUMENT_READ_INCOMPLETE');
  if(rows[0].missing===name)return null;
  if(rows[0].found&&rows[0].found.name===name)return evaluationDocument_(rows[0].found);
  throw Error('FG_DOCUMENT_READ_SCOPE');
}
function evaluationQuery_(collection,filters,order,maximum,fields,transaction){
  if(!/^[A-Za-z][A-Za-z0-9]{1,80}$/.test(collection)||!Number.isSafeInteger(maximum)||maximum<1||maximum>1001)throw Error('FG_QUERY_SCOPE');
  const query={from:[{collectionId:collection}],limit:maximum};filters=filters||[];order=order||[];
  if(filters.length===1)query.where={fieldFilter:filters[0]};
  if(filters.length>1)query.where={compositeFilter:{op:'AND',filters:filters.map(function(filter){return {fieldFilter:filter};})}};
  if(order.length)query.orderBy=order.map(function(item){return {field:{fieldPath:item.fieldPath},direction:item.direction};});
  if(fields&&fields.length)query.select={fields:fields.map(function(field){return {fieldPath:field};})};
  const rows=fgRead_(collection,':runQuery',{structuredQuery:query},transaction),project=FG_EXTERNAL_COLLECTIONS[collection]||SAHMT_V2_CONFIG.projectId;
  const prefix='projects/'+project+'/databases/(default)/documents/'+collection+'/';
  if(!Array.isArray(rows)||rows.some(function(row){return row.error||row.document&&(!row.document.name.startsWith(prefix)||row.document.name.slice(prefix.length).includes('/'));}))throw Error('FG_QUERY_INCOMPLETE');
  return rows.filter(function(row){return row.document;}).map(function(row){return evaluationDocument_(row.document);});
}
function queryFirestore_(collection,filters,order,maximum,fields){return evaluationQuery_(collection,filters,order,maximum,fields);}
function getFirestoreDocument_(collection,id,fields){return evaluationGet_(collection,id,null,fields);}
function evaluationActiveProfile_(profile,uid){return !!profile&&profile.uid===uid&&profile.active===true&&profile.access===true;}
function evaluationWrite_(collection,id,changes,previous,times){
  fgCheckId_(id);if(!FG_WRITABLE_COLLECTIONS.includes(collection))throw Error('FG_WRITE_SCOPE_DENIED');
  const fields={};Object.keys(changes).forEach(function(key){if(key[0]!=='_'&&changes[key]!==undefined&&!(times||[]).includes(key))fields[key]=changes[key];});
  const write={update:{name:firestoreDocumentName_(collection,id),fields:firestoreFieldsFromJs_(fields)},currentDocument:previous?{updateTime:previous._updateTime}:{exists:false}};
  if(previous){if(!previous._updateTime)throw Error('FG_WRITE_PRECONDITION_REQUIRED');write.updateMask={fieldPaths:Object.keys(fields)};}
  if(times&&times.length)write.updateTransforms=times.map(function(field){return {fieldPath:field,setToServerValue:'REQUEST_TIME'};});
  return write;
}
function checklistSourceTransaction_(callback){
  for(let attempt=0;attempt<3;attempt++){
    const opened=firestoreRequest_(firestoreDocumentsUrl_(':beginTransaction'),{method:'post',contentType:'application/json',payload:JSON.stringify({options:{readWrite:{}}})});
    if(typeof opened.transaction!=='string'||!opened.transaction)throw Error('FG_TRANSACTION_REQUIRED');
    const transaction=opened.transaction,context={observations:[]};FG_TRANSACTIONS.set(transaction,context);
    try{
      const plan=callback(transaction),prefix=firestoreDocumentName_('','');
      if(!plan||!Array.isArray(plan.writes)||plan.writes.length>40||plan.writes.some(function(write){return !write.update||!write.update.name.startsWith(prefix.slice(0,-1))||!FG_WRITABLE_COLLECTIONS.includes(write.update.name.split('/documents/')[1].split('/')[0]);}))throw Error('FG_TRANSACTION_WRITE_SCOPE');
      // Independent databases cannot share one transaction. Recheck all remote
      // inputs immediately before committing the locally atomic acceptance.
      context.observations.forEach(function(observation){if(fgRowsFingerprint_(fgExternalRequest_(observation.collection,observation.operation,observation.body))!==observation.fingerprint){const error=Error('FG_SOURCE_CHANGED');error.status=409;throw error;}});
      firestoreRequest_(firestoreDocumentsUrl_(':commit'),{method:'post',contentType:'application/json',payload:JSON.stringify({transaction:transaction,writes:plan.writes})});
      return plan.result;
    }catch(error){
      try{firestoreRequest_(firestoreDocumentsUrl_(':rollback'),{method:'post',contentType:'application/json',payload:JSON.stringify({transaction:transaction})});}catch(_){}
      if(![409,412].includes(error.status)||attempt===2)throw error;
    }finally{FG_TRANSACTIONS.delete(transaction);}
  }
}
