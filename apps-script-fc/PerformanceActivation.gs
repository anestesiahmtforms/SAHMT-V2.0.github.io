// Run only after the separately reviewed production cutover. No HTTP route calls it.
function fcPerformanceInteractiveOwner_(){
  const email=function(user){return String(user&&user.getEmail()||'').trim().toLowerCase();};
  if(email(Session.getEffectiveUser())!==SAHMT_FC_EXECUTOR_EMAIL||email(Session.getActiveUser())!==SAHMT_FC_EXECUTOR_EMAIL||
    email(DriveApp.getFileById(ScriptApp.getScriptId()).getOwner())!==SAHMT_FC_EXECUTOR_EMAIL||
    sahmtV2Properties_().getProperty('FC_EXPECTED_SCRIPT_ID')!==ScriptApp.getScriptId())throw Error('FC_PERFORMANCE_INTERACTIVE_OWNER_REQUIRED');
}
function prepararDesempenhoFcV1(){
  fcPerformanceInteractiveOwner_();const props=sahmtV2Properties_();
  if(props.getProperty('FC_PERFORMANCE_ENABLED')==='true'||props.getProperty('FC_INTEGRATION_ENABLED')==='true')throw Error('FC_PERFORMANCE_ALREADY_ACTIVE');
  if(ScriptApp.getProjectTriggers().length)throw Error('FC_PERFORMANCE_UNEXPECTED_TRIGGERS');
  props.setProperties({FC_PERFORMANCE_ENABLED:'false',QMENTUM_QUARTERLY_ENABLED:'false'},false);
  const runtime=evaluationGet_('evaluationRuntime','state');
  if(!runtime||runtime.schemaVersion!==1||runtime.mode!=='FC_ONLY'||runtime.projectId!==FC_PERFORMANCE_PROJECT_||runtime.enabled!==false||runtime.effectiveFrom!==null||runtime.automaticFbSync!==false)throw Error('FC_PERFORMANCE_PREPARATION_INVALID');
  const result={code:'FC_PERFORMANCE_PREPARED',station:'FC',enabled:false,automaticFbSync:false,historyImported:0,triggers:0,businessWrites:0};console.log(JSON.stringify(result));return result;
}
function ativarDesempenhoFcV1(){
  fcPerformanceInteractiveOwner_();const props=sahmtV2Properties_(),runtime=fcPerformanceValidateRuntime_(evaluationGet_('evaluationRuntime','state'));
  if(!(runtime.centralStoppedAt instanceof Date)||runtime.effectiveFrom.getTime()<runtime.centralStoppedAt.getTime()+420000||
    Date.now()<runtime.effectiveFrom.getTime()||!/^[a-f0-9]{64}$/.test(runtime.centralStopProofSha256||''))throw Error('FC_PERFORMANCE_CUTOVER_NOT_APPROVED');
  const triggers=ScriptApp.getProjectTriggers();
  if(triggers.length>1||triggers.some(function(t){return t.getHandlerFunction()!=='executarDesempenhoFcV1';}))throw Error('FC_PERFORMANCE_UNEXPECTED_TRIGGERS');
  const values={FC_PERFORMANCE_ENABLED:'true',FC_INTEGRATION_ENABLED:'true',QMENTUM_WRITE_ENABLED:'true',SAHMT_V2_OCCURRENCE_SCORING_ENABLED:'true',QMENTUM_QUARTERLY_ENABLED:'false'},previous={};
  Object.keys(values).forEach(function(k){previous[k]=props.getProperty(k)||'false';});let created=null;
  try{
    props.setProperties(values,false);
    Object.keys(values).forEach(function(k){if(props.getProperty(k)!==values[k])throw Error('FC_PERFORMANCE_ACTIVATION_READBACK_FAILED');});
    if(!triggers.length)created=ScriptApp.newTrigger('executarDesempenhoFcV1').timeBased().everyMinutes(15).create();
    const actual=ScriptApp.getProjectTriggers();if(actual.length!==1||actual[0].getHandlerFunction()!=='executarDesempenhoFcV1')throw Error('FC_PERFORMANCE_TRIGGER_READBACK_FAILED');
  }catch(error){props.setProperties(previous,false);if(created)ScriptApp.deleteTrigger(created);throw error;}
  const result={code:'FC_PERFORMANCE_ACTIVE',station:'FC',mode:'FC_ONLY',effectiveFrom:runtime.effectiveFrom.toISOString(),automaticFbSync:false,historyImported:0,triggers:1,quarterlyAiEnabled:false};console.log(JSON.stringify(result));return result;
}
