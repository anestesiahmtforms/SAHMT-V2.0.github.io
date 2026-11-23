// Bounded rotating scans prevent a failed/legacy request from starving new work.
// No trigger is installed by this file or by an HTTP request.
function fcPerformancePendingPage_(collection, status, cursorKey, process) {
  const runtime=fcPerformanceRuntime_(),cursor=runtime[cursorKey]||null;
  if(cursor && (!Array.isArray(cursor.values)||cursor.values.length!==2||
      typeof cursor.values[0].timestampValue!=='string'||typeof cursor.values[1].referenceValue!=='string'||
      cursor.values[1].referenceValue.indexOf('projects/'+FC_PERFORMANCE_PROJECT_+'/databases/(default)/documents/'+collection+'/')!==0))
    throw Error('FC_PERFORMANCE_CURSOR_INVALID');
  const rows=evaluationQuery_(collection,[firestoreFilter_('status','EQUAL',{stringValue:status}),
    firestoreFilter_('createdAt','GREATER_THAN_OR_EQUAL',{timestampValue:runtime.effectiveFrom.toISOString()})],
    [{fieldPath:'createdAt',direction:'ASCENDING'},{fieldPath:'__name__',direction:'ASCENDING'}],5,null,null,cursor);
  const result={processed:0,pending:0,excluded:0};
  rows.forEach(function(row){try{process(row);result.processed++;}catch(error){
    if(error.message==='FC_PERFORMANCE_SOURCE_BEFORE_ACTIVATION')result.excluded++;else result.pending++;
  }});
  const last=rows[rows.length-1],next=rows.length===5?{values:[{timestampValue:last.createdAt.toISOString()},
    {referenceValue:evaluationDocumentName_(collection,last.id)}],before:false}:null;
  evaluationRunTransaction_(function(tx){const live=fcPerformanceRuntime_(tx),patch={};patch[cursorKey]=next;
    return {writes:[evaluationWrite_('evaluationRuntime','state',patch,live,['lastScanAt'])],result:true};});
  return result;
}
function processarParticipacoesQmentumV1(){
  evaluationAssertOperator_();
  const config=evaluationGet_('qmentumConfig','current');
  if(!config||config.enabled!==true)return {code:'QMENTUM_PARTICIPATION_DISABLED'};
  return {code:'FC_QMENTUM_PARTICIPATIONS_PROCESSED',
    participation:fcPerformancePendingPage_('qmentumParticipations','PENDING','participationScanCursor',function(row){qmProcessParticipation_(row.id,false);}),
    reviews:fcPerformancePendingPage_('qmentumParticipationReviews','PENDING','reviewScanCursor',function(row){qmProcessParticipation_(row.id,true);})};
}
function recuperarPontuacoesOcorrenciasFcV1(){
  return fcRunOccurrenceScoring_(function(){
    evaluationOccurrenceAssertOperator_();
    return {code:'FC_OCCURRENCE_SCORE_RECOVERY',result:fcPerformancePendingPage_('occurrenceScoreClaims','PENDING_VALIDATION','occurrenceScanCursor',function(row){evaluationDeliverOccurrence_(row.id);})};
  });
}
function executarDesempenhoFcV1(){
  if(fcRuntimeCode_()||sahmtV2Properties_().getProperty('FC_PERFORMANCE_ENABLED')!=='true')return {code:'FC_PERFORMANCE_DISABLED'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'FC_PERFORMANCE_BUSY'};
  let occurrences,analysisReviews;
  try{occurrences=recuperarPontuacoesOcorrenciasFcV1();}
  catch(error){if(error.message!=='FC_PERFORMANCE_FOLDER_DISABLED')throw error;occurrences={code:error.message};}
  finally{lock.releaseLock();}
  try{
    evaluationAssertOperator_();
    analysisReviews=validarRevisoesQmentumV1();
  }catch(error){
    if(error.message!=='FC_PERFORMANCE_FOLDER_DISABLED')throw error;
    return {code:'FC_PERFORMANCE_CYCLE',occurrences:occurrences,qmentum:{code:error.message}};
  }
  if(!lock.tryLock(1000))return {code:'FC_PERFORMANCE_BUSY',occurrences:occurrences};
  let result;
  try{
    evaluationAssertOperator_();
    result={code:'FC_PERFORMANCE_CYCLE',analysisReviews:analysisReviews,occurrences:occurrences,
      qmentum:processarParticipacoesQmentumV1(),summary:evaluationPublishCategorySummary_('PERFORMANCE')};
  }finally{lock.releaseLock();}
  console.log(JSON.stringify(result));return result;
}
function executarCicloQmentumFcV1(){
  if(fcRuntimeCode_())return {code:'FC_INTEGRATION_DISABLED'};
  evaluationAssertOperator_();return executarCicloQmentumV1();
}
