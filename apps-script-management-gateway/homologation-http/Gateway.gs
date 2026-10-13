/**
 * Isolated HTTP connectivity probe for the HOMOLOGACAO Apps Script copy.
 * This file deliberately contains no authentication or data operations.
 */
function doPost(_event) {
  var result = {ok: false, code: 'GATEWAY_ADMISSION_DENIED'};
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
