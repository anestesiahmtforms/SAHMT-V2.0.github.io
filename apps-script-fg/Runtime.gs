const FG_NATIVE_SCRIPT_ID='1Uz0wbYwRtuRPUVfFgN09S4HM9e5a7QM8D-M9bzZvCI04eRLu5RcDfLJF';
const FG_NATIVE_RELEASE='fg-checklist-independent-v1';
function fgNativeOwner_(){
  oscOwner_();
  if(SAHMT_V2_CONFIG.projectId!=='sahmt-checklist-fg'||ScriptApp.getScriptId()!==FG_NATIVE_SCRIPT_ID)throw Error('FG_NATIVE_IDENTITY_REQUIRED');
}
function checklistScienceAssertOperator_(transaction){
  fgNativeOwner_();
  if(sahmtV2Properties_().getProperty('FG_CUTOVER_ENABLED')!=='YES')throw Error('FG_NOT_ACTIVE');
  const state=evaluationGet_('checklistScienceRuntime','state',transaction);
  if(!state||state.enabled!==true||state.release!==FG_NATIVE_RELEASE||!(state.activatedAt instanceof Date)||!Number.isFinite(state.activatedAt.getTime()))throw Error('FG_NOT_ACTIVE');
  return state;
}
function evaluationAssertOperator_(){return checklistScienceAssertOperator_();}
function verificarProntidaoChecklistFG(){
  fgNativeOwner_();sahmtV2RequirePrivateSpreadsheet_(OSC.sheetId);
  const probes={};['scheduleDays','vacations','events','contacts','stations'].forEach(function(collection){probes[collection]=evaluationQuery_(collection,[],[],1,['__name__']).length;});
  evaluationGet_('userCategories','fg-migration-access-probe');probes.centralTeamRegistry=true;
  const signer={uid:'synthetic-author',email:'author@example.test',active:true,access:true},scheduled={uid:'synthetic-scheduled',email:'scheduled@example.test',active:true,access:true};
  const assignment={schemaVersion:1,identityStatus:'LINKED',uid:signer.uid,email:signer.email,memberCategories:['EFETIVO']};
  const plan=planChecklistDailyPerformance({day:'2026-11-07',signatureId:'synthetic',signer:signer,scheduled:scheduled,assignment:assignment});
  const own=planChecklistDailyPerformance({day:'2026-11-07',signatureId:'synthetic',signer:scheduled,scheduled:scheduled});
  if(plan.entries.length!==2||plan.entries.reduce(function(total,row){return total+row.points;},0)!==0||own.entries.length!==0)throw Error('FG_PERFORMANCE_SELF_TEST_FAILED');
  const result={code:'FG_CHECKLIST_PRONTO',probes:probes,performanceSelfTest:true,firestoreWrites:0,cutoverEnabled:sahmtV2Properties_().getProperty('FG_CUTOVER_ENABLED')==='YES'};
  console.log(JSON.stringify(result));return result;
}
function validarCienciaChecklistFG(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'FG_VALIDATION_BUSY'};
  try{
    const activation=checklistScienceAssertOperator_();
    const pending=evaluationQuery_('checklistSignatureRequests',[
      firestoreFilter_('status','EQUAL',{stringValue:'PENDING_VALIDATION'}),
      firestoreFilter_('recordKind','EQUAL',{stringValue:'ACKNOWLEDGEMENT'}),
      firestoreFilter_('acknowledgedAt','GREATER_THAN_OR_EQUAL',{timestampValue:activation.activatedAt.toISOString()})
    ],[{fieldPath:'acknowledgedAt',direction:'ASCENDING'}],20,['id']);
    const result={code:'FG_CHECKLIST_PROCESSADO',processed:0,validated:0,review:0,rejected:0,retried:0};
    try{result.responsibility=atualizarResponsavelChecklistFG_();}catch(_){result.responsibility='RETRY';}
    pending.forEach(function(request){try{const outcome=validateChecklistSignatureRequest_(request,{scienceOnly:true});result.processed++;if(outcome==='VALIDATED'||outcome==='DUPLICATE')result.validated++;else if(outcome==='NEEDS_REVIEW')result.review++;else if(outcome==='REJECTED')result.rejected++;}catch(_){result.retried++;}});
    console.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}
function atualizarResponsavelChecklistFG_(){
  return checklistSourceTransaction_(function(transaction){
    const day=checklistSaoPauloDay_(),previous=evaluationGet_('checklistResponsibilities',day,transaction);
    try{
      const snapshot=readTrustedChecklistSnapshot_(day,transaction,{eventRotation:true});
      return {writes:[checklistResponsibilityProjectionWrite_(day,snapshot,previous)],result:'CONFIRMED'};
    }catch(error){
      if(error.status)throw error;
      return {writes:[evaluationWrite_('checklistResponsibilities',day,{day:day,status:'NEEDS_REVIEW',responsible:null,reason:'Responsável aguardando conferência dos cadastros e da escala.'},previous,['updatedAt'])],result:'NEEDS_REVIEW'};
    }
  });
}
