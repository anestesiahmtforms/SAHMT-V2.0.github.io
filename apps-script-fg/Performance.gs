/** Called only inside the trusted signature acceptance transaction. */
function evaluationApplyChecklistTransfer_(day,responsibleUid,signerUid,signatureId,options){
  const transaction=options&&options.transaction;if(!transaction)throw Error('FG_PERFORMANCE_TRANSACTION_REQUIRED');
  const previous=evaluationGet_('fgPerformanceReceipts',day,transaction),signer=evaluationGet_('users',signerUid,transaction),scheduled=evaluationGet_('users',responsibleUid,transaction);
  const email=String(signer&&signer.email||'').trim().toLowerCase();
  const assignment=signerUid!==responsibleUid&&!checklistScoringDayExemption(day)?evaluationGet_('userCategories',sha256Hex_(JSON.stringify(email)),transaction):null;
  const plan=planChecklistDailyPerformance({day:day,signatureId:signatureId,signer:signer,scheduled:scheduled,assignment:assignment,previous:previous});
  return {status:!plan.changed?'DUPLICATE':plan.receipt.outcome==='TRANSFER'?'APPLIED':'ZERO',writes:fgPerformancePlanWrites_(plan,transaction)};
}
function fgPerformancePlanWrites_(plan,transaction){
  if(!plan.changed)return [];
  const day=plan.receipt.day;
  const writes=[evaluationWrite_('fgPerformanceReceipts',day,plan.receipt,null,['createdAt'])];
  plan.entries.forEach(function(entry){
    const old=evaluationGet_('fgPerformanceSummaries',entry.uid,transaction);
    if(old&&(old.uid!==entry.uid||!Number.isSafeInteger(old.points)||!Number.isSafeInteger(old.days)||old.days<0))throw Error('FG_PERFORMANCE_SUMMARY_INVALID');
    const points=(old?old.points:0)+entry.points,days=(old?old.days:0)+1;
    if(!Number.isSafeInteger(points)||!Number.isSafeInteger(days))throw Error('FG_PERFORMANCE_SUMMARY_LIMIT');
    writes.push(evaluationWrite_('fgPerformanceLedger',entry.id,Object.assign({},entry,{delta:entry.points,sourceType:'CHECKLIST',sourceProjectId:SAHMT_V2_CONFIG.projectId,rule:plan.receipt.rule}),null,['createdAt']));
    writes.push(evaluationWrite_('fgPerformanceSummaries',entry.uid,{uid:entry.uid,points:points,days:days,lastDay:day},old,['updatedAt']));
  });
  return writes;
}

function fgNextDay_(day){return new Date(new Date(day+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);}
function fgAcknowledgementOnTime_(request,day,cutoff){
  return request&&request.id===day&&request.day===day&&request.recordKind==='ACKNOWLEDGEMENT'&&
    request.declaration===true&&request.acknowledgedAt instanceof Date&&request.acknowledgedAt<cutoff&&
    Utilities.formatDate(request.acknowledgedAt,'America/Sao_Paulo','yyyy-MM-dd')===day;
}
/** Only the day represented by this scheduled cutoff can be charged. */
function apurarDiaEncerradoChecklistFG_(day,cutoff){
  if(!isValidDateKey(day)||!(cutoff instanceof Date)||!Number.isFinite(cutoff.getTime())||
      Utilities.formatDate(cutoff,'America/Sao_Paulo','yyyy-MM-dd HH:mm:ss')!==day+' 23:59:00')throw Error('FG_DAY_NOT_ELIGIBLE_FOR_CLOSURE');
  const exemption=checklistScoringDayExemption(day);
  if(exemption)return {day:day,outcome:'NON_SCORING_DAY',exemption:exemption};
  return checklistSourceTransaction_(function(transaction){
    const activation=checklistScienceAssertOperator_(transaction);
    if(activation.activatedAt>=cutoff)return {writes:[],result:{day:day,outcome:'OUTSIDE_RELEASE'}};
    if(evaluationGet_('fgPerformanceReceipts',day,transaction))return {writes:[],result:{day:day,outcome:'ALREADY_SETTLED'}};
    const request=evaluationGet_('checklistSignatureRequests',day,transaction);
    const signatures=request?[]:evaluationQuery_('checklistSignatures',[firestoreFilter_('date','EQUAL',{stringValue:day})],[],1,null,transaction);
    if(fgAcknowledgementOnTime_(request,day,cutoff)||signatures.length)return {writes:[],result:{day:day,outcome:'ACKNOWLEDGEMENT_PRESENT'}};
    let snapshot;
    try{snapshot=readTrustedChecklistSnapshot_(day,transaction,{eventRotation:true,responsibilityOnly:true});}
    catch(error){if(error.status)throw error;return {writes:[],result:{day:day,outcome:'NEEDS_REVIEW'}};}
    const scheduled=evaluationGet_('users',snapshot.responsible.responsibleUid,transaction);
    const plan=planChecklistDailyAbsence({day:day,closedThroughDay:day,eligibleFromDay:Utilities.formatDate(activation.activatedAt,'America/Sao_Paulo','yyyy-MM-dd'),scheduled:scheduled});
    plan.receipt.responsible=snapshot.responsible;
    return {writes:fgPerformancePlanWrites_(plan,transaction),result:{day:day,outcome:plan.receipt.outcome}};
  });
}
