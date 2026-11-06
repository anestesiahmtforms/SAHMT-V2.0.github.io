/** Seed an independent, private source sheet from the already imported FJ data. */
function prepararEscalaFJ() {
  if (String(Session.getEffectiveUser().getEmail()).toLowerCase() !== SAHMT_V2_CONFIG.ownerEmail) throw new Error('EXECUTOR_FJ_INVALIDO');
  sahmtPreparePrivateFolder_();
  sahmtPlaceScriptInFolder_();
  const properties = sahmtV2Properties_();
  if (properties.getProperty('FJ_SOURCE_SPREADSHEET_ID')) {
    const existing = {station:'FJ',spreadsheetId:properties.getProperty('FJ_SOURCE_SPREADSHEET_ID'),alreadyPrepared:true};
    console.log(JSON.stringify(existing));
    return existing;
  }
  const folder = sahmtV2RequirePrivateFolder_(), source = readScheduleFirestore_();
  const book = SpreadsheetApp.create('Escala — FJ — Fonte');
  DriveApp.getFileById(book.getId()).moveTo(folder);
  const sheet = book.getSheets()[0]; sheet.setName('ESCALA');
  const headers = ['date'].concat(Array.from({length:17},function(_,index){return 'pos'+(index+1);}));
  const rows = source.scheduleDays.sort(function(a,b){return String(a.date).localeCompare(String(b.date));}).map(function(record){
    const positions=record.positions||[];
    return [record.date].concat(Array.from({length:17},function(_,index){const item=positions.find(function(position){return position.position===index+1;});return item?item.sigla:'';}));
  });
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  if(rows.length){sheet.getRange(2,1,rows.length,headers.length).setNumberFormat('@');sheet.getRange(2,1,rows.length,headers.length).setValues(rows.map(sahmtSafeSeedRow_));}
  const vacation = book.insertSheet('FÉRIAS'), vacationRows = source.vacations.filter(function(record){return record.active===true;}).map(function(record){return [record.start,record.end,JSON.stringify(record.siglas||[]),String(record.label||'')];});
  vacation.getRange(1,1,1,4).setValues([['start','end','siglas','label']]);
  if(vacationRows.length){vacation.getRange(2,1,vacationRows.length,4).setNumberFormat('@');vacation.getRange(2,1,vacationRows.length,4).setValues(vacationRows.map(sahmtSafeSeedRow_));}
  sheet.setFrozenRows(1); vacation.setFrozenRows(1);
  properties.setProperties({FJ_SOURCE_SPREADSHEET_ID:book.getId(),FJ_CUTOVER_ENABLED:'NO',SAHMT_V2_SCHEDULE_SYNC_ALLOWED_EMAILS:SAHMT_V2_CONFIG.ownerEmail});
  const status = {station:'FJ',spreadsheetId:book.getId(),scheduleRows:rows.length,vacationRows:vacationRows.length,cutoverEnabled:false};
  console.log(JSON.stringify(status));
  return status;
}

/** setValues interprets a leading equals sign as a formula even for imported text. */
function sahmtSafeSeedRow_(row) {
  return row.map(function(value){return typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value;});
}
