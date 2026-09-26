/**
 * Read-only verification for the configured Spark executor.
 * Does not create or change Drive, Sheets, Firestore, script properties or triggers.
 * Run only after the executor identity and its IAM permissions have been reviewed.
 */
function verifySahmtV2ExecutorReadOnly() {
  const folder = sahmtV2RequirePrivateFolder_();
  const spreadsheetId = sahmtV2Properties_().getProperty(SAHMT_V2_CONFIG.reportsSpreadsheetProperty);
  if (!spreadsheetId || !/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) {
    throw new Error('Planilha ainda não configurada. Execute o setup somente após concluir a revisão de IAM e aprovar o destino privado.');
  }

  sahmtV2RequirePrivateSpreadsheet_(spreadsheetId);
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  requireSparkReportTabs_(spreadsheet);

  // Probe only the catalog collection and project only its document ID. Never return data.
  const response = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({structuredQuery: {
      from: [{collectionId: 'stations'}],
      select: {fields: [{fieldPath: 'id'}]},
      limit: 1
    }})
  });
  if (!Array.isArray(response)) throw new Error('Resposta inesperada do Firestore durante a verificação.');

  return {
    readOnly: true,
    firestoreQuery: 'ok',
    privateReportsFolder: 'ok',
    privateSpreadsheet: 'ok',
    reportTabs: Object.keys(SAHMT_V2_REPORT_TABS).length,
    stationCatalogHasDocument: response.some(function (item) { return Boolean(item && item.document); })
  };
}
