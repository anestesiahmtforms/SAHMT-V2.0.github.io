// Patch only the reviewed transaction reader, including its renamed live variant.
const originalBody = `  const projectId = evaluationCollectionProject_(collectionId, transaction);
  const response = firestoreRequest_(evaluationDocumentsUrl_(':batchGet', projectId), {method: 'post', contentType: 'application/json',
    payload: JSON.stringify(Object.assign({documents: ['projects/' + projectId + '/databases/(default)/documents/' + collectionId + '/' + documentId], transaction: evaluationReadTransaction_(transaction, projectId)},
      fieldPaths ? {mask: {fieldPaths: fieldPaths}} : {}))});
  const document = (Array.isArray(response) ? response : [response]).find(function (item) { return item.found; });
  if (!document) return null;
  return evaluationDocument_(document.found);`;
const cachedBody = `  const projectId = evaluationCollectionProject_(collectionId, transaction);
  const readTransaction = evaluationReadTransaction_(transaction, projectId);
  const context = SAHMT_EVALUATION_TRANSACTIONS.get(transaction);
  // The cache belongs to this transaction attempt, never to an executor/session.
  // Preserve exact masks and routing; retries obtain a new snapshot and cache.
  const readKey = JSON.stringify([projectId, readTransaction, collectionId, documentId, fieldPaths || null]);
  const cache = context && (context.documentReads || (context.documentReads = new Map()));
  let response;
  if (cache && cache.has(readKey)) response = JSON.parse(cache.get(readKey));
  else {
    response = firestoreRequest_(evaluationDocumentsUrl_(':batchGet', projectId), {method: 'post', contentType: 'application/json',
      payload: JSON.stringify(Object.assign({documents: ['projects/' + projectId + '/databases/(default)/documents/' + collectionId + '/' + documentId], transaction: readTransaction},
        fieldPaths ? {mask: {fieldPaths: fieldPaths}} : {}))});
    // Keep raw REST values, so callers cannot mutate later reads or Date values.
    // Bound memory without changing query results when the cache is full.
    if (cache && cache.size < 128) {
      const serialized = JSON.stringify(response);
      if (serialized && serialized.length <= 65536) cache.set(readKey, serialized);
    }
  }
  const document = (Array.isArray(response) ? response : [response]).find(function (item) { return item.found; });
  if (!document) return null;
  return evaluationDocument_(document.found);`;

export function prepareEvaluationReadCache(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replaceAll('\r\n', '\n');
  if (normalized.includes(cachedBody)) return source;
  if (normalized.split(originalBody).length !== 2) throw Error('EVALUATION_READ_CACHE_SOURCE_DRIFT');
  if (!normalized.includes('finally { SAHMT_EVALUATION_TRANSACTIONS.delete(started.transaction); }'))
    throw Error('EVALUATION_READ_CACHE_LIFETIME_UNVERIFIED');
  return normalized.replace(originalBody, cachedBody).replaceAll('\n', newline);
}
