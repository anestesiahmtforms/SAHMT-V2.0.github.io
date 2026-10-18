// First validated response per stable subject/version earns points. Repeats are
// allowed, never erase responses and never grant another administrative right.
function trainingRepeatScope_() {
  if(typeof gqpTrustedConfig_!=='function')throw Error('TRAINING_REPEAT_TRUSTED_CATALOG_REQUIRED');
  const trusted=gqpTrustedConfig_();
  if(!trusted || !Array.isArray(trusted.bindings) || !trusted.bindings.length)throw Error('TRAINING_REPEAT_TRUSTED_CATALOG_REQUIRED');
  const ids=trusted.bindings.map(function(row){return row.formId;});
  if(new Set(ids).size!==ids.length || ids.some(function(id){return !/^[A-Za-z0-9_-]{10,200}$/.test(id);}))throw Error('TRAINING_REPEAT_CATALOG_INVALID');
  const all=formsEvaluationAll_('evaluationFormConfigs'),configured=all.filter(function(row){return ids.includes(row.formId);});
  return {ids:ids,configs:configured,missing:ids.filter(function(id){return !configured.some(function(row){return row.formId===id;});}),other:all.length-configured.length};
}
function conferirRepeticaoTreinamentosV1() {
  evaluationAssertOperator_(false);const scope=trainingRepeatScope_();
  const result={code:scope.missing.length?'TRAINING_REPEAT_CONFIGURATION_INCOMPLETE':'TRAINING_REPEAT_PREFLIGHT_READY',
    documentForms:scope.ids.length,configured:scope.configs.length,missingConfigurations:scope.missing.length,
    otherConfigurationsPreserved:scope.other,formWrites:0,firestoreWrites:0};
  Logger.log(JSON.stringify(result));return result;
}
function trainingRepeatActivateOne_(formId) {
  const cfg=evaluationGet_('evaluationFormConfigs',formId),activity=evaluationGet_('evaluationActivities',formId);
  if(!cfg || !activity || activity.active!==true)throw Error('TRAINING_REPEAT_CONFIGURATION_REQUIRED');
  const form=FormApp.openById(formId),saved=cfg.repeatActivation;
  const recovery=saved && saved.status==='COMPLETE' && saved.version===cfg.version && cfg.configVersion===saved.baseConfigVersion+1 && form.isAcceptingResponses()!==saved.accepting;
  const pending=saved && saved.status==='PENDING' || recovery;
  if(cfg.repeatPolicy==='FIRST_RESPONSE_PER_VERSION' && !form.hasLimitOneResponsePerUser() && !form.canEditResponse() && !pending)return {unchanged:true};
  if(form.canEditResponse())throw Error('TRAINING_REPEAT_RESPONSE_EDITING_ENABLED');
  const metadata=formsEvaluationMetadata_(formId);
  formsEvaluationCheckedMapping_(metadata,cfg);
  if(formsEvaluationQuestionFingerprint_(formsEvaluationQuestionSnapshot_(metadata))!==formsEvaluationSavedQuestionFingerprint_(cfg))throw Error('TRAINING_REPEAT_CONTENT_CHANGED');
  const intent=pending?Object.assign({},saved,{status:'PENDING'}):{status:'PENDING',accepting:form.isAcceptingResponses(),published:form.isPublished(),version:cfg.version,baseConfigVersion:cfg.configVersion};
  if(intent.version!==cfg.version || !(cfg.configVersion===intent.baseConfigVersion || cfg.repeatPolicy==='FIRST_RESPONSE_PER_VERSION' && cfg.configVersion===intent.baseConfigVersion+1))throw Error('TRAINING_REPEAT_CONFIGURATION_CHANGED');
  if(!pending || recovery)evaluationRunTransaction_(function(tx){
    const live=evaluationGet_('evaluationFormConfigs',formId,tx);
    if(!live || live.configVersion!==cfg.configVersion)throw Error('TRAINING_REPEAT_CONFIGURATION_CHANGED');
    return {writes:[evaluationWrite_('evaluationFormConfigs',formId,{repeatActivation:intent},live,['updatedAt'])],result:{}};
  });
  try{
    form.setAcceptingResponses(false);
    form.setLimitOneResponsePerUser(false);
    if(form.hasLimitOneResponsePerUser() || form.canEditResponse())throw Error('TRAINING_REPEAT_OPTIONS_NOT_CONFIRMED');
    evaluationRunTransaction_(function(tx){
      const live=evaluationGet_('evaluationFormConfigs',formId,tx),projected=evaluationGet_('evaluationActivities',formId,tx);
      if(!live || !projected || live.configVersion!==cfg.configVersion || projected.active!==true || !live.repeatActivation || live.repeatActivation.status!=='PENDING')throw Error('TRAINING_REPEAT_CONFIGURATION_CHANGED');
      if(live.repeatPolicy==='FIRST_RESPONSE_PER_VERSION' && live.configVersion===intent.baseConfigVersion+1)return {writes:[],result:{}};
      const patch={repeatPolicy:'FIRST_RESPONSE_PER_VERSION',configVersion:cfg.configVersion+1};
      return {writes:[evaluationWrite_('evaluationFormConfigs',formId,patch,live,['updatedAt']),evaluationWrite_('evaluationActivities',formId,patch,projected,['updatedAt'])],result:{}};
    });
    const updated=evaluationGet_('evaluationFormConfigs',formId);
    if(!updated || updated.version!==intent.version || updated.configVersion!==intent.baseConfigVersion+1 || updated.repeatPolicy!=='FIRST_RESPONSE_PER_VERSION')throw Error('TRAINING_REPEAT_CONFIGURATION_CHANGED');
    // A failed reopen is a PENDING intent, never a falsely completed job.
    if(intent.accepting){
      if(updated.status!=='READY' || updated.trainingRevisionRequired===true || form.isPublished()!==intent.published)throw Error('TRAINING_REPEAT_REOPEN_BLOCKED');
      form.setAcceptingResponses(true);
    }
    if(form.isAcceptingResponses()!==intent.accepting)throw Error('TRAINING_REPEAT_REOPEN_UNCONFIRMED');
    evaluationRunTransaction_(function(tx){
      const live=evaluationGet_('evaluationFormConfigs',formId,tx);
      if(!live || live.configVersion!==updated.configVersion || live.version!==intent.version || !live.repeatActivation || live.repeatActivation.status!=='PENDING')throw Error('TRAINING_REPEAT_CONFIGURATION_CHANGED');
      return {writes:[evaluationWrite_('evaluationFormConfigs',formId,{repeatActivation:Object.assign({},intent,{status:'COMPLETE'})},live,['updatedAt'])],result:{}};
    });
    return {unchanged:false};
  }catch(error){try{form.setAcceptingResponses(false);}catch(_){}throw Error(/^TRAINING_REPEAT_[A-Z_]+$/.test(error.message || '')?error.message:'TRAINING_REPEAT_ACTIVATION_RETRY_REQUIRED');}
}
function trainingRepeatInvalidate_(formId,component) {
  if(!['MATERIAL','QUESTIONS'].includes(component))throw Error('TRAINING_REVISION_COMPONENT_INVALID');
  const cfg=evaluationGet_('evaluationFormConfigs',formId);
  if(!cfg || cfg.repeatPolicy!=='FIRST_RESPONSE_PER_VERSION')return {unchanged:true};
  FormApp.openById(formId).setAcceptingResponses(false);
  return evaluationRunTransaction_(function(tx){
    const live=evaluationGet_('evaluationFormConfigs',formId,tx),activity=evaluationGet_('evaluationActivities',formId,tx);
    if(!live || !activity || live.repeatPolicy!=='FIRST_RESPONSE_PER_VERSION')throw Error('TRAINING_REVISION_CONFIGURATION_CHANGED');
    if(live.trainingRevisionRequired===true)return {writes:[],result:{unchanged:true}};
    const patch={status:'CONFIGURATION_PENDING',publicationPending:false,trainingRevisionRequired:true,
      reason:'Material ou questões em revisão. Nova versão deve ser validada antes de liberar o treinamento.',configVersion:live.configVersion+1};
    return {writes:[evaluationWrite_('evaluationFormConfigs',formId,patch,live,['updatedAt']),evaluationWrite_('evaluationActivities',formId,patch,activity,['updatedAt'])],result:{unchanged:false}};
  });
}
function trainingRepeatJobPlan_(previous,scope) {
  if(previous && previous.next<previous.ids.length)return {job:previous,backup:[]};
  const eligible=scope.configs.filter(function(cfg){return ['READY','CONFIGURATION_PENDING'].includes(cfg.status);});
  if(!eligible.length)throw Error('TRAINING_REPEAT_CONFIGURATION_INCOMPLETE');
  const old=previous?previous.ids:[],added=eligible.filter(function(cfg){return !old.includes(cfg.formId);});
  const job=Object.assign({},previous || {ids:[],next:0},{ids:old.concat(added.map(function(cfg){return cfg.formId;})),expectedForms:scope.ids.length,missingConfigurations:scope.missing.length,inactiveConfigurations:scope.configs.length-eligible.length});
  return {job:job,backup:added};
}
function ativarRepeticaoTreinamentosV1() {
  evaluationAssertOperator_(true);
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'TRAINING_REPEAT_BUSY'};
  try{
  const props=PropertiesService.getScriptProperties(),raw=props.getProperty('SAHMT_TRAINING_REPEAT_JOB');
  const planned=trainingRepeatJobPlan_(raw?JSON.parse(raw):null,trainingRepeatScope_()),job=planned.job;
  if(planned.backup.length){
    const backup={schemaVersion:1,createdAt:new Date().toISOString(),configs:planned.backup.map(function(cfg){const form=FormApp.openById(cfg.formId);return {configuration:evaluationClean_(cfg),activity:evaluationClean_(evaluationGet_('evaluationActivities',cfg.formId)),limitOneResponse:form.hasLimitOneResponsePerUser(),accepting:form.isAcceptingResponses(),published:form.isPublished()};})};
    const file=DriveApp.createFile('SAHMT Recuperacao privada de tentativas de treinamento.json',JSON.stringify(backup),MimeType.PLAIN_TEXT);
    file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
    job.backupIds=(job.backupIds || (job.backupId?[job.backupId]:[])).concat([file.getId()]);job.backupId=job.backupId || file.getId();
  }
  props.setProperty('SAHMT_TRAINING_REPEAT_JOB',JSON.stringify(job));
  }finally{lock.releaseLock();}
  return continuarRepeticaoTreinamentosV1();
}
function continuarRepeticaoTreinamentosV1() {
  evaluationAssertOperator_(true);
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'TRAINING_REPEAT_BUSY'};
  try{
    ScriptApp.getProjectTriggers().forEach(function(trigger){if(trigger.getHandlerFunction()==='continuarRepeticaoTreinamentosV1')ScriptApp.deleteTrigger(trigger);});
    const props=PropertiesService.getScriptProperties(),job=JSON.parse(props.getProperty('SAHMT_TRAINING_REPEAT_JOB') || 'null');
    if(!job)throw Error('TRAINING_REPEAT_JOB_REQUIRED');
    const until=Math.min(job.next+5,job.ids.length);
    while(job.next<until){trainingRepeatActivateOne_(job.ids[job.next]);job.next++;props.setProperty('SAHMT_TRAINING_REPEAT_JOB',JSON.stringify(job));}
    const pending=job.next<job.ids.length;
    if(pending)ScriptApp.newTrigger('continuarRepeticaoTreinamentosV1').timeBased().after(60000).create();
    else props.setProperty('SAHMT_TRAINING_REPEAT_ENABLED','YES');
    const incomplete=Number(job.missingConfigurations || 0)+Number(job.inactiveConfigurations || 0)>0;
    const result={code:pending?'TRAINING_REPEAT_PROGRESS':incomplete?'TRAINING_REPEAT_PARTIAL_READY':'TRAINING_REPEAT_READY',completed:job.next,total:job.ids.length,expectedForms:job.expectedForms,missingConfigurations:job.missingConfigurations || 0,inactiveConfigurations:job.inactiveConfigurations || 0,automaticContinuation:pending};
    Logger.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}
