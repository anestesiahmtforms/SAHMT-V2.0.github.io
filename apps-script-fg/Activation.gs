/** Owner activation only after scoped source retirement and final reconciliation. */
function ativarChecklistFG(){
  fgNativeOwner_();
  const proof=getFirestoreDocument_('migrationControl','fg-cutover');
  if(!proof||!['TARGET_READY','ACTIVE'].includes(proof.phase)||proof.sourceProducersRetired!==true||proof.sourceRulesFrozen!==true||proof.finalDeltaVerified!==true||proof.targetProjectId!==SAHMT_V2_CONFIG.projectId||!/^[a-f0-9]{64}$/.test(proof.finalDeltaSha256||''))throw Error('FG_MIGRATION_NOT_VERIFIED');
  verificarProntidaoChecklistFG();reconciliarBaseFinalChecklistFG_(proof.finalDeltaSha256);
  const props=sahmtV2Properties_();props.setProperty('FG_CUTOVER_ENABLED','NO');
  try{
    checklistSourceTransaction_(function(transaction){
      const previous=evaluationGet_('checklistScienceRuntime','state',transaction),performance=evaluationGet_('fgPerformanceRuntime','state',transaction);
      if(performance&&(performance.release!==FG_NATIVE_RELEASE||performance.finalDeltaSha256!==proof.finalDeltaSha256))throw Error('FG_ACTIVATION_CONFLICT');
      const times=previous&&previous.release===FG_NATIVE_RELEASE?['updatedAt']:['activatedAt','updatedAt'];
      return {writes:[
        evaluationWrite_('checklistScienceRuntime','state',{enabled:true,release:FG_NATIVE_RELEASE},previous,times),
        evaluationWrite_('fgPerformanceRuntime','state',{status:'ACTIVE',projectId:SAHMT_V2_CONFIG.projectId,release:FG_NATIVE_RELEASE,rule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V1',finalDeltaSha256:proof.finalDeltaSha256},performance,performance?['updatedAt']:['activatedAt','updatedAt'])
      ],result:true};
    });
    props.setProperty('FG_CUTOVER_ENABLED','YES');
    const activated=ativarControleOperacionalV1();
    ScriptApp.getProjectTriggers().forEach(function(trigger){if(['receberChecklistFG','validarCienciaChecklistFG'].includes(trigger.getHandlerFunction()))ScriptApp.deleteTrigger(trigger);});
    ['receberChecklistFG','validarCienciaChecklistFG'].forEach(function(handler){ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();});
    const pull=receberChecklistFG(),validation=validarCienciaChecklistFG();
    const receipt={station:'FG',spreadsheetId:OSC.sheetId,activatedAt:new Date(),finalDeltaSha256:proof.finalDeltaSha256,incrementalPullMinutes:5,validationMinutes:5,performanceRule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V1'};
    firestoreRequest_(firestoreDocumentsUrl_(':commit'),{method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{update:{name:firestoreDocumentName_('migrationControl','apps-script-activation'),fields:firestoreFieldsFromJs_(receipt)}}]})});
    const result={code:'FG_CHECKLIST_INDEPENDENTE_ATIVO',spreadsheetId:OSC.sheetId,preparation:activated.code,received:pull.received||0,validation:validation.code,performance:'DESEMPENHO_FG',incrementalPullMinutes:5};
    console.log(JSON.stringify(result));return result;
  }catch(error){
    props.setProperty('FG_CUTOVER_ENABLED','NO');props.setProperty(OSC.enabled,'NO');
    ScriptApp.getProjectTriggers().forEach(function(trigger){if([...OSC.handlers,'receberChecklistFG','validarCienciaChecklistFG'].includes(trigger.getHandlerFunction()))ScriptApp.deleteTrigger(trigger);});
    throw error;
  }
}
function receberChecklistFG(){fgNativeOwner_();if(sahmtV2Properties_().getProperty('FG_CUTOVER_ENABLED')!=='YES')throw Error('FG_NOT_ACTIVE');return oscRun_('PULL',null);}
function reconciliarBaseFinalChecklistFG_(hash){
  return oscLocked_(function(){
    const props=sahmtV2Properties_();if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('FG_FINAL_BASE_PROOF_REQUIRED');
    if(props.getProperty('FG_FINAL_BASE_RECONCILED')===hash)return;
    if(props.getProperty(OSC.enabled)==='YES')throw Error('FG_FINAL_BASE_REQUIRES_INACTIVE_CONTROL');
    const book=oscBook_(),table=oscTable_('checklists'),view=oscRows_(book,table),old=oscState_(book),catalog=oscCatalog_(book,true);
    old.forEach(function(state,key){const row=view.rows.get(key);if(!state.deleted&&(!row||!oscEqual_(row.cells,state.cells)))throw Error('FG_LOCAL_SHEET_EDIT_PENDING');});
    view.rows.forEach(function(_,key){if(!old.has(key))throw Error('FG_LOCAL_SHEET_ROW_UNKNOWN');});
    const started=new Date().toISOString(),documents=oscList_('checklists'),state=new Map(),rows=[];
    oscBackup_(book,documents);
    documents.forEach(function(document){const fields=firestoreFieldsToJs_(document.fields),key=oscDocKey_(document);if(fields.sheetDeleted===true||fields.active===false)return;
      const cells=oscRow_(table,document,catalog);rows.push(cells);state.set(key,{updateTime:document.updateTime,cells:oscCanonical_(cells),deleted:false});
    });
    const width=oscHeaders_(table).length,sheet=view.sheet;
    if(rows.length+1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
    if(sheet.getLastRow()>1)sheet.getRange(2,1,sheet.getLastRow()-1,width).clearContent();
    if(rows.length)sheet.getRange(2,1,rows.length,width).setValues(rows);
    oscSaveState_(book,state);SpreadsheetApp.flush();props.setProperty(OSC.cursor+'checklists',JSON.stringify({timestamp:started}));props.setProperty('FG_FINAL_BASE_RECONCILED',hash);
    console.log(JSON.stringify({code:'FG_FINAL_BASE_RECONCILED',rows:rows.length,firestoreWrites:0}));
  });
}
