
/** Owner-only suspension. Uses Script service and properties; no UrlFetch. */
function sahmtPauseMigrationAutomations_(station,expectedScript,expectedProject,expectedOwner) {
  if(String(Session.getEffectiveUser().getEmail()).toLowerCase()!==expectedOwner||ScriptApp.getScriptId()!==expectedScript||SAHMT_V2_CONFIG.projectId!==expectedProject)throw Error('MIGRATION_PAUSE_IDENTITY_MISMATCH');
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('MIGRATION_PAUSE_BUSY');
  try{
    const props=PropertiesService.getScriptProperties(),triggers=ScriptApp.getProjectTriggers();
    for(const trigger of triggers){
      const id=String(trigger.getUniqueId());if(!/^[A-Za-z0-9_-]{1,180}$/.test(id))throw Error('MIGRATION_TRIGGER_ID_INVALID');
      let sourceId=null;try{sourceId=trigger.getTriggerSourceId();}catch(_){}
      const key='SAHMT_MIGRATION_TRIGGER_V1_'+id;
      const data={id:id,handler:trigger.getHandlerFunction(),eventType:String(trigger.getEventType()),source:String(trigger.getTriggerSource()),sourceId:sourceId,station:station,savedAt:new Date().toISOString()};
      const text=JSON.stringify(data);if(text.length>8000)throw Error('MIGRATION_TRIGGER_BACKUP_TOO_LARGE');
      if(!props.getProperty(key))props.setProperty(key,text);
      if(!props.getProperty(key))throw Error('MIGRATION_TRIGGER_BACKUP_FAILED');
    }
    props.setProperty('SAHMT_MIGRATION_AUTOMATION_PAUSED','YES');
    props.setProperty('SAHMT_MIGRATION_AUTOMATION_PAUSED_AT',new Date().toISOString());
    triggers.forEach(function(trigger){ScriptApp.deleteTrigger(trigger);});
    const remaining=ScriptApp.getProjectTriggers().length;if(remaining!==0)throw Error('MIGRATION_TRIGGERS_REMAIN');
    const result={code:'SAHMT_AUTOMATION_PAUSED',station:station,scriptId:expectedScript,removedTriggers:triggers.length,remainingTriggers:remaining,triggerDefinitionsSaved:true,clockSchedulesRecoverableFromInstallers:true,externalCalls:0,firestoreWrites:0};
    console.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}

function pausarAutomacoesMigracaoFJ(){return sahmtPauseMigrationAutomations_('FJ','1XG8s9k3fOJlQo7ghgfEdk7L9L5emiCeU76fqVh7fsRrczxBjgmcbzTUs','sahmt-escala-fj','anestesiahmtforms10@gmail.com');}
