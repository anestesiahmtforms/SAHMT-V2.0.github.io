/** Enable only after the protected final copy and cross-project reconciliation. */
function ativarOperacionalFI() {
  oscOwner_();
  const control = firestoreRequest_(firestoreDocumentsUrl_('/migrationControl/fi-fj-cutover'), {method:'get'});
  const proof = firestoreFieldsToJs_(control.fields || {});
  if (!['TARGETS_READY','ACTIVE'].includes(proof.phase) || proof.finalDeltaVerified !== true || proof.moduleProjectionsReady !== true ||
      proof.targetProjects.FI !== SAHMT_V2_CONFIG.projectId || !/^[a-f0-9]{64}$/.test(proof.finalDeltaSha256 || '')) throw Error('FI_CORTE_NAO_CONFERIDO');
  sahmtV2RequirePrivateSpreadsheet_(OSC.sheetId);
  const properties = sahmtV2Properties_(); properties.setProperty('FI_CUTOVER_ENABLED','YES');
  const result = ativarControleOperacionalV1();
  // One bounded incremental query every five minutes keeps new PWA events in
  // this independent sheet without an FA relay or shared Apps Script endpoint.
  ScriptApp.getProjectTriggers().forEach(function(trigger) {if(trigger.getHandlerFunction()==='receberEventosOperacionaisFI')ScriptApp.deleteTrigger(trigger);});
  const trigger = ScriptApp.newTrigger('receberEventosOperacionaisFI').timeBased().everyMinutes(5).create();
  properties.setProperty('FI_PULL_TRIGGER_ID',trigger.getUniqueId());
  const pull = receberEventosOperacionaisFI();
  const record = {station:'FI',spreadsheetId:OSC.sheetId,activatedAt:new Date(),finalDeltaSha256:proof.finalDeltaSha256,incrementalPullMinutes:5};
  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{
    update:{name:firestoreDocumentName_('migrationControl','apps-script-activation'),fields:firestoreFieldsFromJs_(record)}
  }]})});
  const status={code:'FI_APLICATIVO_OPERACIONAL_ATIVO',preparation:result.code,received:pull.received||0,spreadsheetId:OSC.sheetId,incrementalPullMinutes:5};
  console.log(JSON.stringify(status));return status;
}
function receberEventosOperacionaisFI() {
  oscOwner_();
  if(sahmtV2Properties_().getProperty('FI_CUTOVER_ENABLED')!=='YES')throw Error('FI_CORTE_NAO_CONFERIDO');
  return oscRun_('PULL',null);
}
