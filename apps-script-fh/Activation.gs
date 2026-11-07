/** Native activation requires the independently verified final migration receipt. */
function ativarEtiquetasFH(){
 oscOwner_();const doc=firestoreRequest_(firestoreDocumentsUrl_('/migrationControl/fh-cutover'),{method:'get'}),proof=firestoreFieldsToJs_(doc.fields||{});
 if(!['TARGET_READY','ACTIVE'].includes(proof.phase)||proof.finalDeltaVerified!==true||proof.sourceProducersRetired!==true||proof.targetProjectId!==SAHMT_V2_CONFIG.projectId||! /^[a-f0-9]{64}$/.test(proof.finalDeltaSha256||''))throw Error('FH_MIGRACAO_NAO_CONFERIDA');
 sahmtV2RequirePrivateSpreadsheet_(OSC.sheetId);const props=sahmtV2Properties_();
 reconciliarBaseFinalEtiquetasFH(proof.finalDeltaSha256);
 props.setProperty('FH_CUTOVER_ENABLED','YES');const activated=ativarControleOperacionalV1();
 ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='receberEtiquetasFH')ScriptApp.deleteTrigger(t);});ScriptApp.newTrigger('receberEtiquetasFH').timeBased().everyMinutes(5).create();
 const pull=receberEtiquetasFH(),receipt={station:'FH',spreadsheetId:OSC.sheetId,activatedAt:new Date(),finalDeltaSha256:proof.finalDeltaSha256,incrementalPullMinutes:5};
 firestoreRequest_(firestoreDocumentsUrl_(':commit'),{method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{update:{name:firestoreDocumentName_('migrationControl','apps-script-activation'),fields:firestoreFieldsFromJs_(receipt)}}]})});
 const result={code:'FH_ETIQUETAS_INDEPENDENTES_ATIVAS',spreadsheetId:OSC.sheetId,preparation:activated.code,received:pull.received||0,incrementalPullMinutes:5};console.log(JSON.stringify(result));return result;
}
function receberEtiquetasFH(){oscOwner_();if(sahmtV2Properties_().getProperty('FH_CUTOVER_ENABLED')!=='YES')throw Error('FH_MIGRACAO_NAO_CONFERIDA');return oscRun_('PULL',null);}

/** Before first activation, replace the inactive projection with the complete final FH snapshot. */
function reconciliarBaseFinalEtiquetasFH(finalDeltaSha256){
 oscOwner_();return oscLocked_(function(){
  const props=sahmtV2Properties_();
  if(!/^[a-f0-9]{64}$/.test(finalDeltaSha256||''))throw Error('FH_BASE_FINAL_PROVA_INVALIDA');
  if(props.getProperty('FH_FINAL_BASE_RECONCILED')===finalDeltaSha256)return;
  if(props.getProperty(OSC.enabled)==='YES')throw Error('FH_BASE_FINAL_EXIGE_CONTROLE_INATIVO');
  const book=oscBook_(),table=oscTable_('labels'),view=oscRows_(book,table),old=oscState_(book);
  // Preserve any unexpected manual changes for review; never turn them into database writes.
  old.forEach(function(s,key){const row=view.rows.get(key);if(!s.deleted&&(!row||!oscEqual_(row.cells,s.cells)))throw Error('FH_BASE_FINAL_EDICAO_LOCAL_PENDENTE');});
  view.rows.forEach(function(_,key){if(!old.has(key))throw Error('FH_BASE_FINAL_LINHA_LOCAL_DESCONHECIDA');});
  const started=new Date().toISOString(),documents=oscList_('labels'),state=new Map(),rows=[];
  oscBackup_(book,documents);
  documents.forEach(function(document){const fields=firestoreFieldsToJs_(document.fields),key=oscDocKey_(document);
   if(fields.sheetDeleted===true||fields.active===false)return;
   const cells=oscRow_(table,document,{});rows.push(cells);state.set(key,{updateTime:document.updateTime,cells:oscCanonical_(cells),deleted:false});
  });
  const width=oscHeaders_(table).length,sheet=view.sheet;
  if(rows.length+1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
  if(sheet.getLastRow()>1)sheet.getRange(2,1,sheet.getLastRow()-1,width).clearContent();
  if(rows.length)sheet.getRange(2,1,rows.length,width).setValues(rows);
  oscSaveState_(book,state);oscSummary_(book,state);SpreadsheetApp.flush();
  props.setProperty(OSC.cursor+'labels',JSON.stringify({timestamp:started}));
  props.setProperty('FH_FINAL_BASE_RECONCILED',finalDeltaSha256);
  console.log(JSON.stringify({code:'FH_BASE_FINAL_RECONCILIADA',rows:rows.length,firestoreWrites:0}));
 });
}
