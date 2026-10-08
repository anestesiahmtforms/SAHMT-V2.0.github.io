import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {readFile, writeFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const projects = {FA: {id: 'sahmt-17a16', principal: 'anestesiahmtforms@gmail.com'}, FB: {id: 'sahmt-gestao-5ae66', principal: 'anestesiahmtforms2@gmail.com'}};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const reference = process.argv[2], project = projects[reference];
  if (!project || process.argv.length !== 3) throw Error('USE_FA_OR_FB');
  const directory = resolve(root, '.local-preview/management-split');
  for (const path of [resolve(root, '.local-preview'), directory]) if ((await lstat(path)).isSymbolicLink()) throw Error('PRIVATE_OUTPUT_LINK_FORBIDDEN');
  if (!(await readFile(resolve(root, '.gitignore'), 'utf8')).split(/\r?\n/).includes('.local-preview/')) throw Error('PRIVATE_OUTPUT_NOT_IGNORED');
  const auth = createRequire(resolve(root, 'package.json'))('firebase-tools/lib/auth');
  const account = auth.getAllAccounts().find(value => value.user?.email === project.principal);
  if (!account?.tokens?.refresh_token) throw Error('EXPECTED_ACCOUNT_LOGIN_REQUIRED');
  const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  if (!token.access_token) throw Error('ACCESS_TOKEN_UNAVAILABLE');
  const startedAt = new Date().toISOString(), parent = 'projects/' + project.id + '/databases/(default)/collectionGroups/-';
  async function capture(resource, filter) {
    const results = [], pages = [], seen = new Set(); let pageToken = '';
    do {
      if (pages.length >= 50 || Date.now() - Date.parse(startedAt) > 180000) throw Error('INDEX_METADATA_CAPTURE_LIMIT');
      const query = new URLSearchParams({...(filter ? {filter} : {}), ...(pageToken ? {pageToken} : {})});
      // Firestore Admin metadata endpoints only; no documents endpoint exists here.
      const response = await fetch('https://firestore.googleapis.com/v1/' + parent + '/' + resource + '?' + query, {headers: {Authorization: 'Bearer ' + token.access_token}, signal: AbortSignal.timeout(20000)});
      if (!response.ok) throw Error('INDEX_METADATA_' + resource.toUpperCase() + '_HTTP_' + response.status);
      const body = await response.json();
      if (body[resource] !== undefined && !Array.isArray(body[resource]) || body.nextPageToken !== undefined && typeof body.nextPageToken !== 'string') throw Error('INDEX_METADATA_RESPONSE_INVALID');
      const batch = body[resource] || [];
      if (batch.length > 10000 || batch.some(value => typeof value.name !== 'string' || !value.name.startsWith('projects/' + project.id + '/databases/(default)/collectionGroups/'))) throw Error('INDEX_METADATA_RESOURCE_MISMATCH');
      results.push(...batch);
      if (Buffer.byteLength(JSON.stringify(results)) > 5 * 1024 * 1024) throw Error('INDEX_METADATA_SIZE_LIMIT');
      pages.push({count: batch.length, responseSha256: hash(body), final: !body.nextPageToken});
      pageToken = body.nextPageToken || '';
      if (pageToken && seen.has(pageToken)) throw Error('INDEX_METADATA_PAGE_TOKEN_REPEATED');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    if (new Set(results.map(value => value.name)).size !== results.length) throw Error('INDEX_METADATA_DUPLICATE_RESOURCE');
    return {results, pages};
  }
  const [indexes, indexFields, ttlFields] = await Promise.all([capture('indexes'), capture('fields', 'indexConfig.usesAncestorConfig:false'), capture('fields', 'ttlConfig:*')]);
  const fieldByName = new Map();
  for (const field of [...indexFields.results, ...ttlFields.results]) {
    const previous = fieldByName.get(field.name);
    if (previous && hash(previous) !== hash(field)) throw Error('INDEX_METADATA_FIELD_CHANGED_BETWEEN_FILTERS');
    fieldByName.set(field.name, field);
  }
  const fields = {results: [...fieldByName.values()], indexOverridePages: indexFields.pages, ttlPages: ttlFields.pages};
  const completedAt = new Date().toISOString();
  const packet = {schemaVersion: 1, kind: 'FIRESTORE_ADMIN_INDEX_METADATA_CAPTURE', projectId: project.id, databaseId: '(default)', startedAt, completedAt, completePagination: true, atomicSnapshot: false, indexes, overriddenFields: fields};
  const filename = 'indexes-' + reference + '-' + completedAt.replace(/[^0-9]/g, '') + '.json';
  await writeFile(resolve(directory, filename), JSON.stringify(packet, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  if (hash(JSON.parse(await readFile(resolve(directory, filename), 'utf8'))) !== hash(packet)) throw Error('INDEX_METADATA_FILE_HASH_MISMATCH');
  console.log(JSON.stringify({projectId: project.id, status: 'COMPLETE_METADATA_PAGINATION', compositeIndexCount: indexes.results.length, overrideOrTtlFieldCount: fields.results.length, atomicSnapshot: false, metadataSha256: hash(packet), file: filename, firestoreDocumentReadsIssued: 0, firestoreWritesIssued: 0}));
} catch (error) {
  const errorCode = /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'INDEX_METADATA_CAPTURE_FAILED';
  console.error(JSON.stringify({errorCode, firestoreDocumentReadsIssued: 0, firestoreWritesIssued: 0})); process.exitCode = 1;
}
