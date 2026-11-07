/** Native activation requires the independently verified final migration receipt. */
function ativarEtiquetasFH(){
 oscOwner_();const doc=firestoreRequest_(firestoreDocumentsUrl_('/migrationControl/fh-cutover'),{method:'get'}),proof=firestoreFieldsToJs_(doc.fields||{});
 if(!['TARGET_READY','ACTIVE'].includes(proof.phase)||proof.finalDeltaVerified!==true||proof.sourceProducersRetired!==true||proof.targetProjectId!==SAHMT_V2_CONFIG.projectId||! /^[a-f0-9]{64}$/.test(proof.finalDeltaSha256||''))throw Error('FH_MIGRACAO_NAO_CONFERIDA');
 sahmtV2RequirePrivateSpreadsheet_(OSC.sheetId);const props=sahmtV2Properties_();props.setProperty('FH_CUTOVER_ENABLED','YES');const activated=ativarControleOperacionalV1();
 ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='receberEtiquetasFH')ScriptApp.deleteTrigger(t);});ScriptApp.newTrigger('receberEtiquetasFH').timeBased().everyMinutes(5).create();
 const pull=receberEtiquetasFH(),receipt={station:'FH',spreadsheetId:OSC.sheetId,activatedAt:new Date(),finalDeltaSha256:proof.finalDeltaSha256,incrementalPullMinutes:5};
 firestoreRequest_(firestoreDocumentsUrl_(':commit'),{method:'post',contentType:'application/json',payload:JSON.stringify({writes:[{update:{name:firestoreDocumentName_('migrationControl','apps-script-activation'),fields:firestoreFieldsFromJs_(receipt)}}]})});
 const result={code:'FH_ETIQUETAS_INDEPENDENTES_ATIVAS',spreadsheetId:OSC.sheetId,preparation:activated.code,received:pull.received||0,incrementalPullMinutes:5};console.log(JSON.stringify(result));return result;
}
function receberEtiquetasFH(){oscOwner_();if(sahmtV2Properties_().getProperty('FH_CUTOVER_ENABLED')!=='YES')throw Error('FH_MIGRACAO_NAO_CONFERIDA');return oscRun_('PULL',null);}
