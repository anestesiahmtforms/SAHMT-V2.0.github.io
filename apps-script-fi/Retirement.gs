/** Retain data and historical workbook; stop only the migrated event handlers. */
function aposentarOperacionalFI() {
  if (String(Session.getEffectiveUser().getEmail()).toLowerCase() !== SAHMT_V2_CONFIG.ownerEmail) throw Error('EXECUTOR_FI_INVALIDO');
  const proof = firestoreFieldsToJs_(firestoreRequest_(firestoreDocumentsUrl_('/migrationControl/fi-into-fj'), {method:'get'}).fields || {});
  if (proof.phase !== 'VERIFIED' || proof.targetProject !== 'sahmt-escala-fj' || !/^[a-f0-9]{64}$/.test(proof.digest || '')) throw Error('FI_DESTINO_NAO_CONFERIDO');
  const p = sahmtV2Properties_();
  p.setProperty('FI_RETIRED', 'YES');
  p.setProperty('FI_CUTOVER_ENABLED', 'NO');
  p.setProperty(OSC.enabled, 'NO');
  const names = OSC.handlers.concat(['receberEventosOperacionaisFI']);
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) { if (names.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); removed++; } });
  const result = {code:'FI_APOSENTADO', removed:removed, dataDeleted:0};
  console.log(JSON.stringify(result));
  return result;
}
