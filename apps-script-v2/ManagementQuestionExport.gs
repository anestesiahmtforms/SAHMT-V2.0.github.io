// Reads only form definitions and grading keys, never participant responses.
// Target bindings live in a separate private installer, not in the public PWA.
function gqeConfig_() {
  if(typeof gqeTrustedConfig_!=='function')throw Error('QUESTION_EXPORT_CONFIG_MISSING');
  const cfg=gqeTrustedConfig_(),id=/^[A-Za-z0-9_-]{10,200}$/;
  if(!cfg||typeof cfg.operatorEmail!=='string'||!Array.isArray(cfg.targets)||!cfg.targets.length||cfg.targets.length>150||new Set(cfg.targets.map(function(t){return t.formId;})).size!==cfg.targets.length||cfg.targets.some(function(t){return !t||!id.test(t.formId||'')||!id.test(t.folderId||'');}))throw Error('QUESTION_EXPORT_CONFIG_INVALID');
  if(String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!==cfg.operatorEmail.toLowerCase())throw Error('QUESTION_EXPORT_OPERATOR_DENIED');
  return cfg;
}
function gqeHash_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value)).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join(''); }
function gqeCounts_(snapshots) {
  const counts={forms:snapshots.length,questions:0,withoutAnswerKey:0,invalidAnswerKey:0};
  snapshots.forEach(function(snapshot){(snapshot.form.items||[]).forEach(function(item){
    const q=item.questionItem&&item.questionItem.question,choice=q&&q.choiceQuestion;
    if(!choice||!Array.isArray(choice.options)||choice.options.length<2)return;
    counts.questions++;const answers=q.grading&&q.grading.correctAnswers&&q.grading.correctAnswers.answers||[];
    if(!answers.length)counts.withoutAnswerKey++;
    if(answers.some(function(a){return !choice.options.some(function(o){return o.value===a.value;});}))counts.invalidAnswerKey++;
  });});return counts;
}
function gqeRemoveContinuation_() { ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='continuarExportacaoQuestoesGestaoV1';}).forEach(function(t){ScriptApp.deleteTrigger(t);}); }
function gqeReadForm_(formId) {
  try { const form=formsEvaluationMetadata_(formId);form.sourceSchema='FORMS_API_V1';return form; }
  catch (_) {
    // Native Apps Script service uses the already-authorized Forms runtime.
    const source=DriveApp.getFileById(formId),before=source.getLastUpdated().toISOString(),native=FormApp.openById(formId),quiz=native.isQuiz(),items=[];
    native.getItems().forEach(function(item){
      const type=item.getType();let q,choiceType;
      if(type===FormApp.ItemType.MULTIPLE_CHOICE){q=item.asMultipleChoiceItem();choiceType='RADIO';}
      else if(type===FormApp.ItemType.CHECKBOX){q=item.asCheckboxItem();choiceType='CHECKBOX';}
      else if(type===FormApp.ItemType.LIST){q=item.asListItem();choiceType='DROP_DOWN';}
      else return;
      const choices=q.getChoices(),options=choices.map(function(c){return {value:c.getValue()};}),correct=[];
      if(quiz)choices.forEach(function(c){if(c.isCorrectAnswer())correct.push({value:c.getValue()});});
      items.push({itemId:'gas_'+item.getId(),nativeItemId:item.getId(),title:q.getTitle(),description:q.getHelpText()||'',questionItem:{question:{questionId:'gas_'+item.getId(),required:q.isRequired(),grading:{pointValue:quiz&&typeof q.getPoints==='function'?q.getPoints():0,correctAnswers:{answers:correct}},choiceQuestion:{type:choiceType,options:options}}}});
    });
    const after=source.getLastUpdated().toISOString();if(after!==before)throw Error('QUESTION_EXPORT_SOURCE_CHANGED');
    return {formId:formId,revisionId:'native_'+after,sourceSchema:'FORMAPP_V1',info:{title:native.getTitle()},settings:{quizSettings:{isQuiz:quiz}},items:items};
  }
}
function exportarQuestoesGabaritosGestaoV1() { return continuarExportacaoQuestoesGestaoV1(); }
function continuarExportacaoQuestoesGestaoV1() {
  const cfg=gqeConfig_(),props=PropertiesService.getScriptProperties(),lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))return {code:'QUESTION_EXPORT_BUSY'};
  let state,report;
  try{
    gqeRemoveContinuation_();const digest=gqeHash_(cfg.targets);
    state=JSON.parse(props.getProperty('SAHMT_QUESTIONS_EXPORT_STATE')||'null');
    if(state&&state.digest!==digest)throw Error('QUESTION_EXPORT_TARGETS_CHANGED');
    if(!state){
      const file=DriveApp.createFile('SAHMT Questoes e gabaritos fonte privada.json',JSON.stringify({schemaVersion:1,manifestSha256:digest,snapshots:[]}),MimeType.PLAIN_TEXT);
      file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);state={digest:digest,fileId:file.getId(),index:0};props.setProperty('SAHMT_QUESTIONS_EXPORT_STATE',JSON.stringify(state));
    }
    const file=DriveApp.getFileById(state.fileId);
    if(file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('QUESTION_EXPORT_DESTINATION_NOT_PRIVATE');
    const data=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    if(data.manifestSha256!==digest||!Array.isArray(data.snapshots)||data.snapshots.length>cfg.targets.length)throw Error('QUESTION_EXPORT_STATE_INVALID');
    // Resume a file write completed before its cursor acknowledgement.
    if(!Number.isSafeInteger(state.index)||state.index<0||state.index>data.snapshots.length)throw Error('QUESTION_EXPORT_STATE_INVALID');
    data.snapshots.forEach(function(s,i){if(s.formId!==cfg.targets[i].formId||s.folderId!==cfg.targets[i].folderId||s.form.formId!==s.formId)throw Error('QUESTION_EXPORT_STATE_INVALID');});state.index=data.snapshots.length;
    const began=Date.now();
    while(state.index<cfg.targets.length&&Date.now()-began<180000){
      const target=cfg.targets[state.index],source=DriveApp.getFileById(target.formId),parents=source.getParents();let matches=false;
      while(parents.hasNext())if(parents.next().getId()===target.folderId)matches=true;
      const folder=DriveApp.getFolderById(target.folderId);
      if(!matches||source.isTrashed()||folder.isTrashed()||source.getMimeType()!=='application/vnd.google-apps.form')throw Error('QUESTION_EXPORT_BINDING_CHANGED');
      const form=gqeReadForm_(target.formId);if(form.items===undefined)form.items=[];
      if(form.formId!==target.formId||!form.revisionId||!Array.isArray(form.items))throw Error('QUESTION_EXPORT_FORM_INVALID');
      data.snapshots.push({formId:target.formId,folderId:target.folderId,folderTitle:folder.getName(),category:target.category,exportedAt:new Date().toISOString(),form:form});
      file.setContent(JSON.stringify(data));state.index++;props.setProperty('SAHMT_QUESTIONS_EXPORT_STATE',JSON.stringify(state));
    }
    report=Object.assign({code:state.index===cfg.targets.length?'QUESTION_BANK_EXPORT_READY':'QUESTION_BANK_EXPORT_PROGRESS',totalForms:cfg.targets.length,formWrites:0,responsesRead:0,privateReportUrl:file.getUrl()},gqeCounts_(data.snapshots));
    if(state.index<cfg.targets.length){ScriptApp.newTrigger('continuarExportacaoQuestoesGestaoV1').timeBased().after(60000).create();report.automaticContinuation=true;}
    console.log(JSON.stringify(report));return report;
  }catch(error){gqeRemoveContinuation_();report={code:'QUESTION_BANK_EXPORT_PAUSED',safeError:/^QUESTION_EXPORT_[A-Z0-9_]+$/.test(error.message||'')?error.message:'QUESTION_EXPORT_SERVICE_UNAVAILABLE',completed:state&&state.index||0,formWrites:0,responsesRead:0};console.log(JSON.stringify(report));return report;}
  finally{lock.releaseLock();}
}
