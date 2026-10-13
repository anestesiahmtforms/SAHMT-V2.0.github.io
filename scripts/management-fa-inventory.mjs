import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {mkdir, readFile, writeFile, lstat} from 'node:fs/promises';
import {collectFaInventory, FA_INVENTORY_PRIVATE_OUTPUT, safeInventoryDiagnostic} from './lib/management-fa-inventory.js';
import {sealPrivateJson, openPrivateJson} from './lib/windows-protected-json.js';

const EXPECTED_ACCOUNT = 'fa-owner@example.invalid';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failureStage = 'STARTUP';

async function ensurePrivateOutputDirectory() {
  const ignored = (await readFile(resolve(root, '.gitignore'), 'utf8')).split(/\r?\n/).includes('.local-preview/');
  if (!ignored) throw new Error('FA_INVENTORY_OUTPUT_NOT_GIT_IGNORED');
  const directory = resolve(root, FA_INVENTORY_PRIVATE_OUTPUT.directory);
  const rel = relative(root, directory);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('FA_INVENTORY_OUTPUT_PATH_INVALID');
  const previewRoot = resolve(root, '.local-preview');
  await mkdir(previewRoot, {recursive: true});
  const previewStat = await lstat(previewRoot);
  if (previewStat.isSymbolicLink() || !previewStat.isDirectory()) throw new Error('FA_INVENTORY_OUTPUT_LINK_FORBIDDEN');
  await mkdir(directory, {recursive: true});
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('FA_INVENTORY_OUTPUT_LINK_FORBIDDEN');
  return directory;
}

async function run() {
  if (process.argv.length !== 2) throw new Error('FA_INVENTORY_TAKES_NO_ARGUMENTS');
  failureStage = 'OUTPUT_DIRECTORY';
  const directory = await ensurePrivateOutputDirectory();
  // Fail locally before acquiring any access token if Windows DPAPI is unavailable.
  failureStage = 'DPAPI_PREFLIGHT';
  const probe = await sealPrivateJson({kind: 'FA_INVENTORY_LOCAL_PROTECTION_PROBE'});
  if ((await openPrivateJson(probe)).kind !== 'FA_INVENTORY_LOCAL_PROTECTION_PROBE') throw new Error('FA_INVENTORY_PROTECTION_PROBE_FAILED');
  failureStage = 'CLI_AUTH_LOAD';
  const auth = createRequire(resolve(root, 'package.json'))('firebase-tools/lib/auth');
  failureStage = 'CLI_ACCOUNT_LOOKUP';
  const account = auth.getAllAccounts().find(value => value.user?.email === EXPECTED_ACCOUNT && value.tokens?.refresh_token);
  if (!account) throw new Error('FA_INVENTORY_EXPECTED_ACCOUNT_LOGIN_REQUIRED');
  let result = null, protectedEnvelope = null;
  try {
    result = await collectFaInventory({onStage: stage => { failureStage = stage; }, getAccessToken: async request => {
      const expectedScope = request.api === 'READ_ONLY_DATA' ? 'https://www.googleapis.com/auth/cloud-platform' : null;
      if (request.projectId !== 'sahmt-17a16' || request.scopes.length !== 1 || request.scopes[0] !== expectedScope) throw new Error('FA_INVENTORY_OAUTH_SCOPE_INVALID');
      failureStage = 'OAUTH_TOKEN';
      const token = await auth.getAccessToken(account.tokens.refresh_token, request.scopes);
      if (!token?.access_token) throw new Error('FA_INVENTORY_ACCESS_TOKEN_UNAVAILABLE');
      return token.access_token;
    }});
    failureStage = 'DPAPI_INDEX_SEAL';
    protectedEnvelope = await sealPrivateJson(result.protectedIndex);
    result.protectedIndex = null;
    const stamp = result.report.capturedAt.replace(/[^0-9]/g, '');
    const indexName = `fa-auth-index-${stamp}.dpapi.json`;
    const reportName = `fa-auth-inventory-${stamp}-summary.json`;
    failureStage = 'LOCAL_INDEX_WRITE';
    await writeFile(resolve(directory, indexName), JSON.stringify(protectedEnvelope) + '\n', {flag: 'wx', mode: 0o600});
    protectedEnvelope = null;
    failureStage = 'LOCAL_REPORT_WRITE';
    await writeFile(resolve(directory, reportName), JSON.stringify(result.report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    // Terminal output is the same aggregate-only report; no IDs or API payloads.
    console.log(JSON.stringify({...result.report, files: {protectedComparisonIndex: indexName, aggregateReport: reportName}}));
  } finally {
    protectedEnvelope = null;
    if (result) result.protectedIndex = null;
  }
}

run().catch(error => {
  console.error(JSON.stringify({...safeInventoryDiagnostic(failureStage, error), accountChangesIssued: 0, firestoreWritesIssued: 0}));
  process.exitCode = 1;
});
