/** Explicit, bounded layout migration. No activation of financial flags, users, audiences or permissions. */
const SAHMT_TRAINING_TEMPLATE_V2 = Object.freeze({audit:'1ICE0wXuCqYfbD42ASNdsTsy82GmKh2Pz',presence:'1iQcORp0JVx5iQgpRJcYRdL201vvT2s_W',
  jobProperty:'SAHMT_TRAINING_TEMPLATE_V2_JOB',handler:'continuarPadronizacaoTreinamentosGestaoV2',maxRuns:40});
function trainingTemplatePrivateJson_(id) {
  const file = DriveApp.getFileById(id);
  if (file.isTrashed() || file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length || file.getViewers().length ||
      String(file.getOwner().getEmail()).toLowerCase() !== evaluationAssertOperator_(false)) throw Error('TRAINING_PRIVATE_FILE_REQUIRED');
  return {file:file,data:JSON.parse(file.getBlob().getDataAsString())};
}
function trainingTemplateReceipt_(item) {
  if (!PropertiesService.getScriptProperties().getProperty(SAHMT_TRAINING_TEMPLATE_V2.jobProperty)) return null;
  const receipt = evaluationGet_('trainingTemplateMigrations',item.formId);
  if (!receipt) return null;
  if (receipt.status !== 'CONFIRMED' || receipt.templateVersion !== 2 || receipt.formId !== item.formId || receipt.sourceId !== item.sourceId ||
      receipt.creditScopeId !== item.creditScopeId || receipt.version !== item.version || receipt.maxTestScore !== item.maxTestScore ||
      receipt.manifestDigest !== PropertiesService.getScriptProperties().getProperty(SAHMT_V2_TRAINING_RELEASE.digestProperty)) throw Error('TRAINING_TEMPLATE_RECEIPT_CONFLICT');
  return receipt;
}
function trainingTemplateLayout_(metadata) {
  return formsEvaluationHash_((metadata.items || []).map(function (item) { return {id:item.itemId,title:item.title || '',questionId:item.questionItem && item.questionItem.question.questionId || '',page:!!item.pageBreakItem}; }));
}
function trainingTemplateCheckedReceipt_(item,metadata) {
  const receipt = trainingTemplateReceipt_(item);
  if (receipt && (trainingTemplateLayout_(metadata) !== receipt.layoutFingerprint ||
      formsEvaluationQuestionFingerprint_(formsEvaluationQuestionSnapshot_(metadata)) !== receipt.questionFingerprint)) throw Error('TRAINING_TEMPLATE_CONTENT_CHANGED');
  return receipt;
}
function trainingTemplatePresence_(id) {
  const response = formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(id) + '/responses?pageSize=1&fields=responses(responseId)');
  return !!(response.responses && response.responses.length);
}
function trainingTemplateStop_(job) {
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === SAHMT_TRAINING_TEMPLATE_V2.handler && t.getUniqueId() === job.triggerId; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
/** Both read paths expose the server version, but only the transactional path adds _createTime. */
function trainingTemplateSameRecord_(current, previous) {
  if (!current || !previous) return current === previous;
  if (current._updateTime || previous._updateTime) return typeof current._updateTime === 'string' && current._updateTime === previous._updateTime &&
    typeof current._documentName === 'string' && current._documentName === previous._documentName;
  return formsEvaluationHash_(current) === formsEvaluationHash_(previous);
}
function retomarPadronizacaoTreinamentosGestaoV2() {
  evaluationAssertOperator_(false);
  const lock=LockService.getScriptLock();if (!lock.tryLock(1000)) return {code:'TRAINING_TEMPLATE_BUSY'};
  try {
    const p=PropertiesService.getScriptProperties(),job=JSON.parse(p.getProperty(SAHMT_TRAINING_TEMPLATE_V2.jobProperty)||'null');
    if (!job) throw Error('TRAINING_TEMPLATE_JOB_ABSENT');
    const saved=trainingTemplatePrivateJson_(job.fileId),state=saved.data,row=state.rows[state.cursor];
    const recoverable=['TRAINING_CONFIGURATION_CAS_CONFLICT','TRAINING_TEMPLATE_OPERATION_FAILED','TRAINING_TEMPLATE_HTTP_ERROR'];
    if (state.status!=='STOPPED' || !recoverable.includes(state.safeError) || row && row.status!=='FORM_WRITE_PENDING') throw Error('TRAINING_TEMPLATE_RESUME_REQUIRES_REVIEW');
    if (row) {
      if (!trainingTemplateSameRecord_(evaluationGet_('evaluationFormConfigs',row.formId),row.config) ||
          !trainingTemplateSameRecord_(evaluationGet_('evaluationActivities',row.formId),row.activity) ||
          evaluationGet_('trainingTemplateMigrations',row.formId)) throw Error('TRAINING_CONFIGURATION_CHANGED_PRESERVED');
      if (trainingTemplatePresence_(row.formId)) throw Error('TRAINING_RESPONSES_ARRIVED_PRESERVED');
      const audit=trainingTemplatePrivateJson_(SAHMT_TRAINING_TEMPLATE_V2.audit).data, live=formsEvaluationMetadata_(row.formId);
      if (formsEvaluationHash_(live.items)!==formsEvaluationHash_(row.before.items)) {
        const plan=SAHMT_TRAINING_TEMPLATE_PLANNER.plan({audit:Object.assign({},audit,{snapshots:[row.before]}),formId:row.formId,hasResponses:false});
        SAHMT_TRAINING_TEMPLATE_PLANNER.verify(plan,live);
      }
    }
    trainingTemplateStop_(job);
    state.previousSafeError=state.safeError;delete state.safeError;state.status='RUNNING';
    const trigger=ScriptApp.newTrigger(SAHMT_TRAINING_TEMPLATE_V2.handler).timeBased().everyMinutes(1).create();
    job.triggerId=trigger.getUniqueId();saved.file.setContent(JSON.stringify(state));p.setProperty(SAHMT_TRAINING_TEMPLATE_V2.jobProperty,JSON.stringify(job));
    const output={code:'TRAINING_TEMPLATE_JOB_RESUMED',completed:state.cursor,total:76,privateRecoveryUrl:saved.file.getUrl()};console.log(JSON.stringify(output));return output;
  } finally {lock.releaseLock();}
}
function iniciarPadronizacaoTreinamentosGestaoV2() {
  evaluationAssertOperator_(false);
  const lock = LockService.getScriptLock(); if (!lock.tryLock(1000)) return {code:'TRAINING_TEMPLATE_BUSY'};
  try {
    const p = PropertiesService.getScriptProperties();
    if (p.getProperty(SAHMT_TRAINING_TEMPLATE_V2.jobProperty)) throw Error('TRAINING_TEMPLATE_JOB_ALREADY_EXISTS');
    const audit = trainingTemplatePrivateJson_(SAHMT_TRAINING_TEMPLATE_V2.audit).data, presence = trainingTemplatePrivateJson_(SAHMT_TRAINING_TEMPLATE_V2.presence).data;
    const loaded = trainingReleaseLoad_();trainingReleaseContext_(loaded,null);
    if (audit.manifestDigest !== loaded.digest || audit.targets.length !== 76 || presence.results.length !== 76 ||
        presence.results.some(function (r) { return r.hasResponses !== false || r.httpStatus !== 200; }) ||
        audit.targets.some(function (t) { return presence.results.filter(function (r) { return r.formId === t.formId; }).length !== 1; })) throw Error('TRAINING_TEMPLATE_AUDIT_NOT_CONFIRMED');
    audit.targets.forEach(function (item) { SAHMT_TRAINING_TEMPLATE_PLANNER.plan({audit:audit,formId:item.formId,hasResponses:false}); });
    const oldHandlers=['continuarPreparoTreinamentosDocumentosSahmtV2_','continuarDisponibilizacaoTreinamentosSahmtV2_'];
    const previousTriggers=ScriptApp.getProjectTriggers().filter(function (t) { return oldHandlers.includes(t.getHandlerFunction()); });
    const state = {schemaVersion:1,manifestDigest:loaded.digest,status:'RUNNING',cursor:0,rows:[],startedAt:new Date().toISOString(),runs:0,
      stoppedLegacyPreparationHandlers:previousTriggers.map(function (t) { return t.getHandlerFunction(); })};
    const backup = DriveApp.createFile('SAHMT-training-template-v2-recovery-' + Date.now() + '.json',JSON.stringify(state),MimeType.PLAIN_TEXT);
    trainingTemplatePrivateJson_(backup.getId());
    previousTriggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });
    const trigger = ScriptApp.newTrigger(SAHMT_TRAINING_TEMPLATE_V2.handler).timeBased().everyMinutes(1).create();
    const job = {fileId:backup.getId(),triggerId:trigger.getUniqueId()};p.setProperty(SAHMT_TRAINING_TEMPLATE_V2.jobProperty,JSON.stringify(job));
    const output = {code:'TRAINING_TEMPLATE_JOB_STARTED',targetForms:76,privateRecoveryUrl:backup.getUrl(),automaticContinuation:true};console.log(JSON.stringify(output));return output;
  } finally { lock.releaseLock(); }
}
function continuarPadronizacaoTreinamentosGestaoV2() {
  evaluationAssertOperator_(false);
  const lock = LockService.getScriptLock();if (!lock.tryLock(1000)) return {code:'TRAINING_TEMPLATE_BUSY'};
  let job, state, file;
  try {
    job = JSON.parse(PropertiesService.getScriptProperties().getProperty(SAHMT_TRAINING_TEMPLATE_V2.jobProperty) || 'null');
    if (!job) return {code:'TRAINING_TEMPLATE_JOB_ABSENT'};
    const saved = trainingTemplatePrivateJson_(job.fileId);state=saved.data;file=saved.file;
    if (state.status !== 'RUNNING') { trainingTemplateStop_(job);return {code:'TRAINING_TEMPLATE_JOB_STOPPED'}; }
    if (++state.runs > SAHMT_TRAINING_TEMPLATE_V2.maxRuns || Date.now() - new Date(state.startedAt).getTime() > 4*3600000) throw Error('TRAINING_TEMPLATE_JOB_LIMIT');
    const audit = trainingTemplatePrivateJson_(SAHMT_TRAINING_TEMPLATE_V2.audit).data, loaded=trainingReleaseLoad_();
    if (loaded.digest !== state.manifestDigest) throw Error('TRAINING_MANIFEST_CHANGED');
    trainingReleaseContext_(loaded,null);
    const started=Date.now();
    while (state.cursor < audit.targets.length && Date.now()-started < 150000) {
      const item=audit.targets[state.cursor], savedRow=state.rows[state.cursor], row=savedRow || {formId:item.formId,status:'PREPARING'};
      if (savedRow && savedRow.status!=='FORM_WRITE_PENDING') throw Error('TRAINING_TEMPLATE_PARTIAL_REQUIRES_REVIEW');
      trainingReleaseSource_(item);
      const native=FormApp.openById(item.formId), currentMetadata=formsEvaluationMetadata_(item.formId), before=savedRow ? savedRow.before : currentMetadata;
      const expected=audit.snapshots.find(function (f) { return f.formId===item.formId; });
      if (!expected || formsEvaluationHash_(before.items)!==formsEvaluationHash_(expected.items)) throw Error('TRAINING_FORM_CHANGED_SINCE_AUDIT');
      if (!savedRow) {
        row.before=before;row.config=evaluationGet_('evaluationFormConfigs',item.formId);row.activity=evaluationGet_('evaluationActivities',item.formId);
        row.wasAccepting=native.isAcceptingResponses();row.wasPublished=native.isPublished();
        state.rows.push(row);file.setContent(JSON.stringify(state));
      }
      native.setAcceptingResponses(false);
      if (trainingTemplatePresence_(item.formId)) throw Error('TRAINING_RESPONSES_ARRIVED_PRESERVED');
      const fresh=formsEvaluationMetadata_(item.formId);
      const alreadyChanged=formsEvaluationHash_(fresh.items)!==formsEvaluationHash_(before.items);
      if (!savedRow && alreadyChanged) throw Error('TRAINING_FORM_CHANGED_DURING_CLOSE');
      const planningMetadata=Object.assign({},before,{revisionId:fresh.revisionId});
      const plan=SAHMT_TRAINING_TEMPLATE_PLANNER.plan({audit:Object.assign({},audit,{snapshots:[planningMetadata]}),formId:item.formId,hasResponses:false});
      row.status='FORM_WRITE_PENDING';row.stage='FORMS_BATCH_UPDATE';file.setContent(JSON.stringify(state));
      plan.batchUpdate.requests.push({updateFormInfo:{info:{title:item.title,description:'Material de apoio:\n'+item.materialUrls.join('\n')+'\n\nRevisão pelo gestor: exclusivamente na área autenticada do aplicativo.'},updateMask:'title,description'}});
      if (alreadyChanged) {
        SAHMT_TRAINING_TEMPLATE_PLANNER.verify(plan,fresh);
        if (fresh.info && fresh.info.title !== item.title) throw Error('TRAINING_FORM_TITLE_CHANGED');
      }
      else formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(item.formId) + ':batchUpdate',
          {method:'post',contentType:'application/json',payload:JSON.stringify(plan.batchUpdate)});
      row.stage='FORMS_READBACK';file.setContent(JSON.stringify(state));
      const after=formsEvaluationMetadata_(item.formId);SAHMT_TRAINING_TEMPLATE_PLANNER.verify(plan,after);
      const payload={modalities:{acknowledgement:true,suggestion:true,test:true},acknowledgementItemId:plan.mapping.acknowledgement.itemId,
        acknowledgementValue:plan.mapping.acknowledgement.affirmativeValue,suggestionTextItemId:plan.mapping.suggestionText.itemId};
      const checked=formsEvaluationConfiguration_(after,payload);
      if (checked.maxTestScore !== item.maxTestScore) throw Error('TRAINING_POINTS_BASELINE_MISMATCH');
      row.stage='CONFIGURATION_TRANSACTION';file.setContent(JSON.stringify(state));
      const result=evaluationRunTransaction_(function (tx) {
        const cfg=evaluationGet_('evaluationFormConfigs',item.formId,tx), activity=evaluationGet_('evaluationActivities',item.formId,tx), receipt=evaluationGet_('trainingTemplateMigrations',item.formId,tx);
        if (receipt || !trainingTemplateSameRecord_(cfg,row.config) || !trainingTemplateSameRecord_(activity,row.activity)) throw Error('TRAINING_CONFIGURATION_CAS_CONFLICT');
        const assignment=evaluationGet_('evaluationAssignments',SAHMT_V2_TRAINING_RELEASE.areaId,tx), manager=assignment && evaluationGet_('users',assignment.uid,tx);
        if (!assignment || !formsEvaluationActive_(manager) || cfg && (cfg.managerUid!==assignment.uid || cfg.version!==item.version || cfg.creditScopeId!==item.creditScopeId)) throw Error('TRAINING_MANAGER_CHANGED');
        const receiptData={schemaVersion:1,templateVersion:2,status:'CONFIRMED',formId:item.formId,sourceId:item.sourceId,creditScopeId:item.creditScopeId,
          version:item.version,maxTestScore:checked.maxTestScore,manifestDigest:loaded.digest,mapping:checked.mapping,questionFingerprint:checked.questionFingerprint,
          layoutFingerprint:trainingTemplateLayout_(after),recoveryFileId:job.fileId};
        const writes=[evaluationWrite_('trainingTemplateMigrations',item.formId,receiptData,null,['createdAt'])];
        if (cfg) {
          const changes=Object.assign({},checked,{participantTemplateVersion:2,configVersion:cfg.configVersion+1,acknowledgementItemId:payload.acknowledgementItemId,
            acknowledgementValue:payload.acknowledgementValue,suggestionTextItemId:payload.suggestionTextItemId});
          writes.push(evaluationWrite_('evaluationFormConfigs',item.formId,changes,cfg,['updatedAt']));
          if (activity) {
            const digest=formsEvaluationHash_({formId:item.formId,questionFingerprint:checked.questionFingerprint,maxTestScore:checked.maxTestScore,mapping:checked.mapping,materialUrls:item.materialUrls,materialFingerprint:cfg.materialFingerprint});
            writes.push(evaluationWrite_('evaluationActivities',item.formId,{configVersion:changes.configVersion,trainingReleaseDigest:digest,participantTemplateVersion:2},activity,['updatedAt']));
          }
        }
        return {writes:writes,result:{configured:!!cfg,ready:!!cfg && cfg.status==='READY'}};
      });
      row.status='CONFIGURATION_CONFIRMED';row.after=after;file.setContent(JSON.stringify(state));
      // Restore availability only where it was already available; no publication or ACL expansion.
      if (row.wasPublished && row.wasAccepting && result.ready && !(typeof dgrManagedForm_ === 'function' && dgrManagedForm_(item.formId))) native.setAcceptingResponses(true);
      row.status='CONFIRMED';state.cursor++;file.setContent(JSON.stringify(state));
    }
    if (state.cursor===76) {state.status='COMPLETED';trainingTemplateStop_(job);}
    file.setContent(JSON.stringify(state));const output={code:state.status==='COMPLETED'?'TRAINING_TEMPLATE_COMPLETED':'TRAINING_TEMPLATE_RUNNING',completed:state.cursor,total:76,financialFlagsChanged:false,permissionsChanged:false,privateRecoveryUrl:file.getUrl()};console.log(JSON.stringify(output));return output;
  } catch (error) {
    if (state && file) {
      state.status='STOPPED';const httpStatus=Number.isInteger(error.status) && error.status>=400 && error.status<=599?error.status:null;
      state.safeError=/^[A-Z_]+$/.test(error.message || '')?error.message:httpStatus?'TRAINING_TEMPLATE_HTTP_ERROR':'TRAINING_TEMPLATE_OPERATION_FAILED';
      state.lastFailure={stage:state.rows[state.cursor] && state.rows[state.cursor].stage || 'PREPARATION',httpStatus:httpStatus,
        category:httpStatus===400?'GOOGLE_BAD_REQUEST':httpStatus===401||httpStatus===403?'GOOGLE_ACCESS_DENIED':httpStatus===429?'GOOGLE_QUOTA_OR_RATE_LIMIT':httpStatus?'GOOGLE_HTTP_ERROR':'LOCAL_OR_PLATFORM_ERROR'};
      file.setContent(JSON.stringify(state));
    }
    if (job) trainingTemplateStop_(job);
    const output={code:state && state.safeError || 'TRAINING_TEMPLATE_OPERATION_FAILED',completed:state && state.cursor || 0,stopped:true,diagnostic:state && state.lastFailure || null};console.log(JSON.stringify(output));return output;
  } finally {lock.releaseLock();}
}
