/** Called only inside the trusted signature acceptance transaction. */
function evaluationApplyChecklistTransfer_(day,responsibleUid,signerUid,signatureId,options){
  const transaction=options&&options.transaction;if(!transaction)throw Error('FG_PERFORMANCE_TRANSACTION_REQUIRED');
  const previous=evaluationGet_('fgPerformanceReceipts',day,transaction),signer=evaluationGet_('users',signerUid,transaction),scheduled=evaluationGet_('users',responsibleUid,transaction);
  const email=String(signer&&signer.email||'').trim().toLowerCase();
  const assignment=signerUid!==responsibleUid?evaluationGet_('userCategories',sha256Hex_(JSON.stringify(email)),transaction):null;
  const plan=planChecklistDailyPerformance({day:day,signatureId:signatureId,signer:signer,scheduled:scheduled,assignment:assignment,previous:previous});
  if(!plan.changed)return {status:'DUPLICATE',writes:[]};
  const writes=[evaluationWrite_('fgPerformanceReceipts',day,plan.receipt,null,['createdAt'])];
  plan.entries.forEach(function(entry){
    const old=evaluationGet_('fgPerformanceSummaries',entry.uid,transaction);
    if(old&&(old.uid!==entry.uid||!Number.isSafeInteger(old.points)||!Number.isSafeInteger(old.days)||old.days<0))throw Error('FG_PERFORMANCE_SUMMARY_INVALID');
    const points=(old?old.points:0)+entry.points,days=(old?old.days:0)+1;
    if(!Number.isSafeInteger(points)||!Number.isSafeInteger(days))throw Error('FG_PERFORMANCE_SUMMARY_LIMIT');
    writes.push(evaluationWrite_('fgPerformanceLedger',entry.id,Object.assign({},entry,{delta:entry.points,sourceType:'CHECKLIST',sourceProjectId:SAHMT_V2_CONFIG.projectId,rule:plan.receipt.rule}),null,['createdAt']));
    writes.push(evaluationWrite_('fgPerformanceSummaries',entry.uid,{uid:entry.uid,points:points,days:days,lastDay:day},old,['updatedAt']));
  });
  return {status:plan.receipt.outcome==='TRANSFER'?'APPLIED':'ZERO',writes:writes};
}
