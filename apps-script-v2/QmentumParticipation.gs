/* FA only. Browser records a request; trusted transactions decide credits.
 * No new timer, AI call, private key or billing dependency is introduced. */
function qmParticipationPlan_(participation, review) {
  if (!participation || ['ACKNOWLEDGEMENT','SUGGESTION'].indexOf(participation.modality)<0) throw Error('QMENTUM_PARTICIPATION_INVALID');
  if (participation.modality==='ACKNOWLEDGEMENT') return {status:'CONFIRMED',points:1};
  if (!review) return {status:'AWAITING_APPROVAL',points:0};
  if (review.actorUid===participation.actorUid || ['APPROVE','REJECT'].indexOf(review.decision)<0) throw Error('QMENTUM_SUGGESTION_REVIEW_DENIED');
  return {status:review.decision==='APPROVE'?'APPROVED':'REJECTED',points:review.decision==='APPROVE'?2:0};
}
function qmParticipationIdentity_(uid,unit,tx,manager) {
  const profile=evaluationGet_('users',uid,tx),grant=evaluationGet_('qmentumAccess',uid,tx);
  if (!evaluationActiveProfile_(profile,uid) || !grant || grant.uid!==uid || grant.active!==true || !Array.isArray(grant.units) || grant.units.indexOf(unit)<0 ||
    (manager ? grant.role!=='manager' : ['collector','reviewer','manager'].indexOf(grant.role)<0)) throw Error('QMENTUM_PARTICIPATION_ACCESS_REVOKED');
}
function qmParticipationAnalysis_(p,tx) {
  const config=evaluationGet_('qmentumConfig','current',tx),unit=evaluationGet_('qmentumUnits',p.unitId,tx);
  if (!config || config.enabled!==true || !unit || unit.active!==true) throw Error('QMENTUM_CONFIG_REQUIRED');
  const a=evaluationGet_('qmentumUnits/'+p.unitId+'/quarterlyAnalyses',p.analysisId,tx);
  if (!a || a.status!=='REVIEWED' || a.reviewed!==true || a.signature!==p.signature || a.unitId!==p.unitId) throw Error('QMENTUM_ANALYSIS_UNAVAILABLE');
  const periods=[{year:a.year,quarter:a.quarter},{year:a.quarter===1?a.year-1:a.year,quarter:a.quarter===1?4:a.quarter-1}],rows=[],definitions={};
  periods.forEach(function(period){[1,2,3].forEach(function(i){const m=(period.quarter-1)*3+i,key=period.year+'-'+('0'+m).slice(-2),r=evaluationGet_('qmentumUnits/'+p.unitId+'/months',key,tx);
    if(r){if(!definitions[r.definitionVersion])definitions[r.definitionVersion]=evaluationGet_('qmentumDefinitions',String(r.definitionVersion),tx);
      r.results=QmentumCore.calculateMonth(r.inputs,definitions[r.definitionVersion],{inputVersion:r.version,calculatedAt:null});rows.push(r);}
  });});
  const facts=QmentumCore.quarterFacts({rows:rows,indicatorId:a.indicatorId,year:a.year,quarter:a.quarter});
  if(QmentumCore.analysisInputSignature(facts,sha256Hex_)!==p.signature)throw Error('QMENTUM_ANALYSIS_OBSOLETE');
  return a;
}
function qmProcessParticipation_(id,reviewMode) {
  evaluationAssertOperator_(true);
  if(!/^[a-f0-9]{64}_[A-Za-z0-9_-]{1,128}_(ACKNOWLEDGEMENT|SUGGESTION)$/.test(id))throw Error('QMENTUM_PARTICIPATION_INVALID');
  return evaluationRunTransaction_(function(tx){
    const p=evaluationGet_('qmentumParticipations',id,tx),review=reviewMode?evaluationGet_('qmentumParticipationReviews',id,tx):null;
    if(!p || (!reviewMode && p.status!=='PENDING') || (reviewMode && (!review || review.status!=='PENDING' || p.status!=='AWAITING_APPROVAL')))return {writes:[],result:{code:'QMENTUM_PARTICIPATION_DUPLICATE'}};
    if(id!==p.analysisId+'_'+p.actorUid+'_'+p.modality || !/^[A-Za-z0-9_-]{1,80}$/.test(p.unitId) || !/^[a-f0-9]{64}$/.test(p.signature) ||
       typeof p.suggestion!=='string' || (p.modality==='ACKNOWLEDGEMENT'?p.suggestion!=='':p.suggestion.trim().length<8||p.suggestion.length>2000))throw Error('QMENTUM_PARTICIPATION_INVALID');
    qmParticipationIdentity_(p.actorUid,p.unitId,tx,false);const analysis=qmParticipationAnalysis_(p,tx);
    if(review){if(review.participationId!==id || review.unitId!==p.unitId || typeof review.reason!=='string' || review.reason.trim().length<8)throw Error('QMENTUM_SUGGESTION_REVIEW_DENIED');qmParticipationIdentity_(review.actorUid,p.unitId,tx,true);}
    const plan=qmParticipationPlan_(p,review),writes=[];
    if(plan.points){const award={uid:p.actorUid,category:'PERFORMANCE',modality:p.modality,creditScopeId:'qmentum-'+p.unitId+'-'+analysis.year+'-Q'+analysis.quarter+'-'+analysis.indicatorId,version:1,points:plan.points,
      activityId:'qmentum-'+analysis.indicatorId,areaId:'area-coordenacao-clinica',sourceType:'QMENTUM_PARTICIPATION',sourceId:id,sourceFingerprint:p.signature,
      approvedByUid:review?review.actorUid:'',reason:p.modality==='ACKNOWLEDGEMENT'?'Ciência da análise crítica QMENTUM':'Sugestão QMENTUM aprovada',
      evidence:{unitId:p.unitId,analysisId:p.analysisId,signature:p.signature,year:analysis.year,quarter:analysis.quarter,indicatorId:analysis.indicatorId}};
      const applied=evaluationApplyAwards_([award],{transaction:tx});if(applied.status==='NEEDS_REVIEW')throw Error('QMENTUM_SCORE_REVIEW_REQUIRED');writes.push.apply(writes,applied.writes);
    }
    writes.push(evaluationWrite_('qmentumParticipations',id,{status:plan.status,confirmedPoints:plan.points},p,['processedAt']));
    if(review)writes.push(evaluationWrite_('qmentumParticipationReviews',id,{status:'CONFIRMED'},review,['processedAt']));
    return {writes:writes,result:{code:'QMENTUM_PARTICIPATION_PROCESSED',points:plan.points,status:plan.status}};
  });
}
function processarParticipacoesQmentumV1(){
  if(SAHMT_V2_CONFIG.projectId!=='sahmt-17a16'||SAHMT_V2_CONFIG.databaseId!=='(default)')throw Error('QMENTUM_FA_REQUIRED');
  const config=evaluationGet_('qmentumConfig','current');if(!config || config.enabled!==true)return {code:'QMENTUM_PARTICIPATION_DISABLED'};
  const result={code:'QMENTUM_PARTICIPATIONS_PROCESSED',processed:0,pending:0};
  ['qmentumParticipations','qmentumParticipationReviews'].forEach(function(collection,index){
    evaluationQuery_(collection,[firestoreFilter_('status','EQUAL',{stringValue:'PENDING'})],[],10).forEach(function(request){
      try{qmProcessParticipation_(request.id,index===1);result.processed++;}catch(error){
        if(/^QMENTUM_(PARTICIPATION_INVALID|PARTICIPATION_ACCESS_REVOKED|ANALYSIS_UNAVAILABLE|ANALYSIS_OBSOLETE|SUGGESTION_REVIEW_DENIED)$/.test(error.message||'')){
          try{evaluationRunTransaction_(function(tx){const live=evaluationGet_(collection,request.id,tx);return {writes:live&&live.status==='PENDING'?[evaluationWrite_(collection,request.id,{status:'BLOCKED',safeCode:error.message},live,['processedAt'])]:[],result:{code:'QMENTUM_PARTICIPATION_BLOCKED'}};});}catch(_){result.pending++;}
        }else result.pending++;
      } // No raw diagnostics or identity in logs.
    });
  });return result;
}
