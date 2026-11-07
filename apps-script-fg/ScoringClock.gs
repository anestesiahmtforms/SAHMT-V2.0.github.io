const FG_SCORE_CLOCK_PROPERTY='FG_SCORING_TRIGGER';
function fgNextScoringClock_(after){
  let day=Utilities.formatDate(after,'America/Sao_Paulo','yyyy-MM-dd');
  let due=Utilities.parseDate(day+' 23:59:00','America/Sao_Paulo','yyyy-MM-dd HH:mm:ss');
  if(due.getTime()<=after.getTime()){day=fgNextDay_(day);due=Utilities.parseDate(day+' 23:59:00','America/Sao_Paulo','yyyy-MM-dd HH:mm:ss');}
  return due;
}
function fgCreateScoringClock_(after){
  const due=fgNextScoringClock_(after),trigger=ScriptApp.newTrigger('validarCienciaChecklistFG').timeBased().at(due).create();
  const scheduled={triggerUid:String(trigger.getUniqueId()),dueAt:due.toISOString()};
  sahmtV2Properties_().setProperty(FG_SCORE_CLOCK_PROPERTY,JSON.stringify(scheduled));return scheduled;
}
function instalarApuracaoChecklistFG_(){
  fgNativeOwner_();
  ScriptApp.getProjectTriggers().forEach(function(trigger){if(trigger.getHandlerFunction()==='validarCienciaChecklistFG')ScriptApp.deleteTrigger(trigger);});
  return fgCreateScoringClock_(new Date());
}
/** Only the one scheduled daily invocation may run scoring. */
function fgClaimScoringClock_(event){
  const props=sahmtV2Properties_(),raw=props.getProperty(FG_SCORE_CLOCK_PROPERTY);
  if(!raw||!event||!event.triggerUid)return null;
  const scheduled=JSON.parse(raw),due=new Date(scheduled.dueAt),now=new Date();
  if(String(event.triggerUid)!==scheduled.triggerUid||!Number.isFinite(due.getTime()))return null;
  if(Utilities.formatDate(due,'America/Sao_Paulo','HH:mm:ss')!=='23:59:00')throw Error('FG_SCORING_CLOCK_INVALID');
  // Claim before processing so a repeated event cannot run another cycle.
  fgCreateScoringClock_(now);
  ScriptApp.getProjectTriggers().forEach(function(trigger){if(String(trigger.getUniqueId())===scheduled.triggerUid)ScriptApp.deleteTrigger(trigger);});
  return now<due?null:due;
}
