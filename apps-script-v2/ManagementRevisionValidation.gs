// Owner-only validation using a private fixture manifest. Never binds production documents.
function gvrConfig_() {
  if(typeof gvrTrustedConfig_!=='function')throw Error('REVISION_VALIDATION_CONFIG_MISSING');
  const c=gvrTrustedConfig_(),id=/^[A-Za-z0-9_-]{10,200}$/;
  if(!c||!c.runId||!c.operatorEmail||!c.ids||['root','content','review','workspace','source','replacement','questions','questionBaseline','pdf','status'].some(function(k){return !id.test(c.ids[k]||'');})||new Set(Object.keys(c.ids).map(function(k){return c.ids[k];})).size!==Object.keys(c.ids).length)throw Error('REVISION_VALIDATION_CONFIG_INVALID');
  if(String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!==c.operatorEmail)throw Error('REVISION_VALIDATION_OWNER_DENIED');return c;
}
function gvrDigest_(bytes) {return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function gvrFile_(id,mime,parent) {
  const c=gvrConfig_(),m=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,mimeType,parents,trashed,properties,owners(emailAddress),md5Checksum,size');
  if(m.id!==id||m.trashed||m.mimeType!==mime||parent&&!(m.parents||[]).includes(parent)||!m.properties||m.properties.sahmtValidationRun!==c.runId||!m.owners||m.owners.length!==1||m.owners[0].emailAddress!==c.operatorEmail)throw Error('REVISION_VALIDATION_FIXTURE_CHANGED');return m;
}
function gvrStatus_(state,result) {
  const c=gvrConfig_();gvrFile_(c.ids.status,'application/json',c.ids.workspace);
  const file=graPrivateLedger_(c.ids.status);file.setContent(JSON.stringify({version:1,observedAt:new Date().toISOString(),runId:c.runId,state:state,result:result}));console.log(JSON.stringify(result));return result;
}
function gvrRemoveTrigger_() {ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='continuarValidacaoRevisaoDocumentalV1';}).forEach(function(t){ScriptApp.deleteTrigger(t);});}
function gvrStateSave_(state) {gpdfSave_('SAHMT_ISOLATED_REVISION_VALIDATION_STATE',state);}
function gvrBindQuestionDoc_(id,codes) {
  const c=gvrConfig_();gvrFile_(id,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',id===c.ids.questions?c.ids.review:c.ids.workspace);
  const blob=gpdfHttp_('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media').getBlob();
  const parts=Utilities.unzip(blob.copyBlob().setContentType('application/zip')).map(function(part){
    if(part.getName()!=='word/document.xml')return part;
    let text=part.getDataAsString('UTF-8');codes.forEach(function(code,i){text=text.split('__Q'+(i+1)+'__').join(code);});return Utilities.newBlob(text,'application/xml',part.getName());
  });
  const next=Utilities.zip(parts,'questoes.docx').setContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  gpdfHttp_('https://www.googleapis.com/upload/drive/v3/files/'+id+'?uploadType=media',{method:'patch',contentType:next.getContentType(),payload:next.getBytes()});return next;
}
function gvrResponses_(form) {
  return form.getResponses().map(function(r){return {id:r.getId(),at:r.getTimestamp().toISOString(),answers:r.getItemResponses().map(function(a){return {itemId:a.getItem().getId(),answer:a.getResponse(),score:typeof a.getScore==='function'?a.getScore():null};})};});
}
function gvrFormTest_(state) {
  const c=gvrConfig_();let form;
  try{
    state.formStage='FORM_CREATE';
    if(!state.formId){form=FormApp.create('SAHMT VALIDACAO DESCARTAVEL '+c.runId,false);state.formId=form.getId();gvrStateSave_(state);}else form=FormApp.openById(state.formId);
    const file=DriveApp.getFileById(state.formId);
    if(file.getOwner().getEmail()!==c.operatorEmail||file.getName()!=='SAHMT VALIDACAO DESCARTAVEL '+c.runId)throw Error('REVISION_VALIDATION_FIXTURE_CHANGED');
    state.formStage='FORM_PRIVATE_SETUP';file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);file.moveTo(DriveApp.getFolderById(c.ids.content));
    gpdfJson_('https://www.googleapis.com/drive/v3/files/'+state.formId+'?fields=id',{method:'patch',contentType:'application/json',payload:JSON.stringify({properties:{sahmtValidationRun:c.runId,sahmtValidationRole:'form'}})});
    gvrFile_(state.formId,'application/vnd.google-apps.form',c.ids.content);form.setIsQuiz(true);
    while(form.getItems().length<2){const n=form.getItems().length+1,q=form.addMultipleChoiceItem().setTitle('Qual a opção correta na questão '+n+'?').setHelpText('Descrição original').setPoints(2).setRequired(true);q.setChoices([q.createChoice('Alternativa A',false),q.createChoice('Alternativa B',true)]);}
    if(form.getItems().length!==2)throw Error('REVISION_VALIDATION_FIXTURE_CHANGED');
    if(!state.responseId){
      state.formStage='FORM_OWNER_ONLY_AUDIENCE';
      // The real audience code publishes exclusively to the existing owner for this synthetic submission.
      if(!formsEvaluationSyncResponders_(form,[c.operatorEmail]))throw Error('REVISION_VALIDATION_PRIVATE_FORM_UNAVAILABLE');
      state.formStage='FORM_SYNTHETIC_SUBMISSION';let response=form.createResponse();form.getItems().forEach(function(i){const q=i.asMultipleChoiceItem();response=response.withItemResponse(q.createResponse('Alternativa B'));});
      response=response.submit();state.responseId=response.getId();gvrStateSave_(state);
    }
    formsEvaluationCloseForm_(form);
    state.formStage='FORM_RESPONSE_BASELINE';const beforeResponses=gvrResponses_(form);if(beforeResponses.length!==1||beforeResponses[0].id!==state.responseId)throw Error('REVISION_VALIDATION_RESPONSE_INVALID');
    const before=gqrSnapshot_(form),baseline=gqrModel_(before),codes=baseline.questions.map(function(q){return q.questionId;});
    state.formStage='FORM_BIND_DOCX';const originalBlob=gvrBindQuestionDoc_(c.ids.questionBaseline,codes),editedBlob=gvrBindQuestionDoc_(c.ids.questions,codes);
    state.formStage='FORM_PARSE_DOCX';const original=gqrParse_(gqrRows_(originalBlob),baseline),edited=gqrParse_(gqrRows_(editedBlob),baseline);
    if(gqrPlan_(baseline,before,original).changed.length!==0)throw Error('REVISION_VALIDATION_BASELINE_DIVERGES');
    const policy={mode:'ISOLATED_VALIDATION',runId:c.runId,formId:state.formId,documentId:c.ids.questions,reviewFolderId:c.ids.review,formFolderId:c.ids.content,operatorEmail:c.operatorEmail};
    const approval={runId:c.runId,formId:state.formId,documentId:c.ids.questions,documentSha256:gvrDigest_(editedBlob.getBytes()),editedSha256:gqrEditedHash_(edited)};
    // A substituted digest must fail before touching the form.
    let conflictBlocked=false;try{gqrApplyIsolated_(policy,baseline,edited,Object.assign({},approval,{documentSha256:'invalid'}),editedBlob);}catch(e){conflictBlocked=e.message==='QUESTION_REVISION_APPROVAL_CHANGED';}
    if(!conflictBlocked)throw Error('REVISION_VALIDATION_APPROVAL_NOT_BLOCKED');
    state.formStage='FORM_APPLY_APPROVED_REVISION';const applied=gqrApplyIsolated_(policy,baseline,edited,approval,editedBlob),after=gqrSnapshot_(form),modelAfter=gqrModel_(after),afterResponses=gvrResponses_(form);
    const sameEdited=gqrParse_(gqrRows_(editedBlob),modelAfter),repeatApproval=Object.assign({},approval,{editedSha256:gqrEditedHash_(sameEdited)});
    state.formStage='FORM_REPEAT_AND_HISTORY_CHECK';const repeated=gqrApplyIsolated_(policy,modelAfter,sameEdited,repeatApproval,editedBlob);
    const result={status:'passed',changedQuestions:applied.changedQuestions,questionIdsPreserved:before.items.every(function(i,n){return i.itemId===after.items[n].itemId&&i.nativeItemId===after.items[n].nativeItemId;}),pointsPreserved:after.items.every(function(i){return i.questionItem.question.grading.pointValue===2;}),answerKeyUpdated:modelAfter.questions[0].options[0].correct===true&&modelAfter.questions[0].options[1].correct===false,historicalResponsesPreserved:gqeHash_(beforeResponses)===gqeHash_(afterResponses),responsesBefore:beforeResponses.length,responsesAfter:afterResponses.length,repeatWrites:repeated.changedQuestions,invalidApprovalBlocked:conflictBlocked,formClosed:!form.isAcceptingResponses()&&!form.isPublished()};
    if(applied.changedQuestions!==1||!result.questionIdsPreserved||!result.pointsPreserved||!result.answerKeyUpdated||!result.historicalResponsesPreserved||repeated.changedQuestions!==0||!result.formClosed){result.status='failed';result.category='REVISION_VALIDATION_FORM_POSTCHECK_FAILED';}return result;
  }finally{if(form)formsEvaluationCloseForm_(form);}
}
function validarRevisaoDocumentalIsoladaV1() {
  const c=gvrConfig_();if(String(Session.getActiveUser().getEmail()||'').toLowerCase()!==c.operatorEmail)throw Error('REVISION_VALIDATION_OWNER_DENIED');return continuarValidacaoRevisaoDocumentalV1();
}
function continuarValidacaoRevisaoDocumentalV1() {
  const c=gvrConfig_(),lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'REVISION_VALIDATION_BUSY'};
  let state=gpdfLoad_('SAHMT_ISOLATED_REVISION_VALIDATION_STATE',null),result;
  try{
    gvrRemoveTrigger_();if(state&&state.runId!==c.runId)throw Error('REVISION_VALIDATION_RUN_DIVERGES');
    if(!state){state={runId:c.runId,phase:'PREPARE',form:null,pdf:null};gvrStateSave_(state);}
    if(state.phase==='DONE')return gvrStatus_(state,state.result);
    gvrFile_(c.ids.root,'application/vnd.google-apps.folder');graPrivateLedger_(c.ids.status);
    const rootPermissions=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+c.ids.root+'/permissions?fields=permissions(type,role,emailAddress)').permissions;
    if(!Array.isArray(rootPermissions)||rootPermissions.length!==1||rootPermissions.some(function(p){return p.type!=='user'||p.role!=='owner'||p.emailAddress!==c.operatorEmail;}))throw Error('REVISION_VALIDATION_ROOT_NOT_PRIVATE');
    const production=gpdfConfig_();if(production.pairs.some(function(p){return [c.ids.source,c.ids.questions,c.ids.pdf].includes(p.sourceId)||p.pdfId===c.ids.pdf;}))throw Error('REVISION_VALIDATION_PRODUCTION_COLLISION');
    if(state.phase==='PREPARE'){
      if(!state.form){try{state.form=gvrFormTest_(state);}catch(e){state.form={status:'failed',stage:state.formStage||'FORM_UNKNOWN',category:/^(?:REVISION_VALIDATION|QUESTION_REVISION)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'REVISION_VALIDATION_FORM_SERVICE_ERROR'};}gvrStateSave_(state);}
      const source=gvrFile_(c.ids.source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',c.ids.review),replacement=gvrFile_(c.ids.replacement,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',c.ids.workspace);gvrFile_(c.ids.pdf,'application/pdf',c.ids.content);
      if(source.md5Checksum!==c.sourceMd5||replacement.md5Checksum!==c.replacementMd5)throw Error('REVISION_VALIDATION_SOURCE_DIVERGES');
      const drive=gpdfDrive_({workspaceFolderId:c.ids.workspace}),initial=drive.convert(drive.metadata(c.ids.source));
      const metadata=drive.metadata(c.ids.pdf);drive.replace(c.ids.pdf,initial,metadata.etag);
      const pair={sourceId:c.ids.source,pdfId:c.ids.pdf,folderId:c.ids.content,sourceFolderId:c.ids.review},current=gpdfPair_(pair,drive);
      state.beforePdfMd5=current.pdf.md5Checksum;gpdfSave_(gpdfStateKey_(pair),{sourceId:c.ids.source,sourceStamp:gpdfStamp_(current.source),pdfMd5:current.pdf.md5Checksum,pending:null});
      const next=gpdfHttp_('https://www.googleapis.com/drive/v3/files/'+c.ids.replacement+'?alt=media').getBlob();
      gpdfHttp_('https://www.googleapis.com/upload/drive/v3/files/'+c.ids.source+'?uploadType=media',{method:'patch',contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',payload:next.getBytes()});
      state.phase='WAIT_SOURCE';gvrStateSave_(state);ScriptApp.newTrigger('continuarValidacaoRevisaoDocumentalV1').timeBased().after(150000).create();
      result={code:'REVISION_VALIDATION_WAITING_SOURCE_STABILITY',form:state.form,pdf:{status:'waiting'},automaticContinuation:true,productionWrites:0,firestoreReads:0};
    }else if(state.phase==='WAIT_SOURCE'){
      if(gvrFile_(c.ids.source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',c.ids.review).md5Checksum!==c.replacementMd5)throw Error('REVISION_VALIDATION_SOURCE_DIVERGES');
      const pair={sourceId:c.ids.source,pdfId:c.ids.pdf,folderId:c.ids.content,sourceFolderId:c.ids.review},drive=gpdfDrive_({workspaceFolderId:c.ids.workspace}),counts={writes:0,conversions:0,backups:0};
      const tracked=Object.assign({},drive,{replace:function(){counts.writes++;return drive.replace.apply(null,arguments);},convert:function(){counts.conversions++;return drive.convert.apply(null,arguments);},backup:function(){counts.backups++;return drive.backup.apply(null,arguments);}});
      const answer=gpdfSyncPair_(pair,tracked,Date.now());
      if(answer.code==='PDF_SYNC_EDIT_IN_PROGRESS'){ScriptApp.newTrigger('continuarValidacaoRevisaoDocumentalV1').timeBased().after(150000).create();return gvrStatus_(state,{code:'REVISION_VALIDATION_WAITING_SOURCE_STABILITY',automaticContinuation:true,form:state.form,pdf:{status:'waiting'},productionWrites:0,firestoreReads:0});}
      const repeated=gpdfSyncPair_(pair,tracked,Date.now()),after=drive.metadata(c.ids.pdf),saved=gpdfLoad_(gpdfStateKey_(pair),null),backup=saved&&saved.lastBackupId&&drive.metadata(saved.lastBackupId);
      state.pdf={status:'passed',code:answer.code,samePdfId:after.id===c.ids.pdf,contentChanged:after.md5Checksum!==state.beforePdfMd5,backupMatchesPrevious:backup&&backup.md5Checksum===state.beforePdfMd5,repeatCode:repeated.code,counts:counts};
      if(answer.code!=='PDF_SYNC_UPDATED'||!state.pdf.samePdfId||!state.pdf.contentChanged||!state.pdf.backupMatchesPrevious||repeated.code!=='PDF_SYNC_UNCHANGED'||counts.writes!==1||counts.conversions!==1||counts.backups!==1)throw Error('REVISION_VALIDATION_PDF_POSTCHECK_FAILED');
      gpdfProps_().deleteProperty(gpdfStateKey_(pair));state.phase='DONE';result={code:state.form.status==='passed'?'REVISION_VALIDATION_PASSED':'REVISION_VALIDATION_PARTIAL',form:state.form,pdf:state.pdf,automaticContinuation:false,productionWrites:0,firestoreReads:0};state.result=result;gvrStateSave_(state);
    }else throw Error('REVISION_VALIDATION_STATE_INVALID');
  }catch(e){gvrRemoveTrigger_();result={code:'REVISION_VALIDATION_PAUSED',category:/^(?:REVISION_VALIDATION|QUESTION_REVISION|PDF_SYNC)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'REVISION_VALIDATION_SERVICE_ERROR',form:state&&state.form||null,pdf:state&&state.pdf||null,productionWrites:0,firestoreReads:0};}
  finally{lock.releaseLock();}
  return gvrStatus_(state,result);
}
