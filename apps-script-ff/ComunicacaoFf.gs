function conferirComunicacaoFfV1() {
  const projectId = 'sahmt-comunicacao-ff';
  const database = 'comunicacao';
  const owner = 'anestesiahmtforms6@gmail.com';
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== owner) {
    throw new Error('FF_EXECUTOR_MISMATCH');
  }
  const databasePath = 'projects/' + projectId + '/databases/' + database;
  const response = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/' + databasePath, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    followRedirects: false,
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('FF_DATABASE_HTTP_' + response.getResponseCode());
  }
  const config = JSON.parse(response.getContentText());
  if (config.name !== databasePath || config.type !== 'FIRESTORE_NATIVE') {
    throw new Error('FF_DATABASE_MISMATCH');
  }
  const result = { station: 'FF', projectId, database, reachable: true };
  console.info(JSON.stringify(result));
  return result;
}
