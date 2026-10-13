import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {readFile, readdir, lstat} from 'node:fs/promises';
import {collectFaCohortProfileIndex, prepareFaFirstLoginCohortPreview} from './lib/management-fa-cohort-preview.js';
import {openPrivateJson} from './lib/windows-protected-json.js';

const EXPECTED_ACCOUNT = 'fa-owner@example.invalid';
const OWNER_UID_ENV = 'SAHMT_FA_OWNER_UID';
const STRUCTURAL_UIDS_ENV = 'SAHMT_FA_STRUCTURAL_UIDS';
const FA_PROJECT = 'sahmt-17a16';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failureStage = 'STARTUP';

function safeFailure(stage, code) {
  const stages = new Set(['STARTUP', 'LOCAL_INDEX_READ', 'LOCAL_INDEX_OPEN', 'OWNER_UID_CHECK', 'CLI_AUTH', 'FIRESTORE_READ', 'LOCAL_PREVIEW']);
  const codes = new Set([
    'FA_COHORT_ARGUMENTS_INVALID', 'FA_COHORT_LOCAL_INDEX_NOT_FOUND', 'FA_COHORT_LOCAL_INDEX_INVALID',
    'FA_COHORT_OWNER_UID_REQUIRED', 'FA_COHORT_OWNER_UID_NOT_IN_AUTH_INDEX', 'FA_COHORT_CLI_LOGIN_REQUIRED',
    'FA_COHORT_TOKEN_UNAVAILABLE', 'FA_COHORT_PROFILE_READ_FAILED', 'FA_COHORT_PROFILE_READ_HTTP_ERROR',
    'FA_COHORT_PROFILE_READ_RESPONSE_INVALID', 'FA_COHORT_PROFILE_UID_INVALID_OR_DUPLICATED',
    'FA_COHORT_PROFILE_READ_TIME_LIMIT', 'FA_COHORT_PROFILE_READ_LIMIT', 'FA_COHORT_PROFILE_INDEX_INVALID',
    'FA_COHORT_AUTH_INDEX_INVALID', 'FA_COHORT_OWNER_UID_NOT_VALIDATED',
    'FA_COHORT_STRUCTURAL_UIDS_INVALID', 'FA_COHORT_OWNER_EMAIL_UID_MISMATCH'
  ]);
  return {stage: stages.has(stage) ? stage : 'STARTUP', code: codes.has(code) ? code : 'FA_COHORT_PREVIEW_FAILED',
    firestoreWritesIssued: 0, authWritesIssued: 0, iamChangesIssued: 0};
}

