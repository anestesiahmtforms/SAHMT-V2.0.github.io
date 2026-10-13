import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {readFile, readdir, lstat} from 'node:fs/promises';
import {openPrivateJson} from './lib/windows-protected-json.js';
import {FA_INVENTORY_PRIVATE_OUTPUT} from './lib/management-fa-inventory.js';
import {scanManagementRetirementDependencies, summarizeManagementRetirementDependencies} from './lib/management-retirement-dependency-scan.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_ACCOUNT_ENV_BY_PROJECT = Object.freeze({
  'sahmt-17a16': 'SAHMT_RETIREMENT_OWNER_FA_EMAIL',
  'sahmt-gestao-5ae66': 'SAHMT_RETIREMENT_OWNER_FB_EMAIL',
  'indicadores---sahmt': 'SAHMT_RETIREMENT_OWNER_FC_EMAIL'
});
const INDEX_NAME = /^fa-auth-index-(\d{14,})\.dpapi\.json$/;
const SAFE_CODES = /^(RETIREMENT_[A-Z0-9_]+|FA_INVENTORY_[A-Z0-9_]+|FIREBASE_CLI_[A-Z0-9_]+)$/;
let failureStage = 'ARGUMENTS';

function parseArguments(argv) {
  if (argv.length !== 2 || !argv.includes('--confirm-read-only')) throw new Error('RETIREMENT_SCAN_CONFIRMATION_REQUIRED');
  const projectArg = argv.find(value => value.startsWith('--read-project='));
  const projectAlias = projectArg?.slice('--read-project='.length);
  if (!['FA', 'FB', 'FC'].includes(projectAlias) || argv.filter(value => value.startsWith('--read-project=')).length !== 1) {
    throw new Error('RETIREMENT_PROJECT_NOT_ALLOWED');
  }
  return projectAlias;
}

async function loadProtectedIndex() {
  failureStage = 'LOCAL_INDEX';
  const directory = resolve(root, FA_INVENTORY_PRIVATE_OUTPUT.directory);
  const rel = relative(root, directory);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('RETIREMENT_INDEX_PATH_INVALID');
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('RETIREMENT_INDEX_PATH_INVALID');
  const names = (await readdir(directory)).filter(name => INDEX_NAME.test(name)).sort();
  if (!names.length) throw new Error('RETIREMENT_FA_INDEX_MISSING');
  const name = names.at(-1);
  const filePath = resolve(directory, name);
  const fileStat = await lstat(filePath);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new Error('RETIREMENT_INDEX_PATH_INVALID');
  let envelope;
  try { envelope = JSON.parse(await readFile(filePath, 'utf8')); }
  catch { throw new Error('RETIREMENT_FA_INDEX_INVALID'); }
  try { return await openPrivateJson(envelope); }
  catch { throw new Error('RETIREMENT_FA_INDEX_DPAPI_FAILED'); }
}

async function readOnlyAccessToken(projectId, scopes) {
  failureStage = 'FIREBASE_CLI_AUTH';
  if (!Array.isArray(scopes) || scopes.length !== 1 || scopes[0] !== 'https://www.googleapis.com/auth/cloud-platform') {
    throw new Error('RETIREMENT_SCAN_OAUTH_SCOPE_INVALID');
  }
  let auth;
  try { auth = createRequire(resolve(root, 'package.json'))('firebase-tools/lib/auth'); }
  catch { throw new Error('FIREBASE_CLI_AUTH_UNAVAILABLE'); }
  const accountEnv = EXPECTED_ACCOUNT_ENV_BY_PROJECT[projectId];
  if (!accountEnv) throw new Error('RETIREMENT_PROJECT_NOT_ALLOWED');
  const expectedAccount = process.env[accountEnv]?.trim().toLowerCase();
  if (!expectedAccount || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedAccount)) throw new Error('FIREBASE_CLI_PROJECT_OWNER_REQUIRED');
  const account = auth.getAllAccounts().find(value => value.user?.email === expectedAccount && value.tokens?.refresh_token);
  if (!account) throw new Error('FIREBASE_CLI_EXPECTED_ACCOUNT_LOGIN_REQUIRED');
  let result;
  try { result = await auth.getAccessToken(account.tokens.refresh_token, scopes); }
  catch { throw new Error('RETIREMENT_SCAN_OAUTH_FAILED'); }
  if (!result?.access_token) throw new Error('RETIREMENT_SCAN_TOKEN_UNAVAILABLE');
  return result.access_token;
}

async function run() {
  const projectAlias = parseArguments(process.argv.slice(2));
  let protectedFaIndex, scan;
  try {
    protectedFaIndex = await loadProtectedIndex();
    failureStage = 'DEPENDENCY_SCAN';
    scan = await scanManagementRetirementDependencies({projectAlias, protectedFaIndex,
      getAccessToken: ({projectId, scopes}) => readOnlyAccessToken(projectId, scopes),
      onStage: stage => { failureStage = stage; }});
    const report = summarizeManagementRetirementDependencies(scan, protectedFaIndex);
    console.log(JSON.stringify(report));
  } finally {
    if (scan?.references && !Object.isFrozen(scan.references)) scan.references.length = 0;
    scan = null;
    if (protectedFaIndex?.users) protectedFaIndex.users.length = 0;
    protectedFaIndex = null;
  }
}

run().catch(error => {
  const code = typeof error?.message === 'string' && SAFE_CODES.test(error.message) ? error.message : 'RETIREMENT_SCAN_FAILED';
  console.error(JSON.stringify({stage: failureStage, code, identifiersLogged: false}));
  process.exitCode = 1;
});
