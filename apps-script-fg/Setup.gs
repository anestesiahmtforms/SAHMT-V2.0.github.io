/** Owner-only preparation. No Firestore writes, activation or automatic triggers. */
function prepararChecklistFG(){
  oscOwner_();sahmtPreparePrivateFolder_();sahmtPlaceScriptInFolder_();const props=sahmtV2Properties_();
  if(!props.getProperty('FG_CHECKLIST_SPREADSHEET_ID')){const book=SpreadsheetApp.create('Checklist — FG — Registros');DriveApp.getFileById(book.getId()).moveTo(sahmtV2RequirePrivateFolder_());props.setProperty('FG_CHECKLIST_SPREADSHEET_ID',book.getId());props.setProperty('FG_CUTOVER_ENABLED','NO');}
  const prepared=prepararControleOperacionalV1();const result={code:'FG_CHECKLIST_PREPARADO',spreadsheetId:OSC.sheetId,prepared:prepared,cutoverEnabled:false};console.log(JSON.stringify(result));return result;
}
