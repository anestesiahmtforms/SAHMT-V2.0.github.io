/** Escala is published from this module's own source sheet, after preview. */
function ativarEscalaFJ() {
  if(String(Session.getEffectiveUser().getEmail()).toLowerCase()!==SAHMT_V2_CONFIG.ownerEmail)throw Error('EXECUTOR_FJ_INVALIDO');
  const control=firestoreFieldsToJs_(firestoreRequest_(firestoreDocumentsUrl_('/migrationControl/fi-fj-cutover'),{method:'get'}).fields||{});
  if(!['TARGETS_READY','ACTIVE'].includes(control.phase)||control.finalDeltaVerified!==true||control.moduleProjectionsReady!==true||
      control.targetProjects.FJ!==SAHMT_V2_CONFIG.projectId||!/^[a-f0-9]{64}$/.test(control.finalDeltaSha256||''))throw Error('FJ_CORTE_NAO_CONFERIDO');
  const properties=sahmtV2Properties_(),id=properties.getProperty('FJ_SOURCE_SPREADSHEET_ID');
  sahmtV2RequirePrivateSpreadsheet_(id);
  const book=SpreadsheetApp.openById(id);if(!book.getSheetByName('ESCALA')||!book.getSheetByName('FÉRIAS'))throw Error('FJ_FONTE_INCOMPLETA');
  properties.setProperty('FJ_CUTOVER_ENABLED','YES');
  ScriptApp.getProjectTriggers().forEach(function(trigger){if(trigger.getHandlerFunction()==='abrirMenuEscalaFJ')ScriptApp.deleteTrigger(trigger);});
  ScriptApp.newTrigger('abrirMenuEscalaFJ').forSpreadsheet(book).onOpen().create();
  const record={station:'FJ',spreadsheetId:id,activatedAt:new Date(),finalDeltaSha256:control.finalDeltaSha256,publicationMode:'PREVIEW_THEN_PUBLISH'};
  firestoreRequest_(firestoreDocumentsUrl_(':commit'),{method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{
    update:{name:firestoreDocumentName_('migrationControl','apps-script-activation'),fields:firestoreFieldsFromJs_(record)}
  }]})});
  const result={code:'FJ_ESCALA_INDEPENDENTE_ATIVA',spreadsheetId:id,firestoreScheduleWrites:0,publicationMode:'PREVIEW_THEN_PUBLISH'};console.log(JSON.stringify(result));return result;
}
function abrirMenuEscalaFJ() {
  SpreadsheetApp.getUi().createMenu('Escala FJ').addItem('Conferir publicação','previewScheduleSourceToFirestore')
    .addItem('Publicar prévia conferida','publishScheduleSourceToFirestore').addToUi();
}
