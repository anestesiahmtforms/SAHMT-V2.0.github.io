/** Owner-only initial preparation. No Firestore mutation or triggers. */
function prepararEtiquetasFH(){
 oscOwner_();sahmtPreparePrivateFolder_();sahmtPlaceScriptInFolder_();const props=sahmtV2Properties_();
 if(!props.getProperty('FH_LABELS_SPREADSHEET_ID')){const book=SpreadsheetApp.create('Etiquetas — FH — Registros');DriveApp.getFileById(book.getId()).moveTo(sahmtV2RequirePrivateFolder_());props.setProperty('FH_LABELS_SPREADSHEET_ID',book.getId());props.setProperty('FH_CUTOVER_ENABLED','NO');}
 const prepared=prepararControleOperacionalV1();const result={code:'FH_ETIQUETAS_PREPARADAS',spreadsheetId:OSC.sheetId,prepared:prepared,cutoverEnabled:false};console.log(JSON.stringify(result));return result;
}
