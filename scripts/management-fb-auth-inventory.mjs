import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {mkdir, readFile, writeFile, lstat, readdir} from 'node:fs/promises';
import {buildFbInventoryReport, collectFbAuthIndex, compareFaFbIndexes, FB_INVENTORY_PRIVATE_OUTPUT, safeFbInventoryDiagnostic} from './lib/management-fb-inventory.js';
import {sealPrivateJson, openPrivateJson} from './lib/windows-protected-json.js';

// Match the FB principal used by the successful read-only project preflight.
const EXPECTED_ACCOUNT = 'fb-owner@example.invalid';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failureStage = 'STARTUP';

async function ensurePrivateOutputDirectory() {
  const ignored = (await readFile(resolve(root, '.gitignore'), 'utf8')).split(/\r?\n/).includes('.local-preview/');
  if (!ignored) throw new Error('FB_INVENTORY_OUTPUT_NOT_GIT_IGNORED');
  const directory = resolve(root, FB_INVENTORY_PRIVATE_OUTPUT.directory), rel = relative(root, directory);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('FB_INVENTORY_OUTPUT_PATH_INVALID');
  const previewRoot = resolve(root, '.local-preview');
  await mkdir(previewRoot, {recursive: true});
  const previewStat = await lstat(previewRoot);
  if (previewStat.isSymbolicLink() || !previewStat.isDirectory()) throw new Error('FB_INVENTORY_OUTPUT_LINK_FORBIDDEN');
  await mkdir(directory, {recursive: true});
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('FB_INVENTORY_OUTPUT_LINK_FORBIDDEN');
  return directory;
}

async function run() {
  if (process.argv.length !== 2) throw new Error('FB_INVENTORY_TAKES_NO_ARGUMENTS');
  failureStage = 'OUTPUT_DIRECTORY';
  const directory = await ensurePrivateOutputDirectory();
  failureStage = 'DPAPI_PREFLIGHT';
  const probe = await sealPrivateJson({kind: 'FB_INVENTORY_LOCAL_PROTECTION_PROBE'});
  if ((await openPrivateJson(probe)).kind !== 'FB_INVENTORY_LOCAL_PROTECTION_PROBE') throw new Error('FB_INVENTORY_PROTECTION_PROBE_FAILED');
  failureStage = 'FA_INDEX_READ';
  const entries = await readdir(directory);
  const candidates = entries.filter(name => /^fa-auth-index-\d{17}\.dpapi\.json$/.test(name)).sort();
  if (!candidates.length) throw new Error('FB_COMPARISON_INDEX_INVALID');
  const indexStat = await lstat(resolve(directory, candidates.at(-1)));
  if (indexStat.isSymbolicLink() || !indexStat.isFile()) throw new Error('FB_COMPARISON_INDEX_INVALID');
  let faEnvelope = null, faIndex = null;
  try {
    faEnvelope = JSON.parse(await readFile(resolve(directory, candidates.at(-1)), 'utf8'));
    failureStage = 'DPAPI_FA_INDEX_OPEN';
    faIndex = await openPrivateJson(faEnvelope);
  } catch {
    throw new Error('FB_COMPARISON_INDEX_INVALID');
  } finally { faEnvelope = null; }
  if (faIndex?.schemaVersion !== 1 || faIndex?.kind !== 'FA_UID_COMPARISON_INDEX' || faIndex?.projectId !== 'sahmt-17a16' || !Array.isArray(faIndex.users)) {
    faIndex = null;
    throw new Error('FB_COMPARISON_INDEX_INVALID');
  }
  // Validate the protected source and the four-account cohort before acquiring an OAuth token.
  compareFaFbIndexes(faIndex, {schemaVersion: 1, kind: 'FB_UID_COMPARISON_INDEX', projectId: 'sahmt-gestao-5ae66', users: []});
  failureStage = 'CLI_AUTH_LOAD';
  const auth = createRequire(resolve(root, 'package.json'))('firebase-tools/lib/auth');
  failureStage = 'CLI_ACCOUNT_LOOKUP';
  const account = auth.getAllAccounts().find(value => value.user?.email === EXPECTED_ACCOUNT && value.tokens?.refresh_token);
  if (!account) { faIndex = null; throw new Error('FB_INVENTORY_EXPECTED_ACCOUNT_LOGIN_REQUIRED'); }
  let fbIndex = null, fbEnvelope = null;
  try {
    fbIndex = await collectFbAuthIndex({onStage: stage => { failureStage = stage; }, getAccessToken: async request => {
      if (request.projectId !== 'sahmt-gestao-5ae66' || request.scopes.length !== 1 || request.scopes[0] !== 'https://www.googleapis.com/auth/cloud-platform') throw new Error('FB_INVENTORY_OAUTH_SCOPE_INVALID');
      failureStage = 'OAUTH_TOKEN';
      const token = await auth.getAccessToken(account.tokens.refresh_token, request.scopes);
      if (!token?.access_token) throw new Error('FB_READ_ACCESS_TOKEN_UNAVAILABLE');
      return token.access_token;
    }});
    const report = buildFbInventoryReport(faIndex, fbIndex);
    faIndex = null;
    failureStage = 'DPAPI_FB_INDEX_SEAL';
    fbEnvelope = await sealPrivateJson(fbIndex = {schemaVersion: 1, kind: 'FB_UID_COMPARISON_INDEX', projectId: 'sahmt-gestao-5ae66', users: fbIndex.users});
    fbIndex = null;
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
    const indexName = `fb-auth-index-${stamp}.dpapi.json`, reportName = `fb-auth-comparison-${stamp}-summary.json`;
    failureStage = 'LOCAL_INDEX_WRITE';
    await writeFile(resolve(directory, indexName), JSON.stringify(fbEnvelope) + '\n', {flag: 'wx', mode: 0o600});
    fbEnvelope = null;
    failureStage = 'LOCAL_REPORT_WRITE';
    await writeFile(resolve(directory, reportName), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify(report));
  } finally {
    faIndex = null;
    fbIndex = null;
    fbEnvelope = null;
  }
}

run().catch(error => {
  console.error(JSON.stringify(safeFbInventoryDiagnostic(failureStage, error)));
  process.exitCode = 1;
});
