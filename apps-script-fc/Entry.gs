// FC deployment entrypoint. Business handlers retain their signed contracts.
const SAHMT_FC_EXECUTOR_EMAIL = 'anestesiahmtforms3@gmail.com';

function fcRuntimeCode_() {
  const props = sahmtV2Properties_();
  if (props.getProperty('FC_INTEGRATION_ENABLED') !== 'true') return 'FC_INTEGRATION_DISABLED';
  const executor = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (executor !== SAHMT_FC_EXECUTOR_EMAIL) return 'FC_EXECUTOR_MISMATCH';
  if (props.getProperty('FC_EXPECTED_SCRIPT_ID') !== ScriptApp.getScriptId()) return 'FC_SCRIPT_MISMATCH';
  return null;
}

function doPost(event) {
  const denied = fcRuntimeCode_();
  if (denied) return ospJson_({code: denied});
  const action = event && event.parameter && event.parameter.action;
  if (action === 'qmentum-write-v1') return qmWriteHttp_(event);
  if (action === 'qmentum-prints-v1') return qmPrintsHttp_(event);
  if (action === 'occurrence-score-v1') return evaluationOccurrenceHttp_(event);
  return ospJson_({code: 'FC_ROUTE_DENIED'});
}

function doGet() {
  return ospJson_({code: 'FC_INTEGRATION_STATUS', station: 'FC', enabled: fcRuntimeCode_() === null});
}

function fcPrintOcrMetadata_(name) {
  const folderId = sahmtV2Properties_().getProperty('FC_OCR_TEMP_FOLDER_ID');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId || '')) throw Error('FC_OCR_FOLDER_REQUIRED');
  return {name: name, mimeType: 'application/vnd.google-apps.document', parents: [folderId],
    appProperties: {sahmtPurpose: 'qmentum-print-ocr', sahmtStation: 'FC'}};
}
