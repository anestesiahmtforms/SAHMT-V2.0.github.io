// Bounded, read-only production inventory. Writes only its private audit receipt and own trigger/state.
function gqaFail_(code) { throw Error('QUESTION_BANK_RUNTIME_AUDIT_' + code); }
function gqaConfig_() {
  if(typeof gqaTrustedConfig_ !== 'function')gqaFail_('CONFIG_MISSING');
  const c=gqaTrustedConfig_(),id=/^[A-Za-z0-9_-]{10,200}$/;
  if(!c || typeof c.enabled !== 'boolean' || typeof c.runId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(c.runId) || typeof c.operatorEmail !== 'string' || !c.operatorEmail.includes('@') || c.operatorEmail !== c.operatorEmail.toLowerCase() || !id.test(c.statusFileId || '') || !id.test(c.workspaceFolderId || '') || c.statusFileId === c.workspaceFolderId)gqaFail_('CONFIG_INVALID');
  if(String(Session.getEffectiveUser().getEmail() || '').toLowerCase() !== c.operatorEmail)gqaFail_('OWNER_DENIED');
  if(c.enabled && (!Number.isFinite(Date.parse(c.expiresAt)) || Date.parse(c.expiresAt) <= Date.now() || Date.parse(c.expiresAt)-Date.now() > 1800000))gqaFail_('CONFIG_EXPIRED');
  if(c.resumeVersion !== undefined && c.resumeVersion !== 1)gqaFail_('RESUME_INVALID');
  return c;
}
function gqaKey_(c) { return 'SAHMT_QUESTION_RUNTIME_AUDIT_' + gqpHash_(c.runId); }
function gqaState_(c) { const text=PropertiesService.getScriptProperties().getProperty(gqaKey_(c));return text?JSON.parse(text):null; }
function gqaSaveState_(c,state) { PropertiesService.getScriptProperties().setProperty(gqaKey_(c),JSON.stringify(state)); }
function gqaRemoveTrigger_() { ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'auditarBancosQuestoesGestaoV1'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); }); }
function gqaSchedule_(delay) { gqaRemoveTrigger_();ScriptApp.newTrigger('auditarBancosQuestoesGestaoV1').timeBased().after(delay).create(); }
function gqaFixtures_(c) {
  const isolated=gqcConfig_();
  if(isolated.runId !== c.runId || isolated.operatorEmail !== c.operatorEmail || isolated.ids.workspace !== c.workspaceFolderId || Object.keys(isolated.ids).some(function(k) { return isolated.ids[k] === c.statusFileId; }))gqaFail_('FIXTURE_CHANGED');
  // This reader writes only its private receipt: completed Form/DOC fixtures are not its inputs.
  gqcFile_(isolated,isolated.ids.root,'root','application/vnd.google-apps.folder');
  gqcFile_(isolated,isolated.ids.workspace,'workspace','application/vnd.google-apps.folder',isolated.ids.root);
  const cfg=gqpConfig_(gqpTrustedConfig_());if(cfg.enabled)gqaFail_('PRODUCTION_CONFIG_ENABLED');
  if(cfg.bindings.some(function(b) { return [b.formId,b.documentId,b.reviewFolderId,b.readingFolderId].includes(c.statusFileId); }))gqaFail_('PRODUCTION_COLLISION');
  gqaStatusFile_(c);return cfg;
}
function gqaStatusFile_(c) {
  const m=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+c.statusFileId+'?fields=id,mimeType,parents,trashed,properties,owners(emailAddress)');
  if(m.id !== c.statusFileId || m.trashed || m.mimeType !== 'application/json' || !(m.parents || []).includes(c.workspaceFolderId) || !m.properties || m.properties.sahmtCasRun !== c.runId || m.properties.sahmtCasRole !== 'inventoryStatus' || !m.owners || m.owners.length !== 1 || m.owners[0].emailAddress !== c.operatorEmail)gqaFail_('STATUS_INVALID');
  const grants=graPermissions_(c.statusFileId).filter(function(p) { return p.view !== 'metadata'; });
  if(grants.length !== 1 || grants[0].type !== 'user' || grants[0].role !== 'owner' || grants[0].emailAddress !== c.operatorEmail)gqaFail_('STATUS_NOT_PRIVATE');
}
function gqaWrite_(c,data,receipt) { (receipt || gqpPrivateFile_(c.statusFileId)).setContent(JSON.stringify(data)); }
function gqaRead_(c,receipt) { return JSON.parse((receipt || gqpPrivateFile_(c.statusFileId)).getBlob().getDataAsString('UTF-8')); }
function gqaArmFromMaintenance_() {
  if(typeof gqaTrustedConfig_ !== 'function')return {code:'QUESTION_BANK_RUNTIME_AUDIT_DISABLED'};
  const c=gqaConfig_();if(!c.enabled)return {code:'QUESTION_BANK_RUNTIME_AUDIT_DISABLED'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'QUESTION_BANK_RUNTIME_AUDIT_BUSY'};
  try {
    const existing=gqaState_(c);
    if(existing) {
      if(c.resumeVersion !== 1 || existing.resumeVersion === 1)return {code:'QUESTION_BANK_RUNTIME_AUDIT_ALREADY_ARMED'};
      const cfg=gqaFixtures_(c),data=gqaRead_(c);
      if(existing.runId !== c.runId || existing.configSha256 !== gqpHash_(cfg))gqaFail_('BINDINGS_CHANGED');
      if(data.runId !== c.runId || !Array.isArray(data.records) || data.cursor !== data.records.length || data.total !== cfg.bindings.length || data.records.some(function(r,n) { return r.formId !== cfg.bindings[n].formId || r.documentId !== cfg.bindings[n].documentId; }))gqaFail_('STATE_INVALID');
      if(data.cursor >= data.total)return {code:'QUESTION_BANK_RUNTIME_AUDIT_ALREADY_COMPLETE'};
      // An explicit private continuation extends only the read window, never resets the cursor.
      const triggerPresent=ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'auditarBancosQuestoesGestaoV1'; });
      data.continuation={version:1,previousDeadlineAt:data.deadlineAt,previousPhase:existing.phase,triggerPresent:triggerPresent,resumedAt:new Date().toISOString()};
      data.deadlineAt=new Date(Math.min(Date.now()+1200000,Date.parse(c.expiresAt))).toISOString();data.result=gqaSummary_(data,false);data.observedAt=new Date().toISOString();gqaWrite_(c,data);
      existing.resumeVersion=1;existing.previousStartedAt=existing.startedAt;existing.startedAt=new Date().toISOString();existing.phase='ARMED';existing.cursor=data.cursor;gqaSaveState_(c,existing);gqaSchedule_(1000);
      return {code:'QUESTION_BANK_RUNTIME_AUDIT_RESUMED',checked:data.cursor,total:data.total,previousTriggerPresent:triggerPresent};
    }
    const cfg=gqaFixtures_(c),state={runId:c.runId,phase:'ARMED',startedAt:new Date().toISOString(),cursor:0,configSha256:gqpHash_(cfg)};
    const data={version:1,runId:c.runId,startedAt:state.startedAt,deadlineAt:new Date(Math.min(Date.now()+1200000,Date.parse(c.expiresAt))).toISOString(),cursor:0,total:cfg.bindings.length,records:[],result:{code:'QUESTION_BANK_RUNTIME_AUDIT_PROGRESS',total:cfg.bindings.length,checked:0,questions:0,changedDocuments:0,failures:{},firestoreReads:0,formWrites:0,automaticContinuation:true}};
    gqaWrite_(c,data);gqaSaveState_(c,state);gqaSchedule_(60000);return {code:'QUESTION_BANK_RUNTIME_AUDIT_ARMED'};
  } finally { lock.releaseLock(); }
}
function gqaForm_(id) {
  let response;
  try { response=UrlFetchApp.fetch('https://forms.googleapis.com/v1/forms/'+encodeURIComponent(id),{method:'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken(),'x-goog-user-project':'sahmt-17a16'},followRedirects:false,muteHttpExceptions:true}); }
  catch(_) { gqaFail_('FORMS_NETWORK_ERROR'); }
  const status=response.getResponseCode();
  if(status !== 200) {
    let reason='';
    if(status === 403) { try { const body=JSON.parse(response.getContentText());if(body && body.error && Array.isArray(body.error.details) && body.error.details.some(function(d) { return d.reason === 'SERVICE_DISABLED'; }))reason='_SERVICE_DISABLED'; } catch(_) {} }
    gqaFail_('FORMS_HTTP_'+status+reason);
  }
  try { const form=JSON.parse(response.getContentText());if(form.formId !== id || !form.revisionId)gqaFail_('FORM_IDENTITY_INVALID');return form; }
  catch(e) { if(e.message === 'QUESTION_BANK_RUNTIME_AUDIT_FORM_IDENTITY_INVALID')throw e;gqaFail_('FORM_JSON_INVALID'); }
}
function gqaDocument_(b,operatorEmail) {
  const m=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(b.documentId)+'?fields=id,mimeType,parents,trashed,size,owners(emailAddress)');
  if(m.id !== b.documentId || m.trashed || m.mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || !(m.parents || []).includes(b.reviewFolderId) || !m.owners || m.owners.length !== 1 || m.owners[0].emailAddress !== operatorEmail || !Number.isFinite(Number(m.size)) || Number(m.size) <= 0 || Number(m.size) > 20*1024*1024)gqaFail_('DOCUMENT_IDENTITY_INVALID');
  const blob=gpdfHttp_('https://www.googleapis.com/drive/v3/files/'+b.documentId+'?alt=media').getBlob();
  if(blob.getBytes().length !== Number(m.size))gqaFail_('DOCUMENT_DOWNLOAD_INVALID');
  return {blob:blob,sha256:gqpBytesHash_(blob.getBytes())};
}
function gqaOne_(b,c) {
  const form=gqaForm_(b.formId),model=gqpModel_(form),document=gqaDocument_(b,c.operatorEmail),edited=gqrParse_(gqrRows_(document.blob),model),plan=gqpPlan_(form,edited);
  return {formId:b.formId,documentId:b.documentId,sha256:document.sha256,questionCount:model.questions.length,changedQuestions:plan.requests.length,code:'QUESTION_BANK_RUNTIME_AUDIT_DOCUMENT_OK'};
}
function gqaSummary_(data,terminal) {
  const failures={};let questions=0,changed=0;
  data.records.forEach(function(r) { if(r.code === 'QUESTION_BANK_RUNTIME_AUDIT_DOCUMENT_OK') { questions+=r.questionCount;if(r.changedQuestions)changed++; } else failures[r.code]=(failures[r.code] || 0)+1; });
  return {code:terminal?data.cursor === data.total && !Object.keys(failures).length?'QUESTION_BANK_RUNTIME_AUDIT_READY':'QUESTION_BANK_RUNTIME_AUDIT_PARTIAL':'QUESTION_BANK_RUNTIME_AUDIT_PROGRESS',total:data.total,checked:data.records.length,questions:questions,changedDocuments:changed,failures:failures,firestoreReads:0,formWrites:0,automaticContinuation:!terminal};
}
function gqaCoordinationFailure_(c,error) {
  gqaRemoveTrigger_();
  let result={code:'QUESTION_BANK_RUNTIME_AUDIT_PARTIAL',category:/^(?:QUESTION_BANK_RUNTIME_AUDIT|QUESTION_CAS_VALIDATION|QUESTION_PUBLICATION)_[A-Z0-9_]+$/.test(error.message || '')?error.message:'QUESTION_BANK_RUNTIME_AUDIT_COORDINATION_UNAVAILABLE',firestoreReads:0,formWrites:0,automaticContinuation:false};
  const state=gqaState_(c);
  if(state && state.runId === c.runId && !['DONE','FAILED'].includes(state.phase)) { state.phase='FAILED';gqaSaveState_(c,state); }
  try {
    // Verify the private receipt independently of the failed disposable-test coordinator.
    gqaStatusFile_(c);const data=gqaRead_(c);
    if(data.runId === c.runId && Array.isArray(data.records)) { result=Object.assign({},gqaSummary_(data,true),result);data.result=result;data.observedAt=new Date().toISOString();gqaWrite_(c,data); }
  } catch(_) {} // Do not overwrite an unverified file or leak a secondary service error.
  if(state && state.runId === c.runId && state.phase === 'FAILED') { state.result=result;gqaSaveState_(c,state); }
  console.log(JSON.stringify(result));return result;
}
function auditarBancosQuestoesGestaoV1() {
  const c=gqaConfig_();if(!c.enabled)return {code:'QUESTION_BANK_RUNTIME_AUDIT_DISABLED'};
  const known=gqaState_(c);if(known && ['DONE','FAILED'].includes(known.phase))return known.result || gqaRead_(c).result;
  let cas;
  try {
    if(typeof gqdRead_ === 'function' && typeof gqdConfig_ === 'function') {
      const disposable=gqdConfig_();cas=gqdRead_(disposable);
      // Temporary coordination only: arm the prevalidated disposable fixture outside the audit lock.
      if(!cas && typeof gqdArmFromMaintenance_ === 'function') { gqdArmFromMaintenance_();cas=gqdRead_(disposable); }
    } else cas=gqcRead_(gqcConfig_());
  } catch(e) { return gqaCoordinationFailure_(c,e); }
  if(!cas || !['DONE','FAILED'].includes(cas.phase)) {
    const waiting=gqaState_(c);
    if(waiting && !['DONE','FAILED'].includes(waiting.phase) && Date.now()-Date.parse(waiting.startedAt)<1200000 && Date.now()+60000<Date.parse(c.expiresAt))gqaSchedule_(60000);
    return {code:'QUESTION_BANK_RUNTIME_AUDIT_WAITING_FOR_CAS'};
  }
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)) {
    const busyState=gqaState_(c);
    if(busyState && !['DONE','FAILED'].includes(busyState.phase) && Date.now()-Date.parse(busyState.startedAt)<1200000 && Date.now()+60000<Date.parse(c.expiresAt))gqaSchedule_(60000);
    return {code:'QUESTION_BANK_RUNTIME_AUDIT_BUSY'};
  }
  let state,data;
  try {
    state=gqaState_(c);if(!state || state.runId !== c.runId)gqaFail_('NOT_ARMED');
    if(['DONE','FAILED'].includes(state.phase))return gqaRead_(c).result;
    const cfg=gqaFixtures_(c);if(gqpHash_(cfg) !== state.configSha256)gqaFail_('BINDINGS_CHANGED');
    // Revalidate the exact private receipt once per bounded batch, retaining each document checkpoint.
    const receipt=gqpPrivateFile_(c.statusFileId);
    data=gqaRead_(c,receipt);
    if(data.runId !== c.runId || !Array.isArray(data.records) || data.cursor !== data.records.length || data.total !== cfg.bindings.length || data.cursor < 0 || data.cursor > data.total)gqaFail_('STATE_INVALID');
    gqaRemoveTrigger_();let processed=0,terminal=Date.now()>=Date.parse(data.deadlineAt),batchStart=Date.now();
    while(!terminal && data.cursor<data.total && processed<24 && Date.now()-batchStart<90000) {
      const b=cfg.bindings[data.cursor];let record;
      try { record=gqaOne_(b,c); }
      catch(e) {
        const category=/^(?:QUESTION_BANK_RUNTIME_AUDIT|QUESTION_REVISION|QUESTION_PUBLICATION|PDF_SYNC)_[A-Z0-9_]+$/.test(e.message || '')?e.message:'QUESTION_BANK_RUNTIME_AUDIT_DOCUMENT_UNAVAILABLE';
        record={formId:b.formId,documentId:b.documentId,sha256:null,questionCount:null,changedQuestions:null,code:category};
        if(/^QUESTION_BANK_RUNTIME_AUDIT_FORMS_(?:HTTP_(?:401|403|429|5\d\d)|NETWORK_ERROR)/.test(category))terminal=true;
      }
      data.records.push(record);data.cursor++;processed++;
      if(Date.now()>=Date.parse(data.deadlineAt))terminal=true;
      // Persist each completed read, so a receipt failure never silently repeats a document.
      data.result=gqaSummary_(data,terminal || data.cursor === data.total);gqaWrite_(c,data,receipt);
      state.cursor=data.cursor;gqaSaveState_(c,state);
    }
    terminal=terminal || data.cursor === data.total || Date.now()+1000>=Date.parse(data.deadlineAt);
    data.result=gqaSummary_(data,terminal);data.observedAt=new Date().toISOString();gqaWrite_(c,data,receipt);
    state.phase=terminal?'DONE':'ARMED';state.cursor=data.cursor;gqaSaveState_(c,state);
    if(!terminal)gqaSchedule_(1000);else gqaRemoveTrigger_();
    console.log(JSON.stringify(data.result));return data.result;
  } catch(e) {
    gqaRemoveTrigger_();
    const result={code:'QUESTION_BANK_RUNTIME_AUDIT_PARTIAL',category:/^QUESTION_BANK_RUNTIME_AUDIT_[A-Z0-9_]+$/.test(e.message || '')?e.message:'QUESTION_BANK_RUNTIME_AUDIT_UNAVAILABLE',firestoreReads:0,formWrites:0,automaticContinuation:false};
    if(state) { state.phase='FAILED';gqaSaveState_(c,state); }
    if(data) { data.result=result;gqaWrite_(c,data); }
    console.log(JSON.stringify(result));return result;
  } finally { lock.releaseLock(); }
}