async function run() {
  if (process.argv.length !== 2) throw new Error('FA_COHORT_ARGUMENTS_INVALID');
  const validatedOwnerUid = process.env[OWNER_UID_ENV] || '';
  const structuralUidInput = process.env[STRUCTURAL_UIDS_ENV] || '';
  delete process.env[OWNER_UID_ENV];
  delete process.env[STRUCTURAL_UIDS_ENV];
  if (!validatedOwnerUid || !/^[^\s/\x00-\x1f]{1,128}$/.test(validatedOwnerUid)) throw new Error('FA_COHORT_OWNER_UID_REQUIRED');
  const parseUidList = raw => {
    if (!raw) return [];
    const values = raw.split(',');
    if (values.some(uid => !/^[^\s/,\x00-\x1f]{1,128}$/.test(uid))) throw new Error('FA_COHORT_UID_LIST_INVALID');
    return values;
  };
  const structuralProtectedUids = parseUidList(structuralUidInput);

  failureStage = 'LOCAL_INDEX_READ';
  const directory = resolve(root, '.local-preview', 'management-split');
  const relativePath = relative(root, directory);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) throw new Error('FA_COHORT_LOCAL_INDEX_INVALID');
  const baseStat = await lstat(resolve(root, '.local-preview'));
  const dirStat = await lstat(directory);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory() || dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw new Error('FA_COHORT_LOCAL_INDEX_INVALID');
  const names = await readdir(directory);
  const indexNames = names.filter(name => /^fa-auth-index-\d{17}\.dpapi\.json$/.test(name)).sort();
  if (!indexNames.length) throw new Error('FA_COHORT_LOCAL_INDEX_NOT_FOUND');
  const indexPath = resolve(directory, indexNames.at(-1));
  const indexStat = await lstat(indexPath);
  if (indexStat.isSymbolicLink() || !indexStat.isFile()) throw new Error('FA_COHORT_LOCAL_INDEX_INVALID');
  let envelope = JSON.parse(await readFile(indexPath, 'utf8'));
  failureStage = 'LOCAL_INDEX_OPEN';
  let authIndex = await openPrivateJson(envelope);
  envelope = null;
  if (authIndex?.schemaVersion !== 1 || authIndex?.kind !== 'FA_UID_COMPARISON_INDEX' || authIndex?.projectId !== FA_PROJECT || !Array.isArray(authIndex.users)) {
    authIndex = null;
    throw new Error('FA_COHORT_LOCAL_INDEX_INVALID');
  }
  failureStage = 'OWNER_UID_CHECK';
  if (!authIndex.users.some(user => user?.uid === validatedOwnerUid)) {
    authIndex = null;
    throw new Error('FA_COHORT_OWNER_UID_NOT_IN_AUTH_INDEX');
  }

  failureStage = 'CLI_AUTH';
  const auth = createRequire(resolve(root, 'package.json'))('firebase-tools/lib/auth');
  const account = auth.getAllAccounts().find(value => value.user?.email === EXPECTED_ACCOUNT && value.tokens?.refresh_token);
  if (!account) { authIndex = null; throw new Error('FA_COHORT_CLI_LOGIN_REQUIRED'); }
  const scope = 'https://www.googleapis.com/auth/cloud-platform';
  const token = await auth.getAccessToken(account.tokens.refresh_token, [scope]);
  if (!token?.access_token) { authIndex = null; throw new Error('FA_COHORT_TOKEN_UNAVAILABLE'); }
  let profileIndex = null;
  try {
    failureStage = 'FIRESTORE_READ';
    profileIndex = await collectFaCohortProfileIndex({accessToken: token.access_token});
    failureStage = 'LOCAL_PREVIEW';
    const report = prepareFaFirstLoginCohortPreview({authIndex, profileIndex, validatedOwnerUid, structuralProtectedUids});
    console.log(JSON.stringify(report));
  } finally {
    if (authIndex) { for (const row of authIndex.users || []) if (row && typeof row === 'object') for (const key of Object.keys(row)) row[key] = null; authIndex.users = []; }
    if (profileIndex) { for (const row of profileIndex.profiles || []) if (row && typeof row === 'object') for (const key of Object.keys(row)) row[key] = null; profileIndex.profiles = []; }
    profileIndex = null;
  }
}

run().catch(error => {
  const message = typeof error?.message === 'string' ? error.message : '';
  const safeCodes = new Set([
    'FA_COHORT_ARGUMENTS_INVALID', 'FA_COHORT_LOCAL_INDEX_NOT_FOUND', 'FA_COHORT_LOCAL_INDEX_INVALID',
    'FA_COHORT_OWNER_UID_REQUIRED', 'FA_COHORT_OWNER_UID_NOT_IN_AUTH_INDEX', 'FA_COHORT_CLI_LOGIN_REQUIRED',
    'FA_COHORT_TOKEN_UNAVAILABLE', 'FA_COHORT_PROFILE_READ_FAILED', 'FA_COHORT_PROFILE_READ_HTTP_ERROR',
    'FA_COHORT_PROFILE_READ_RESPONSE_INVALID', 'FA_COHORT_PROFILE_UID_INVALID_OR_DUPLICATED',
    'FA_COHORT_PROFILE_READ_TIME_LIMIT', 'FA_COHORT_PROFILE_READ_LIMIT', 'FA_COHORT_PROFILE_INDEX_INVALID',
    'FA_COHORT_AUTH_INDEX_INVALID', 'FA_COHORT_OWNER_UID_NOT_VALIDATED', 'FA_COHORT_STRUCTURAL_UIDS_INVALID',
    'FA_COHORT_OWNER_EMAIL_UID_MISMATCH', 'FA_COHORT_UID_LIST_INVALID'
  ]);
  console.error(JSON.stringify(safeFailure(failureStage, safeCodes.has(message) ? message : 'FA_COHORT_PREVIEW_FAILED')));
  process.exitCode = 1;
});
