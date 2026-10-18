// Writes bounded shards before atomically selecting their content hash in the manifest.
function dgrStorePolicy_(policy) {
  dgrValidatePolicy_(policy);
  const props=sahmtV2Properties_(),raw=JSON.stringify(policy);
  if(dgrPolicyBytes_(raw)<=8000){props.setProperty('SAHMT_READING_POLICY_JSON',raw);return;}
  const hash=sha256Hex_(raw),parts=[];let part='',size=0;
  for(const char of raw){const bytes=dgrPolicyBytes_(char);if(size+bytes>7000){parts.push(part);part='';size=0;}part+=char;size+=bytes;}if(part)parts.push(part);
  if(parts.length>64)throw Error('READING_CONFIG_INVALID');
  parts.forEach(function(value,index){const key='SAHMT_READING_POLICY_'+hash+'_'+index;props.setProperty(key,value);if(props.getProperty(key)!==value)throw Error('READING_CONFIG_INVALID');});
  props.setProperty('SAHMT_READING_POLICY_JSON',JSON.stringify({storageVersion:2,count:parts.length,sha256:hash}));
}
// Manual operator entrypoints only. Never invoked by doPost or a timer.
function dgrOperator_() {
  const operator = sahmtV2Properties_().getProperty('SAHMT_READING_OPERATOR_EMAIL');
  const effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!operator || operator !== effective || operator !== active) throw Error('READING_OPERATOR_DENIED');
}
function dgrNormalFingerprint_(permissions) {
  return formsEvaluationHash_(permissions.filter(function (p) {return !p.view;}).map(function (p) {return {id:p.id,type:p.type,role:p.role,email:p.emailAddress||''};}).sort(function (a,b) {return String(a.id).localeCompare(String(b.id));}));
}
function dgrRemovePublished_(formId, permissions) {
  permissions.filter(function (p) {return p.view === 'published';}).forEach(function (p) {
    if (!p.id || p.role !== 'reader' || !['user','group','domain','anyone'].includes(p.type) ||
        (p.permissionDetails || []).some(function (d) {return d.inherited === true;})) throw Error('READING_CUTOVER_DENIED');
    formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/'+formId+'/permissions/'+encodeURIComponent(p.id)+'?supportsAllDrives=true',{method:'delete'});
  });
}
function prepararBloqueioIndividualDiretrizesV1() {
  dgrOperator_();const props=sahmtV2Properties_(),policy=dgrPolicy_();
  if(props.getProperty('SAHMT_READING_ENABLED')==='YES')throw Error('READING_DISABLE_FIRST');
  const previous=props.getProperty('SAHMT_READING_RECOVERY_FILE_ID');
  if(previous && formsEvaluationHash_(dgrBackup_().policy)===formsEvaluationHash_(policy))return {code:'READING_RECOVERY_ALREADY_PREPARED'};
  Object.keys(policy.documents).forEach(function(id){const row=policy.documents[id];if(row.enforced)throw Error('READING_POLICY_ALREADY_ENFORCED');dgrCatalog_(id,row);dgrPdf_(row,false);});
  const entries=Object.keys(policy.documents).filter(function(id){return Boolean(policy.documents[id].formId);}).map(function (id) {
    const row=policy.documents[id];if(row.enforced)throw Error('READING_POLICY_ALREADY_ENFORCED');
    dgrCatalog_(id,row);dgrPdf_(row,false);
    const form=FormApp.openById(row.formId),permissions=formsEvaluationPublishedPermissions_(row.formId);
    if(!form.supportsAdvancedResponderPermissions()||permissions.some(function(p){return p.view==='published'&&(p.type!=='user'||p.role!=='reader'||!p.emailAddress||(p.permissionDetails||[]).some(function(d){return d.inherited===true;}));}))throw Error('READING_CUTOVER_DENIED');
    return {documentId:id,formId:row.formId,wasPublished:form.isPublished(),wasAccepting:form.isAcceptingResponses(),normalFingerprint:dgrNormalFingerprint_(permissions),permissions:permissions};
  });
  const backup={kind:'SAHMT_READING_RECOVERY_V1',scriptId:ScriptApp.getScriptId(),policy:policy,entries:entries,previousRecoveryFileId:previous||null};
  const file=DriveApp.createFile('SAHMT-reading-private-recovery.json',JSON.stringify(backup),'application/json');
  file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
  props.setProperty('SAHMT_READING_RECOVERY_FILE_ID',file.getId());
  console.log(JSON.stringify({code:'READING_RECOVERY_PREPARED',forms:entries.length,formWrites:0}));
  return {code:'READING_RECOVERY_PREPARED',forms:entries.length};
}
function instalarBloqueioIndividualDiretrizesV1() {
  dgrOperator_();const props=sahmtV2Properties_();
  if(props.getProperty('SAHMT_READING_ENABLED')==='YES')throw Error('READING_DISABLE_FIRST');
  const policy=dgrPolicy_();
  if(props.getProperty('SAHMT_READING_CUTOVER_SHA256')===formsEvaluationHash_(policy.documents))return {code:'READING_CUTOVER_ALREADY_VERIFIED'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('READING_BUSY');
  let currentForm;
  try{
    const backup=dgrBackup_();
    if(formsEvaluationHash_(backup.policy)!==formsEvaluationHash_(policy))throw Error('READING_RECOVERY_POLICY_CHANGED');
    const saved=JSON.parse(props.getProperty('SAHMT_READING_CUTOVER_CURSOR')||'null');
    let cursor=saved&&saved.backupId===props.getProperty('SAHMT_READING_RECOVERY_FILE_ID')?saved.index:0;
    if(!Number.isSafeInteger(cursor)||cursor<0||cursor>backup.entries.length)throw Error('READING_CURSOR_INVALID');
    const deadline=Date.now()+210000;
    for(;cursor<backup.entries.length;cursor++){
      if(Date.now()>deadline)return {code:'READING_CUTOVER_PENDING',completed:cursor,total:backup.entries.length};
      const entry=backup.entries[cursor];
      const row=policy.documents[entry.documentId];dgrCatalog_(entry.documentId,row);dgrPdf_(row,false);
      currentForm=FormApp.openById(row.formId);
      const before=formsEvaluationPublishedPermissions_(row.formId);
      if(dgrNormalFingerprint_(before)!==entry.normalFingerprint)throw Error('READING_EDITORS_CHANGED');
      formsEvaluationCloseForm_(currentForm);
      dgrRemovePublished_(row.formId,before);
      const after=formsEvaluationPublishedPermissions_(row.formId);
      if(after.some(function(p){return p.view==='published';})||dgrNormalFingerprint_(after)!==entry.normalFingerprint)throw Error('READING_CUTOVER_DENIED');
      currentForm.setPublished(true);currentForm.setAcceptingResponses(true);
      if(!currentForm.isPublished()||!currentForm.isAcceptingResponses()||formsEvaluationPublishedPermissions_(row.formId).some(function(p){return p.view==='published';}))throw Error('READING_CUTOVER_DENIED');
      currentForm=null;
      props.setProperty('SAHMT_READING_CUTOVER_CURSOR',JSON.stringify({backupId:props.getProperty('SAHMT_READING_RECOVERY_FILE_ID'),index:cursor+1}));
    }
    // Recheck earlier batches before claiming a fully closed participant audience.
    backup.entries.forEach(function(entry){
      const form=FormApp.openById(entry.formId),permissions=formsEvaluationPublishedPermissions_(entry.formId);
      if(!form.isPublished()||!form.isAcceptingResponses()||permissions.some(function(p){return p.view==='published';})||dgrNormalFingerprint_(permissions)!==entry.normalFingerprint)throw Error('READING_CUTOVER_DENIED');
      policy.documents[entry.documentId].enforced=true;
    });
    Object.keys(policy.documents).forEach(function(id){dgrCatalog_(id,policy.documents[id]);dgrPdf_(policy.documents[id],false);policy.documents[id].enforced=true;});
    dgrStorePolicy_(policy);
    props.setProperty('SAHMT_READING_CUTOVER_SHA256',formsEvaluationHash_(policy.documents));
    props.deleteProperty('SAHMT_READING_CUTOVER_CURSOR');
    console.log(JSON.stringify({code:'READING_CUTOVER_VERIFIED',forms:backup.entries.length,enabled:false}));
    return {code:'READING_CUTOVER_VERIFIED',forms:backup.entries.length};
  }catch(_){if(currentForm)formsEvaluationCloseForm_(currentForm);throw Error('READING_CUTOVER_PENDING');}
  finally{lock.releaseLock();}
}
function dgrBackup_() {
  const id=sahmtV2Properties_().getProperty('SAHMT_READING_RECOVERY_FILE_ID');
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(id||''))throw Error('READING_RECOVERY_MISSING');
  const backup=JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'));
  if(backup.kind!=='SAHMT_READING_RECOVERY_V1'||backup.scriptId!==ScriptApp.getScriptId()||!Array.isArray(backup.entries)||backup.entries.length>1000)throw Error('READING_RECOVERY_INVALID');
  return backup;
}
function reverterBloqueioIndividualDiretrizesV1() {
  dgrOperator_();const props=sahmtV2Properties_();props.setProperty('SAHMT_READING_ENABLED','NO');
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('READING_BUSY');
  let currentForm;
  try{
    const backup=dgrBackup_();
    backup.entries.forEach(function(entry){
      const original=entry.permissions.filter(function(p){return p.view==='published';});
      if(original.some(function(p){return p.type!=='user'||p.role!=='reader'||!p.emailAddress||(p.permissionDetails||[]).some(function(d){return d.inherited===true;});}))throw Error('READING_RECOVERY_INVALID');
      currentForm=FormApp.openById(entry.formId);formsEvaluationCloseForm_(currentForm);
      const before=formsEvaluationPublishedPermissions_(entry.formId);
      if(dgrNormalFingerprint_(before)!==entry.normalFingerprint)throw Error('READING_EDITORS_CHANGED');
      dgrRemovePublished_(entry.formId,before);
      original.forEach(function(p){formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/'+entry.formId+'/permissions?supportsAllDrives=true&sendNotificationEmail=false',
        {method:'post',contentType:'application/json',payload:JSON.stringify({type:'user',role:'reader',view:'published',emailAddress:p.emailAddress})});});
      const after=formsEvaluationPublishedPermissions_(entry.formId),expected=original.map(function(p){return p.emailAddress.toLowerCase();}).sort();
      const actual=after.filter(function(p){return p.view==='published';});
      if(dgrNormalFingerprint_(after)!==entry.normalFingerprint||actual.some(function(p){return p.type!=='user'||p.role!=='reader';})||
        JSON.stringify(actual.map(function(p){return String(p.emailAddress||'').toLowerCase();}).sort())!==JSON.stringify(expected))throw Error('READING_RECOVERY_PENDING');
      if(entry.wasPublished)currentForm.setPublished(true);
      currentForm.setAcceptingResponses(entry.wasAccepting===true);currentForm=null;
    });
    dgrStorePolicy_(backup.policy);props.deleteProperty('SAHMT_READING_CUTOVER_SHA256');
    props.deleteProperty('SAHMT_READING_CUTOVER_CURSOR');
    console.log(JSON.stringify({code:'READING_ROLLBACK_VERIFIED',forms:backup.entries.length,enabled:false}));
    return {code:'READING_ROLLBACK_VERIFIED'};
  }catch(_){if(currentForm)formsEvaluationCloseForm_(currentForm);throw Error('READING_RECOVERY_PENDING');}
  finally{lock.releaseLock();}
}
function fecharFormulariosLeituraDiretrizesV1() {
  dgrOperator_();const props=sahmtV2Properties_();props.setProperty('SAHMT_READING_ENABLED','NO');
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('READING_BUSY');
  let failures=0;
  try{
    const policy=dgrPolicy_();Object.keys(policy.documents).forEach(function(id){
      try{if(policy.documents[id].formId)formsEvaluationCloseForm_(FormApp.openById(policy.documents[id].formId));}catch(_){failures++;}
    });
    if(failures)throw Error('READING_CLOSE_PENDING');
    console.log(JSON.stringify({code:'READING_FORMS_CLOSED',enabled:false}));
    return {code:'READING_FORMS_CLOSED'};
  }finally{lock.releaseLock();}
}
