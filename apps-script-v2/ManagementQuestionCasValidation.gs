// Disposable, owner-only proof of the real conditional Forms publication adapter.
// No production binding, Firestore lookup, watcher or automatic retry is installed.
function gqcFail_(code) { throw Error('QUESTION_CAS_VALIDATION_' + code); }
function gqcConfig_() {
  if(typeof gqcTrustedConfig_ !== 'function')gqcFail_('CONFIG_MISSING');
  const c=gqcTrustedConfig_(),keys=['root','content','review','workspace','questions','status'],id=/^[A-Za-z0-9_-]{10,200}$/;
  if(!c || typeof c.enabled !== 'boolean' || typeof c.runId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(c.runId) || typeof c.operatorEmail !== 'string' || !c.operatorEmail.includes('@') || c.operatorEmail !== c.operatorEmail.toLowerCase() || !c.ids || Object.keys(c.ids).length !== keys.length || keys.some(function(k) { return !id.test(c.ids[k] || ''); }) || new Set(keys.map(function(k) { return c.ids[k]; })).size !== keys.length)gqcFail_('CONFIG_INVALID');
  if(String(Session.getEffectiveUser().getEmail() || '').toLowerCase() !== c.operatorEmail)gqcFail_('OWNER_DENIED');
  if(c.enabled && (!Number.isFinite(Date.parse(c.expiresAt)) || Date.parse(c.expiresAt) <= Date.now() || Date.parse(c.expiresAt)-Date.now() > 1800000))gqcFail_('CONFIG_EXPIRED');
  return c;
}
function gqcStateKey_(c) { return 'SAHMT_QUESTION_CAS_VALIDATION_' + gqpHash_(c.runId); }
function gqcRead_(c) { const text=PropertiesService.getScriptProperties().getProperty(gqcStateKey_(c));return text?JSON.parse(text):null; }
function gqcSave_(c,state) {
  const phase=state.phase === 'ARMED' || state.phase === 'RUNNING' && !state.stage?state.phase:null;
  const publish=phase && state.progressPublished !== phase;
  if(publish)state.progressPublished=phase;
  PropertiesService.getScriptProperties().setProperty(gqcStateKey_(c),JSON.stringify(state));
  if(publish) {
    // A failed optional progress receipt must never stop the claimed validation.
    try { gqcStatus_(c,{code:'QUESTION_CAS_VALIDATION_'+phase,productionWrites:0,firestoreReads:0}); } catch(_) {}
  }
}
function gqcRemoveTrigger_() {
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'validarPublicacaoQuestoesIsoladaV1'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
}
function gqcFile_(c,id,role,mime,parent) {
  const m=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,mimeType,parents,trashed,properties,owners(emailAddress),inheritedPermissionsDisabled');
  if(m.id !== id || m.trashed || m.mimeType !== mime || parent && !(m.parents || []).includes(parent) || !m.properties || m.properties.sahmtCasRun !== c.runId || m.properties.sahmtCasRole !== role || !m.owners || m.owners.length !== 1 || m.owners[0].emailAddress !== c.operatorEmail)gqcFail_('FIXTURE_CHANGED');
  const grants=graPermissions_(id).filter(function(p) { return p.view !== 'metadata'; });
  if(grants.length !== 1 || grants[0].type !== 'user' || grants[0].role !== 'owner' || grants[0].emailAddress !== c.operatorEmail)gqcFail_('FIXTURE_NOT_PRIVATE');
  if(role === 'review' && m.inheritedPermissionsDisabled !== true)gqcFail_('REVIEW_FOLDER_INVALID');
  return m;
}
function gqcFixtures_(c,state) {
  if(typeof gqpTrustedConfig_ !== 'function' || typeof gpdfConfig_ !== 'function')gqcFail_('PRODUCTION_CONFIG_MISSING');
  const production=gqpConfig_(gqpTrustedConfig_()),pdf=gpdfConfig_(),protectedIds=[];
  production.bindings.forEach(function(b) { ['formId','documentId','reviewFolderId','readingFolderId'].forEach(function(k) { protectedIds.push(b[k]); }); });
  (pdf.pairs || []).forEach(function(p) { ['sourceId','pdfId','folderId','sourceFolderId'].forEach(function(k) { if(p[k])protectedIds.push(p[k]); }); });
  if(pdf.workspaceFolderId)protectedIds.push(pdf.workspaceFolderId);
  const selected=Object.keys(c.ids).map(function(k) { return c.ids[k]; }).concat(state && state.formId || []);
  if(selected.some(function(id) { return protectedIds.includes(id); }))gqcFail_('PRODUCTION_COLLISION');
  const folder='application/vnd.google-apps.folder';
  gqcFile_(c,c.ids.root,'root',folder);
  gqcFile_(c,c.ids.content,'content',folder,c.ids.root);
  gqcFile_(c,c.ids.review,'review',folder,c.ids.content);
  gqcFile_(c,c.ids.workspace,'workspace',folder,c.ids.root);
  gqcFile_(c,c.ids.questions,'questions','application/vnd.openxmlformats-officedocument.wordprocessingml.document',c.ids.review);
  gqcFile_(c,c.ids.status,'status','application/json',c.ids.workspace);
  if(state && state.formId)gqcFile_(c,state.formId,'form','application/vnd.google-apps.form',c.ids.content);
}
function gqcStatus_(c,result) {
  gqcFile_(c,c.ids.status,'status','application/json',c.ids.workspace);
  gqpPrivateFile_(c.ids.status).setContent(JSON.stringify({version:1,observedAt:new Date().toISOString(),result:result}));
  console.log(JSON.stringify(result));return result;
}
function gqcArmFromMaintenance_() {
  // Calling this inert helper from maintenance is temporary; only its own trigger is touched.
  if(typeof gqcTrustedConfig_ !== 'function')return {code:'QUESTION_CAS_VALIDATION_DISABLED'};
  const c=gqcConfig_();if(!c.enabled)return {code:'QUESTION_CAS_VALIDATION_DISABLED'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'QUESTION_CAS_VALIDATION_BUSY'};
  try {
    const state=gqcRead_(c);if(state)return {code:'QUESTION_CAS_VALIDATION_ALREADY_ARMED'};
    gqcFixtures_(c,null);
    gqcRemoveTrigger_();gqcSave_(c,{version:1,runId:c.runId,phase:'ARMED'});
    ScriptApp.newTrigger('validarPublicacaoQuestoesIsoladaV1').timeBased().after(1000).create();
    return {code:'QUESTION_CAS_VALIDATION_ARMED'};
  } finally { lock.releaseLock(); }
}
function gqcResponses_(form) {
  return form.getResponses().map(function(r) { return {id:r.getId(),at:r.getTimestamp().toISOString(),answers:r.getItemResponses().map(function(a) { return {itemId:a.getItem().getId(),answer:a.getResponse(),score:typeof a.getScore === 'function'?a.getScore():null}; })}; });
}
function gqcClose_(form) {
  form.setAcceptingResponses(false);if(form.isPublished())form.setPublished(false);
  if(form.isPublished() || form.isAcceptingResponses())gqcFail_('FORM_NOT_CLOSED');
}
function gqcBindDoc_(c,codes) {
  gqcFile_(c,c.ids.questions,'questions','application/vnd.openxmlformats-officedocument.wordprocessingml.document',c.ids.review);
  const source=gpdfHttp_('https://www.googleapis.com/drive/v3/files/'+c.ids.questions+'?alt=media').getBlob();
  let documentXml=0;
  const parts=Utilities.unzip(source.copyBlob().setContentType('application/zip')).map(function(part) {
    if(part.getName() !== 'word/document.xml')return part;
    documentXml++;let xml=part.getDataAsString('UTF-8');
    codes.forEach(function(code,n) { const marker='__Q'+(n+1)+'__';if(!/^[A-Za-z0-9_-]+$/.test(code) || xml.split(marker).length !== 2)gqcFail_('QUESTION_MARKER_INVALID');xml=xml.split(marker).join(code); });
    return Utilities.newBlob(xml,'application/xml',part.getName());
  });
  if(documentXml !== 1)gqcFail_('QUESTION_MARKER_INVALID');
  const next=Utilities.zip(parts,'questoes-isoladas.docx').setContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  gpdfHttp_('https://www.googleapis.com/upload/drive/v3/files/'+c.ids.questions+'?uploadType=media',{method:'patch',contentType:next.getContentType(),payload:next.getBytes()});
  return next;
}
function gqcRecoveryPorts_(c,state,cfg) {
  const ports=gqpPorts_(cfg),records={};
  // These are the only synthetic dependencies. Forms, Drive, CAS and locks use production adapters.
  ports.assignment=function() { return {uid:'SyntheticManager123456',version:1}; };
  ports.profile=function(uid) { if(uid !== 'SyntheticManager123456')gqcFail_('SYNTHETIC_IDENTITY_INVALID');return {uid:uid,email:c.operatorEmail,active:true,access:true}; };
  ports.load=function(key) {
    if(!state.recoveryId)return null;
    gqcFile_(c,state.recoveryId,'recovery','text/plain',c.ids.workspace);
    const saved=JSON.parse(gqpPrivateFile_(state.recoveryId).getBlob().getDataAsString('UTF-8'));
    return saved.key === key?saved.value:null;
  };
  ports.save=function(key,value) {
    if(!state.recoveryId) {
      const file=DriveApp.createFile('SAHMT Recuperacao CAS descartavel.json','{}',MimeType.PLAIN_TEXT);state.recoveryId=file.getId();gqcSave_(c,state);
      file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);file.moveTo(DriveApp.getFolderById(c.ids.workspace));
      gpdfJson_('https://www.googleapis.com/drive/v3/files/'+state.recoveryId+'?fields=id',{method:'patch',contentType:'application/json',payload:JSON.stringify({properties:{sahmtCasRun:c.runId,sahmtCasRole:'recovery'}})});
    }
    gqcFile_(c,state.recoveryId,'recovery','text/plain',c.ids.workspace);
    records[key]=value;gqpPrivateFile_(state.recoveryId).setContent(JSON.stringify({key:key,value:value}));
  };
  return ports;
}
function gqcExercise_(c,state) {
  let form;
  try {
    state.stage='FORM_CREATE';
    form=FormApp.create('SAHMT VALIDACAO CAS DESCARTAVEL '+c.runId,false);state.formId=form.getId();gqcSave_(c,state);
    const file=DriveApp.getFileById(state.formId);file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);file.moveTo(DriveApp.getFolderById(c.ids.content));
    gpdfJson_('https://www.googleapis.com/drive/v3/files/'+state.formId+'?fields=id',{method:'patch',contentType:'application/json',payload:JSON.stringify({properties:{sahmtCasRun:c.runId,sahmtCasRole:'form'}})});
    gqcFixtures_(c,state);form.setIsQuiz(true);
    for(let n=1;n<=2;n++) { const q=form.addMultipleChoiceItem().setTitle('Qual a opção correta na questão '+n+'?').setHelpText('Descrição original').setPoints(2).setRequired(true);q.setChoices([q.createChoice('Alternativa A',false),q.createChoice('Alternativa B',true)]); }
    state.stage='FORM_OWNER_ONLY_RESPONSE';gqcSave_(c,state);
    if(!formsEvaluationSyncResponders_(form,[c.operatorEmail]))gqcFail_('PRIVATE_AUDIENCE_UNAVAILABLE');
    let response=form.createResponse();form.getItems().forEach(function(i) { const q=i.asMultipleChoiceItem();response=response.withItemResponse(q.createResponse('Alternativa B')); });
    response=response.submit();state.responseId=response.getId();gqcSave_(c,state);gqcClose_(form);
    const originalResponses=gqcResponses_(FormApp.openById(state.formId));
    if(originalResponses.length !== 1 || originalResponses[0].id !== state.responseId)gqcFail_('RESPONSE_INVALID');
    const fixtureCfg={version:1,enabled:true,apiQuotaProjectId:'sahmt-17a16',operatorEmail:c.operatorEmail,administratorEditorEmails:[],bindings:[{formId:state.formId,documentId:c.ids.questions,reviewFolderId:c.ids.review,readingFolderId:c.ids.content,assignment:{uid:'SyntheticManager123456',version:1}}]};
    const ports=gqcRecoveryPorts_(c,state,fixtureCfg);
    state.stage='FORMS_API_BASELINE';gqcSave_(c,state);
    const baseline=ports.form(state.formId),model=gqpModel_(baseline);
    if(model.questions.length !== 2)gqcFail_('QUESTION_COUNT_INVALID');
    const blob=gqcBindDoc_(c,model.questions.map(function(q) { return q.questionId; })),edited=gqrParse_(gqrRows_(blob),model),plan=gqpPlan_(baseline,edited);
    if(plan.requests.length !== 1)gqcFail_('QUESTION_PLAN_INVALID');
    const approval={version:1,formId:state.formId,documentId:c.ids.questions,managerUid:'SyntheticManager123456',assignmentVersion:1,approvedBy:c.operatorEmail,approvedAt:new Date().toISOString(),expiresAt:c.expiresAt,documentSha256:gqpBytesHash_(blob.getBytes()),baselineForm:baseline};
    state.stage='CAS_APPLY_LOST_RESPONSE';gqcSave_(c,state);
    const realBatch=ports.batch;let actualBatches=0,lostResponse=false;
    ports.batch=function(id,body) { const answer=realBatch(id,body);actualBatches++;throw Error('QUESTION_CAS_VALIDATION_SIMULATED_RESPONSE_LOSS'); };
    try { gqpPublish_(fixtureCfg,approval,ports); } catch(e) { if(e.message !== 'QUESTION_CAS_VALIDATION_SIMULATED_RESPONSE_LOSS')throw e;lostResponse=true; }
    if(!lostResponse || actualBatches !== 1)gqcFail_('LOST_RESPONSE_NOT_EXERCISED');
    ports.batch=function(id,body) { actualBatches++;return realBatch(id,body); };
    state.stage='CAS_RECOVERY';gqcSave_(c,state);
    const recovered=gqpPublish_(fixtureCfg,approval,ports),repeated=gqpPublish_(fixtureCfg,approval,ports),after=ports.form(state.formId),afterModel=gqpModel_(after);
    state.stage='CAS_STALE_REVISION';gqcSave_(c,state);
    let staleStatus=null;
    try { realBatch(state.formId,{writeControl:{requiredRevisionId:baseline.revisionId},requests:[{updateItem:{item:after.items[0],location:{index:0},updateMask:'title'}}]}); }
    catch(e) { if(e.message !== 'QUESTION_PUBLICATION_FORMS_HTTP_400')throw e;staleStatus=400; }
    const staleAfter=ports.form(state.formId),finalResponses=gqcResponses_(FormApp.openById(state.formId));
    const result={code:'QUESTION_CAS_VALIDATION_PASSED',formsApiHttpStatus:200,casWriteHttpStatus:200,staleRevisionHttpStatus:staleStatus,
      changedQuestions:plan.requests.length,questionIdsPreserved:model.questions.every(function(q,n) { return q.questionId === afterModel.questions[n].questionId && q.itemId === afterModel.questions[n].itemId; }),
      pointsPreserved:afterModel.questions.every(function(q) { return q.points === 2 && q.required === true; }),answerKeyUpdated:afterModel.questions[0].options[0].correct === true && afterModel.questions[0].options[1].correct === false,
      historicalResponsesPreserved:gqpHash_(originalResponses) === gqpHash_(finalResponses),responsesBefore:originalResponses.length,responsesAfter:finalResponses.length,
      responseLossRecovered:lostResponse && recovered.code === 'QUESTION_PUBLICATION_RECOVERED',actualBatches:actualBatches,repeatWrites:repeated.formWrites,
      staleRevisionBlocked:staleStatus === 400 && gqpHash_(gqpContent_(staleAfter)) === gqpHash_(gqpContent_(after)),formClosed:!form.isPublished() && !form.isAcceptingResponses(),productionWrites:0,firestoreReads:0,automaticContinuation:false};
    if(!result.questionIdsPreserved || !result.pointsPreserved || !result.answerKeyUpdated || !result.historicalResponsesPreserved || !result.responseLossRecovered || actualBatches !== 1 || repeated.formWrites !== 0 || !result.staleRevisionBlocked || !result.formClosed)gqcFail_('POSTCHECK_FAILED');
    return result;
  } finally { if(form)gqcClose_(form); }
}
function validarPublicacaoQuestoesIsoladaV1() {
  const c=gqcConfig_();if(!c.enabled)return {code:'QUESTION_CAS_VALIDATION_DISABLED'};
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)) {
    const pending=gqcRead_(c);
    if(pending && pending.phase === 'ARMED' && Date.now()+60000<Date.parse(c.expiresAt)) {
      gqcRemoveTrigger_();ScriptApp.newTrigger('validarPublicacaoQuestoesIsoladaV1').timeBased().after(60000).create();
    }
    return {code:'QUESTION_CAS_VALIDATION_BUSY'};
  }
  let state;
  try {
    state=gqcRead_(c);
    if(!state || state.runId !== c.runId)gqcFail_('NOT_ARMED');
    if(state.phase === 'DONE' || state.phase === 'FAILED')return state.result;
    if(state.phase !== 'ARMED')return {code:'QUESTION_CAS_VALIDATION_ALREADY_RUNNING'};
    gqcFixtures_(c,state);gqcRemoveTrigger_();state.phase='RUNNING';gqcSave_(c,state);
  } catch(e) {
    if(!state || state.runId !== c.runId || state.phase !== 'ARMED')throw e;
    const failure={code:'QUESTION_CAS_VALIDATION_PARTIAL',stage:'FIXTURE_PREFLIGHT',category:/^(?:QUESTION_CAS_VALIDATION|QUESTION_PUBLICATION)_[A-Z0-9_]+$/.test(e.message || '')?e.message:'QUESTION_CAS_VALIDATION_SERVICE_ERROR',productionWrites:0,firestoreReads:0,automaticContinuation:false};
    gqcRemoveTrigger_();state.phase='FAILED';state.result=failure;gqcSave_(c,state);
    try { return gqcStatus_(c,failure); } catch(_) { console.log(JSON.stringify(failure));return failure; }
  } finally { lock.releaseLock(); }
  // The production publication adapter acquires the script lock itself.
  let result;
  try { result=gqcExercise_(c,state);state.phase='DONE'; }
  catch(e) {
    result={code:'QUESTION_CAS_VALIDATION_PARTIAL',stage:state.stage || 'UNKNOWN',category:/^(?:QUESTION_CAS_VALIDATION|QUESTION_PUBLICATION)_[A-Z0-9_]+$/.test(e.message || '')?e.message:'QUESTION_CAS_VALIDATION_SERVICE_ERROR',productionWrites:0,firestoreReads:0,automaticContinuation:false};
    state.phase='FAILED';
  }
  finally { gqcRemoveTrigger_(); }
  state.result=result;gqcSave_(c,state);return gqcStatus_(c,result);
}
