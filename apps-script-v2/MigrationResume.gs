/** Migration administration only: no HTTP, Firestore or automatic execution. */
function conferirRestauracaoAutomacoesFA() {
  const control=sahmtFiFjMaintenanceControl_(),data=control.data;
  if(data.phase!=='COLLECT_RESUME_CONTROL'||control.properties.getProperty('SAHMT_FI_FJ_PRODUCERS_RETIRED')!=='YES')throw Error('FI_FJ_RESUME_COLLECTION_NOT_READY');
  const all=control.properties.getProperties(),prefix='SAHMT_MIGRATION_TRIGGER_V1_',definitions=[];
  Object.keys(all).filter(function(key){return key.indexOf(prefix)===0;}).forEach(function(key){
    const saved=JSON.parse(all[key]);
    if(saved.station!=='FA'||key!==prefix+saved.id||! /^[A-Za-z0-9_]{1,160}$/.test(saved.handler||''))throw Error('FI_FJ_SAVED_TRIGGER_INVALID');
    definitions.push(saved);
  });
  if(definitions.length>30)throw Error('FI_FJ_SAVED_TRIGGER_LIMIT');
  data.pausedTriggerDefinitions=definitions;
  data.resumeCollectionReceipt={code:'FA_PAUSED_TRIGGERS_COLLECTED',count:definitions.length,nonce:data.nonce,collectedAt:new Date().toISOString()};
  control.file.setContent(JSON.stringify(data));
  const result={code:'FA_PAUSED_TRIGGERS_COLLECTED',count:definitions.length,remainingTriggers:0,externalCalls:0,firestoreWrites:0};console.log(JSON.stringify(result));return result;
}

function retomarAutomacoesPreservadasFA() {
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('FI_FJ_RESUME_BUSY');
  const created=[];
  try{
    const control=sahmtFiFjMaintenanceControl_(),data=control.data;
    if(data.phase!=='RESUME_UNRELATED_AUTOMATIONS'||data.finalDeltaVerified!==true||data.moduleProjectionsReady!==true||data.nativeModulesActive!==true||
      ! /^[a-f0-9]{64}$/.test(data.finalDeltaSha256||'')||control.properties.getProperty('SAHMT_FI_FJ_PRODUCERS_RETIRED')!=='YES'||!Array.isArray(data.resumeTriggers)||data.resumeTriggers.length>20)throw Error('FI_FJ_RESUME_PROOFS_REQUIRED');
    const definitions=data.pausedTriggerDefinitions||[],ids={};
    data.resumeTriggers.forEach(function(plan){
      const saved=definitions.find(function(item){return item.id===plan.originalId;});
      if(!saved||ids[plan.originalId]||saved.handler!==plan.handler||plan.handler==='publishScheduleSourceToFirestore'||
        plan.source!==saved.source||plan.eventType!==saved.eventType||plan.sourceId!==saved.sourceId)throw Error('FI_FJ_RESUME_TRIGGER_NOT_SAVED');
      ids[plan.originalId]=true;
      if(plan.source==='CLOCK'){
        if(plan.eventType!=='CLOCK'||!((plan.everyMinutes&&[1,5,10,15,30].includes(plan.everyMinutes)&&!plan.everyHours)||(plan.everyHours&&[1,2,4,6,8,12].includes(plan.everyHours)&&!plan.everyMinutes)))throw Error('FI_FJ_RESUME_CLOCK_INVALID');
      }else if(! /^[A-Za-z0-9_-]{10,200}$/.test(plan.sourceId||'')||!((plan.source==='SPREADSHEETS'&&['ON_EDIT','ON_CHANGE','ON_OPEN','ON_FORM_SUBMIT'].includes(plan.eventType))||(plan.source==='FORMS'&&plan.eventType==='ON_FORM_SUBMIT')))throw Error('FI_FJ_RESUME_EVENT_INVALID');
    });
    control.properties.setProperty('SAHMT_FI_FJ_READS_ACTIVE','YES');
    data.resumeTriggers.forEach(function(plan){
      let builder=ScriptApp.newTrigger(plan.handler);
      if(plan.source==='CLOCK'){builder=builder.timeBased();builder=plan.everyMinutes?builder.everyMinutes(plan.everyMinutes):builder.everyHours(plan.everyHours);}
      else if(plan.source==='FORMS')builder=builder.forForm(FormApp.openById(plan.sourceId)).onFormSubmit();
      else {builder=builder.forSpreadsheet(SpreadsheetApp.openById(plan.sourceId));builder=plan.eventType==='ON_EDIT'?builder.onEdit():plan.eventType==='ON_CHANGE'?builder.onChange():plan.eventType==='ON_OPEN'?builder.onOpen():builder.onFormSubmit();}
      created.push(builder.create());
    });
    const actual=ScriptApp.getProjectTriggers();
    if(actual.length!==data.resumeTriggers.length||actual.some(function(trigger){return trigger.getHandlerFunction()==='publishScheduleSourceToFirestore';}))throw Error('FI_FJ_RESUME_READBACK_FAILED');
    data.nativeResumeReceipt={code:'FA_UNRELATED_AUTOMATIONS_RESTORED',nonce:data.nonce,finalDeltaSha256:data.finalDeltaSha256,triggerCount:actual.length,
      restoredHandlers:actual.map(function(trigger){return trigger.getHandlerFunction();}),targetReadersActive:true,sourceModuleProducersRetired:true,resumedAt:new Date().toISOString(),externalCalls:0,firestoreWrites:0};
    control.file.setContent(JSON.stringify(data));
    control.properties.setProperty('SAHMT_MIGRATION_AUTOMATION_PAUSED','NO');
    console.log(JSON.stringify({code:'FA_UNRELATED_AUTOMATIONS_RESTORED',triggerCount:actual.length,targetReadersActive:true,externalCalls:0,firestoreWrites:0}));
    return data.nativeResumeReceipt;
  }catch(error){created.forEach(function(trigger){try{ScriptApp.deleteTrigger(trigger);}catch(_){}});throw error;}
  finally{lock.releaseLock();}
}
