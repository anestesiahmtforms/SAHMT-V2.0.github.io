/** Creates a private FI spreadsheet and loads its historical baseline. Writes remain disabled. */
function prepararOperacionalFI() {
  oscOwner_();
  sahmtPreparePrivateFolder_();
  sahmtPlaceScriptInFolder_();
  const properties = sahmtV2Properties_();
  if (!properties.getProperty('FI_OPERATIONAL_SPREADSHEET_ID')) {
    const folder = sahmtV2RequirePrivateFolder_();
    const book = SpreadsheetApp.create('Operacional — FI — Registros');
    DriveApp.getFileById(book.getId()).moveTo(folder);
    properties.setProperty('FI_OPERATIONAL_SPREADSHEET_ID', book.getId());
    properties.setProperty('FI_CUTOVER_ENABLED', 'NO');
  }
  const result = prepararControleOperacionalV1();
  const status = {station:'FI', spreadsheetId:OSC.sheetId, prepared:result, cutoverEnabled:false};
  console.log(JSON.stringify(status));
  return status;
}
