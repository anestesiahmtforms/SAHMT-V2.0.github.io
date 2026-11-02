// Install in the existing central producer before enabling the FB-only reader.
// Existing records and management workflows are retained. No credit is imported.
function fbOnlyCentralEnabled_(){return sahmtV2Properties_().getProperty('SAHMT_FB_PERFORMANCE_MODE')==='FB_ONLY';}
function fbOnlyAssertNativeAward_(input,transaction){
 if(!fbOnlyCentralEnabled_()||input.category!=='PERFORMANCE')return;
 if(evaluationProject_()!==SAHMT_EVALUATION_FB||['CHECKLIST','OCCURRENCE'].includes(input.modality))throw Error('FB_EXTERNAL_CREDIT_DENIED');
 let source=input;
 if(input.sourceType==='ADMIN_CORRECTION')source=evaluationGet_('evaluationLedger',(input.id||evaluationAwardId_(input))+'-v1',transaction);
 if(!source||source.uid!==input.uid||source.modality!==input.modality||source.evidence&&source.evidence.sourceProjectId&&source.evidence.sourceProjectId!==SAHMT_EVALUATION_FB)throw Error('FB_EXTERNAL_CREDIT_DENIED');
 if(source.sourceType==='GOOGLE_FORM'&&['ACKNOWLEDGEMENT','TEST'].includes(input.modality)){
  const cfg=evaluationGet_('evaluationFormConfigs',source.activityId,transaction);
  if(cfg&&cfg.creditScopeId===input.creditScopeId&&cfg.version===input.version&&source.evidence&&source.evidence.formId===source.activityId&&source.evidence.responseId===source.sourceId)return;
 }
 if(source.sourceType==='SUGGESTION_REVIEW'&&input.modality==='SUGGESTION'){
  const p=evaluationGet_('evaluationParticipations',source.sourceId,transaction);
  if(p&&p.uid===input.uid&&p.activityId===input.activityId&&p.creditScopeId===input.creditScopeId&&p.version===input.version&&source.approvedByUid&&source.approvedByUid!==input.uid)return;
 }
 if(source.sourceType==='VALIDATED_FB_SCORE'&&['TRAINING_ACCESS','TRAINING_COMPLETION','MANAGEMENT_TASK'].includes(input.modality)){
  const score=evaluationGet_('scores',source.sourceId,transaction);
  if(score&&score.originProjectId===SAHMT_EVALUATION_FB&&score.uid===input.uid&&source.evidence&&source.evidence.sourceProjectId===SAHMT_EVALUATION_FB)return;
 }
 throw Error('FB_EXTERNAL_CREDIT_DENIED');
}
function pararCreditosExternosFbV1(){
 evaluationAssertOperator_(true);
 const props=sahmtV2Properties_(),stoppedAt=new Date().toISOString();
 props.setProperties({SAHMT_FB_PERFORMANCE_MODE:'FB_ONLY',SAHMT_FB_PERFORMANCE_STOPPED_AT:stoppedAt});
 const result={code:'FB_EXTERNAL_CREDITS_STOPPED',mode:'FB_ONLY',stoppedAt:stoppedAt,triggersChanged:0,historyDeleted:0};console.log(JSON.stringify(result));return result;
}
function conferirCorteCentralFbV1(){
 const report={code:'FB_CENTRAL_CUTOVER_STATUS',mode:sahmtV2Properties_().getProperty('SAHMT_FB_PERFORMANCE_MODE'),triggers:ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction()),businessWrites:0};console.log(JSON.stringify(report));return report;
}
