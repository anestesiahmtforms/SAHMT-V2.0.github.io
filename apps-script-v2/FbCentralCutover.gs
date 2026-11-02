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
  const versionReady=cfg&&Number.isSafeInteger(cfg.version)&&Number.isSafeInteger(input.version)&&input.version>0&&(input.sourceType==='ADMIN_CORRECTION'?cfg.version>=input.version:cfg.version===input.version);
  if(versionReady&&cfg.creditScopeId===input.creditScopeId&&source.evidence&&source.evidence.formId===source.activityId&&source.evidence.responseId===source.sourceId)return;
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
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('FB_CUTOVER_BUSY');
 try{
 evaluationAssertOperator_(true);
 const proof=managementIndependentFbEvidence_(false);
 if(proof.status!=='ACTIVE'||proof.destinationProjectId!==SAHMT_EVALUATION_FB)throw Error('FB_INDEPENDENT_ROUTING_NOT_VERIFIED');
 const props=sahmtV2Properties_();
 const markerUrl='https://firestore.googleapis.com/v1/projects/'+SAHMT_EVALUATION_FB+'/databases/(default)/documents/fbPerformanceControl/centralCutover';
 if(fbOnlyCentralEnabled_()){
  const marker=firestoreFieldsToJs_(firestoreRequest_(markerUrl,{method:'get'}).fields||{});
  if(marker.mode!=='FB_ONLY')throw Error('FB_CUTOVER_MARKER_INVALID');
  if(marker.status!=='ACTIVE'){
   marker.status='ACTIVE';
   firestoreRequest_('https://firestore.googleapis.com/v1/projects/'+SAHMT_EVALUATION_FB+'/databases/(default)/documents:commit',{method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{update:{name:'projects/'+SAHMT_EVALUATION_FB+'/databases/(default)/documents/fbPerformanceControl/centralCutover',fields:firestoreFieldsFromJs_(marker)}}]})});
  }
  const existing={code:'FB_EXTERNAL_CREDITS_STOPPED',mode:'FB_ONLY',stoppedAt:marker.stoppedAt,activateNotBefore:marker.activateNotBefore,triggersChanged:0,historyDeleted:0};console.log(JSON.stringify(existing));return existing;
 }
 const stoppedAt=new Date().toISOString(),activateNotBefore=new Date(Date.now()+420000).toISOString();
 const marker={schemaVersion:1,status:'PREPARED',mode:'FB_ONLY',stoppedAt:stoppedAt,activateNotBefore:activateNotBefore,sourceScriptId:ScriptApp.getScriptId()};
 firestoreRequest_('https://firestore.googleapis.com/v1/projects/'+SAHMT_EVALUATION_FB+'/databases/(default)/documents:commit',{method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{update:{name:'projects/'+SAHMT_EVALUATION_FB+'/databases/(default)/documents/fbPerformanceControl/centralCutover',fields:firestoreFieldsFromJs_(marker)}}]})});
 props.setProperties({SAHMT_FB_PERFORMANCE_MODE:'FB_ONLY',SAHMT_FB_PERFORMANCE_STOPPED_AT:stoppedAt,SAHMT_V2_MANAGEMENT_FB_RELEASE:SAHMT_INDEPENDENT_FB_RELEASE});
 sahmtIndependentFbEvidence_=proof;
 marker.status='ACTIVE';
 firestoreRequest_('https://firestore.googleapis.com/v1/projects/'+SAHMT_EVALUATION_FB+'/databases/(default)/documents:commit',{method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{update:{name:'projects/'+SAHMT_EVALUATION_FB+'/databases/(default)/documents/fbPerformanceControl/centralCutover',fields:firestoreFieldsFromJs_(marker)}}]})});
 const result={code:'FB_EXTERNAL_CREDITS_STOPPED',mode:'FB_ONLY',stoppedAt:stoppedAt,activateNotBefore:activateNotBefore,triggersChanged:0,historyDeleted:0};console.log(JSON.stringify(result));return result;
 }finally{lock.releaseLock();}
}
function conferirCorteCentralFbV1(){
 const report={code:'FB_CENTRAL_CUTOVER_STATUS',mode:sahmtV2Properties_().getProperty('SAHMT_FB_PERFORMANCE_MODE'),triggers:ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction()),businessWrites:0};console.log(JSON.stringify(report));return report;
}
