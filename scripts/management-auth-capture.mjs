import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {readFile, writeFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sealPrivateJson, openPrivateJson} from './lib/windows-protected-json.js';
import {authSnapshotDigest} from './lib/management-auth-import-plan.js';
const projects = {FA: {id: 'sahmt-17a16', principal: 'anestesiahmtforms@gmail.com'}, FB: {id: 'sahmt-gestao-5ae66', principal: 'anestesiahmtforms2@gmail.com'}};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = user => ({
  uid: user.localId, disabled: user.disabled === true, emailVerified: user.emailVerified === true,
  ...Object.fromEntries(['email', 'displayName'].filter(key => user[key] !== undefined).map(key => [key, user[key]])),
  ...(user.photoUrl !== undefined ? {photoURL: user.photoUrl} : {}),
  providerData: (user.providerUserInfo || []).map(provider => ({providerId: provider.providerId, uid: provider.rawId,
    ...Object.fromEntries(['email', 'displayName'].filter(key => provider[key] !== undefined).map(key => [key, provider[key]])),
    ...(provider.photoUrl !== undefined ? {photoURL: provider.photoUrl} : {})}))
});
try {
  const target = projects[process.argv[2]];
  if (!target || process.argv.length !== 3) throw Error('USE_FA_OR_FB');
  const directory = resolve(root, '.local-preview/management-split');
  for (const path of [resolve(root, '.local-preview'), directory]) if ((await lstat(path)).isSymbolicLink()) throw Error('PRIVATE_OUTPUT_LINK_FORBIDDEN');
  if (!(await readFile(resolve(root, '.gitignore'), 'utf8')).split(/\r?\n/).includes('.local-preview/')) throw Error('PRIVATE_OUTPUT_NOT_IGNORED');
  // Prove local protection is available before obtaining any account data.
  const probe = await sealPrivateJson({purpose: 'LOCAL_PROTECTION_PROBE'});
  if ((await openPrivateJson(probe)).purpose !== 'LOCAL_PROTECTION_PROBE') throw Error('PROTECTION_PROBE_FAILED');
  const auth = createRequire(resolve(root, 'package.json'))('firebase-tools/lib/auth');
  const account = auth.getAllAccounts().find(value => value.user?.email === target.principal);
  if (!account?.tokens?.refresh_token) throw Error('EXPECTED_ACCOUNT_LOGIN_REQUIRED');
  const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  if (!token.access_token) throw Error('ACCESS_TOKEN_UNAVAILABLE');
  const startedAt = new Date().toISOString(), users = [], pages = [], tokens = new Set(), uids = new Set(); let pageToken = '';
  do {
    if (pages.length >= 50 || users.length > 50000 || Date.now() - Date.parse(startedAt) > 180000) throw Error('AUTH_CAPTURE_LIMIT_REACHED');
    const query = new URLSearchParams({maxResults: '1000', ...(pageToken ? {nextPageToken: pageToken} : {})});
    const response = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + target.id + '/accounts:batchGet?' + query,
      {headers: {Authorization: 'Bearer ' + token.access_token}, signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('AUTH_CAPTURE_HTTP_' + response.status);
    const data = await response.json();
    if (data.users !== undefined && !Array.isArray(data.users) || data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string') throw Error('AUTH_CAPTURE_RESPONSE_INVALID');
    const batch = data.users || [];
    for (const user of batch) {
      if (typeof user.localId !== 'string' || !user.localId || uids.has(user.localId)) throw Error('AUTH_CAPTURE_DUPLICATE_OR_MISSING_UID');
      uids.add(user.localId); users.push(user);
    }
    if (users.length > 50000 || Buffer.byteLength(JSON.stringify(users)) > 40 * 1024 * 1024) throw Error('AUTH_CAPTURE_SIZE_LIMIT');
    pages.push({pageNumber: pages.length + 1, requestTokenSha256: pageToken ? hash(pageToken) : null, responseSha256: hash(data), count: batch.length, final: !data.nextPageToken});
    pageToken = data.nextPageToken || '';
    if (pageToken && tokens.has(pageToken)) throw Error('AUTH_CAPTURE_PAGE_TOKEN_REPEATED');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  const completedAt = new Date().toISOString();
  users.sort((a, b) => a.localId.localeCompare(b.localId));
  const normalized = {schemaVersion: 1, projectId: target.id, readTime: completedAt, coverage: {complete: true, atomicSnapshot: false}, users: users.map(normalize)};
  const payload = {schemaVersion: 1, kind: 'AUTH_API_PAGINATED_CAPTURE', projectId: target.id, startedAt, completedAt, consistentWithFirestore: false, rawUsers: users, normalized, pages};
  const envelope = await sealPrivateJson(payload);
  const stamp = completedAt.replace(/[^0-9]/g, ''), filename = 'auth-' + process.argv[2] + '-' + stamp + '.dpapi.json';
  const bytes = JSON.stringify(envelope) + '\n';
  const file = resolve(directory, filename);
  await writeFile(file, bytes, {flag: 'wx', mode: 0o600});
  const restored = await openPrivateJson(JSON.parse(await readFile(file, 'utf8')));
  if (hash(restored) !== hash(payload) || authSnapshotDigest(restored.normalized) !== authSnapshotDigest(normalized)) throw Error('AUTH_BACKUP_ROUNDTRIP_MISMATCH');
  const receipt = {schemaVersion: 1, kind: 'AUTH_API_PAGINATED_CAPTURE', projectId: target.id, startedAt, completedAt,
    complete: true, atomicSnapshot: false, consistentWithFirestore: false, userCount: users.length, pageCount: pages.length,
    file: filename, ciphertextFileSha256: createHash('sha256').update(bytes).digest('hex'), plaintextSha256: envelope.plaintextSha256,
    normalizedSnapshotSha256: authSnapshotDigest(normalized), protection: envelope.protection, decryptAndHashVerified: true,
    passwordCredentialsPresent: users.some(user => user.passwordHash || user.salt), accountChangesIssued: 0, firestoreDocumentReadsIssued: 0};
  await writeFile(resolve(directory, 'auth-' + process.argv[2] + '-' + stamp + '-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify(receipt));
} catch (error) {
  const errorCode = /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'AUTH_CAPTURE_OR_PROTECTION_FAILED';
  console.error(JSON.stringify({errorCode, accountChangesIssued: 0, firestoreDocumentReadsIssued: 0})); process.exitCode = 1;
}