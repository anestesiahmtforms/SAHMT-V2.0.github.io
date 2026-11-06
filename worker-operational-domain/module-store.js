import {DOMAIN_PROJECTS, boundedJson, fail} from './identity.js';
import {encodeFields, decodeFields} from '../worker-training/firestore.js';

export function createModuleStore({station, getAccessToken, fetchImpl = fetch} = {}) {
  const projectId = DOMAIN_PROJECTS[station];
  if (!projectId || typeof getAccessToken !== 'function') throw fail('DOMAIN_STORE_CONFIG_INVALID');
  const prefix = `projects/${projectId}/databases/(default)/documents`, root = 'https://firestore.googleapis.com/v1/' + prefix;
  const readable = station === 'FI' ? ['events', 'eventProjectionOutbox', 'operationalSheetArchives'] : ['scheduleDays', 'eventProjections'];
  const name = (collection, id) => {
    if (!readable.includes(collection) || !/^[A-Za-z0-9_-]{1,180}$/.test(id || '')) throw fail('DOMAIN_STORE_PATH_DENIED', 400);
    return prefix + '/' + collection + '/' + id;
  };
  async function request(path, body) {
    const response = await fetchImpl(root + path, {method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: {Authorization: 'Bearer ' + await getAccessToken(), 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await boundedJson(response, 2 * 1024 * 1024);
    if (!response.ok) throw fail([409, 412].includes(response.status) || data.error?.status === 'ABORTED' ? 'DOMAIN_STORE_ABORTED' : 'DOMAIN_STORE_UNAVAILABLE',
      [409, 412].includes(response.status) || data.error?.status === 'ABORTED' ? 409 : 503);
    return data;
  }
  async function get(collection, id, transaction) {
    const expected = name(collection, id);
    const result = await request(':batchGet', {documents: [expected], ...(transaction ? {transaction} : {})});
    if (!Array.isArray(result) || result.length !== 1) throw fail('DOMAIN_STORE_RESPONSE_INVALID');
    if (result[0].missing === expected) return null;
    const document = result[0].found;
    if (document?.name !== expected) throw fail('DOMAIN_STORE_RESPONSE_INVALID');
    return {id, data: decodeFields(document.fields || {}), updateTime: document.updateTime};
  }
  async function listPending() {
    const collection = station === 'FI' ? 'eventProjectionOutbox' : 'eventProjections';
    const status = station === 'FI' ? 'PENDING' : 'WAITING_SCHEDULE';
    const result = await request(':runQuery', {structuredQuery: {from: [{collectionId: collection}],
      where: {fieldFilter: {field: {fieldPath: 'status'}, op: 'EQUAL', value: {stringValue: status}}},
      orderBy: [{field: {fieldPath: 'updatedAt'}, direction: 'ASCENDING'}], limit: 10}});
    if (!Array.isArray(result)) throw fail('DOMAIN_STORE_RESPONSE_INVALID');
    return result.filter(item => item.document).map(item => {
      const document = item.document, id = document.name.split('/').at(-1);
      if (document.name !== name(collection, id)) throw fail('DOMAIN_STORE_RESPONSE_INVALID');
      return {id, data: decodeFields(document.fields || {}), updateTime: document.updateTime};
    });
  }
  async function transaction(callback) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const opened = await request(':beginTransaction', {options: {readWrite: {}}});
      if (typeof opened.transaction !== 'string' || !opened.transaction) throw fail('DOMAIN_STORE_RESPONSE_INVALID');
      const transactionId = opened.transaction, writes = []; let committed = false;
      const transform = field => [{fieldPath: field, setToServerValue: 'REQUEST_TIME'}];
      try {
        const result = await callback({get: (collection, id) => get(collection, id, transactionId),
          setProjection(id, value) {
            if (station !== 'FJ') throw fail('DOMAIN_STORE_PATH_DENIED', 403);
            writes.push({update: {name: name('eventProjections', id), fields: encodeFields(value)}, updateTransforms: transform('updatedAt')});
          },
          patchSchedule(id, value) {
            if (station !== 'FJ') throw fail('DOMAIN_STORE_PATH_DENIED', 403);
            writes.push({update: {name: name('scheduleDays', id), fields: encodeFields({highlights: {events: value.events}, version: value.version, updatedByUid: value.actorUid})},
              updateMask: {fieldPaths: ['highlights.events', 'version', 'updatedByUid']}, updateTransforms: transform('updatedAt'), currentDocument: {exists: true}});
          },
          completeOutbox(id, version) {
            if (station !== 'FI' || !Number.isSafeInteger(version) || version < 1) throw fail('DOMAIN_STORE_PATH_DENIED', 403);
            writes.push({update: {name: name('eventProjectionOutbox', id), fields: encodeFields({status: 'DONE', processedVersion: version})},
              updateMask: {fieldPaths: ['status', 'processedVersion']}, updateTransforms: transform('processedAt'), currentDocument: {exists: true}});
          },
          deferOutbox(id) {
            if (station !== 'FI') throw fail('DOMAIN_STORE_PATH_DENIED', 403);
            writes.push({transform: {document: name('eventProjectionOutbox', id),
              fieldTransforms: [...transform('updatedAt'), ...transform('lastAttemptAt')]}, currentDocument: {exists: true}});
          }});
        if (writes.length) {await request(':commit', {transaction: transactionId, writes}); committed = true;}
        return result;
      } catch (error) {
        if (error.code !== 'DOMAIN_STORE_ABORTED' || attempt === 2) throw error;
      } finally {if (!committed) await request(':rollback', {transaction: transactionId}).catch(() => {});}
    }
    throw fail('DOMAIN_STORE_ABORTED', 409);
  }
  return Object.freeze({get, listPending, transaction});
}
