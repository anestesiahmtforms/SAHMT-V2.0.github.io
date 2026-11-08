/** Adopt the copied Events workbook only after every visible row matches FJ. */
function prepararEventosEscalaFJ() {
  oscOwner_();
  sahmtV2Properties_().setProperty('FJ_EVENTS_SPREADSHEET_ID', '1tkFlErSuz9iaj-uoR6zcAiGxvH5sT3n2HOAJi331i8Q');
  sahmtV2RequirePrivateSpreadsheet_(OSC.sheetId);
  return oscLocked_(function() {
    const props = sahmtV2Properties_(), book = oscBook_(), state = new Map();
    if (props.getProperty(OSC.enabled) === 'YES') throw Error('FJ_EVENTOS_CONTROLE_JA_ATIVO');
    book.setSpreadsheetTimeZone('America/Sao_Paulo');
    const started = new Date().toISOString();
    let count = 0;
    OSC.tables.forEach(function(table) {
      const view = oscRows_(book, table), documents = oscList_(table.collection);
      const expected = new Map();
      documents.forEach(function(doc) {
        const data = firestoreFieldsToJs_(doc.fields || {});
        if (data.active === false || data.sheetDeleted === true) return;
        const key = oscDocKey_(doc), cells = oscRow_(table, doc, {});
        const row = view.rows.get(key);
        if (!row || !oscEqual_(row.cells, cells)) throw Error('FJ_EVENTOS_COPIA_DIVERGENTE');
        expected.set(key, true);
        state.set(key, {updateTime:doc.updateTime, cells:oscCanonical_(cells), deleted:false});
        count++;
      });
      view.rows.forEach(function(_, key) { if (!expected.has(key)) throw Error('FJ_EVENTOS_COPIA_REGISTRO_EXTRA'); });
    });
    if (!book.getSheetByName(OSC.stateTab)) throw Error('FJ_EVENTOS_CONTROLE_COPIADO_AUSENTE');
    // Only the synchronization baseline changes; user rows stay intact.
    oscSaveState_(book, state);
    OSC.tables.forEach(function(table) { props.setProperty(OSC.cursor + table.collection, JSON.stringify({timestamp:started})); });
    props.setProperty(OSC.ready, 'YES');
    props.setProperty(OSC.enabled, 'NO');
    return {code:'FJ_EVENTOS_COPIA_CONFERIDA', rows:count, firestoreWrites:0};
  });
}
function ativarEventosEscalaFJ() {
  oscOwner_();
  const proof = firestoreFieldsToJs_(firestoreRequest_(firestoreDocumentsUrl_('/migrationControl/fi-into-fj'), {method:'get'}).fields || {});
  if (proof.phase !== 'VERIFIED' || proof.sourceProject !== 'sahmt-operacional-fi' ||
      proof.targetProject !== 'sahmt-escala-fj' || proof.sourceFrozen !== true ||
      !/^[a-f0-9]{64}$/.test(proof.digest || '')) throw Error('FJ_EVENTOS_MIGRACAO_NAO_CONFERIDA');
  const p = sahmtV2Properties_();
  p.setProperty('FJ_EVENTS_CUTOVER_ENABLED', 'YES');
  const result = ativarControleOperacionalV1();
  // Retain the existing archive IDs so the last sheet deletion remains restorable.
  if (!p.getProperty('SAHMT_OPERATIONAL_LAST_DELETION')) {
    const archives = oscList_('operationalSheetArchives').filter(function(doc) {
      const data = firestoreFieldsToJs_(doc.fields || {});
      return data.action === 'EXCLUSAO' && /^events\/[^/]+$/.test(data.sourceKey || '');
    }).sort(function(a,b) { return String(b.fields.createdAt && b.fields.createdAt.timestampValue || '').localeCompare(String(a.fields.createdAt && a.fields.createdAt.timestampValue || '')); });
    if (archives.length) p.setProperty('SAHMT_OPERATIONAL_LAST_DELETION', archives[0].name.split('/').pop());
  }
  ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === 'receberEventosEscalaFJ') ScriptApp.deleteTrigger(t); });
  const trigger = ScriptApp.newTrigger('receberEventosEscalaFJ').timeBased().everyMinutes(5).create();
  p.setProperty('FJ_EVENTS_PULL_TRIGGER_ID', trigger.getUniqueId());
  const status = {code:'FJ_EVENTOS_ATIVOS', preparation:result.code, received:receberEventosEscalaFJ().received || 0};
  console.log(JSON.stringify(status));
  return status;
}
function receberEventosEscalaFJ() {
  oscOwner_();
  if (sahmtV2Properties_().getProperty('FJ_EVENTS_CUTOVER_ENABLED') !== 'YES') throw Error('FJ_EVENTOS_MIGRACAO_NAO_CONFERIDA');
  return oscRun_('PULL', null);
}
