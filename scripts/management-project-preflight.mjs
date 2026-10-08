import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {readFile, writeFile, mkdir, lstat, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Only management metadata: this program cannot query or write Firestore documents.
const projects = {
  FA: {id: 'sahmt-17a16', principal: 'anestesiahmtforms@gmail.com'},
  FB: {id: 'sahmt-gestao-5ae66', principal: 'anestesiahmtforms2@gmail.com'}
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = projects[process.argv[2]];
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeError = error => /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'METADATA_PREFLIGHT_FAILED';
try {
  if (!target || process.argv.length !== 3) throw Error('USE_FA_OR_FB');
  const require = createRequire(resolve(root, 'package.json'));
  const auth = require('firebase-tools/lib/auth');
  const account = auth.getAllAccounts().find(value => value.user?.email === target.principal);
  if (!account?.tokens?.refresh_token) {
    console.log(JSON.stringify({project: target.id, status: 'ACCOUNT_LOGIN_REQUIRED', firestoreDocumentReadsIssued: 0}));
    process.exitCode = 2;
  } else {
    const credential = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
    if (!credential.access_token) throw Error('ACCESS_TOKEN_UNAVAILABLE');
    const request = async (url, body) => {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {Authorization: 'Bearer ' + credential.access_token, ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw Error('METADATA_HTTP_' + response.status);
      return response.json();
    };
    const operations = {
      project: () => request('https://firebase.googleapis.com/v1beta1/projects/' + target.id),
      database: () => request('https://firestore.googleapis.com/v1/projects/' + target.id + '/databases/(default)'),
      billing: () => request('https://cloudbilling.googleapis.com/v1/projects/' + target.id + '/billingInfo'),
      iam: () => request('https://cloudresourcemanager.googleapis.com/v1/projects/' + target.id + ':getIamPolicy', {}),
      auth: () => request('https://identitytoolkit.googleapis.com/admin/v2/projects/' + target.id + '/config'),
      google: () => request('https://identitytoolkit.googleapis.com/admin/v2/projects/' + target.id + '/defaultSupportedIdpConfigs/google.com'),
      rules: async () => {
        const release = await request('https://firebaserules.googleapis.com/v1/projects/' + target.id + '/releases/cloud.firestore');
        if (!release.rulesetName?.startsWith('projects/' + target.id + '/rulesets/')) throw Error('RULESET_PROJECT_MISMATCH');
        const ruleset = await request('https://firebaserules.googleapis.com/v1/' + release.rulesetName);
        if (!Array.isArray(ruleset.source?.files) || !ruleset.source.files.length) throw Error('RULESET_SOURCE_MISSING');
        return {release, ruleset};
      }
    };
    const names = Object.keys(operations), values = await Promise.allSettled(names.map(name => operations[name]()));
    const responses = {}, checks = {};
    for (let index = 0; index < names.length; index++) {
      const name = names[index], value = values[index];
      if (value.status === 'fulfilled') { responses[name] = value.value; checks[name] = {status: 'VERIFIED', responseSha256: sha(value.value)}; }
      else checks[name] = {status: 'UNVERIFIED', errorCode: safeError(value.reason)};
    }
    const database = responses.database, sourceFiles = responses.rules?.ruleset.source.files;
    const proof = {
      schemaVersion: 1, mode: 'READ_ONLY_METADATA', projectId: target.id, verifiedAt: new Date().toISOString(),
      principalMatched: true, checks,
      projectMatches: responses.project?.projectId === target.id,
      database: database ? {name: database.name, locationId: database.locationId, type: database.type, edition: database.databaseEdition, createTime: database.createTime} : null,
      billingEnabled: responses.billing ? responses.billing.billingEnabled === true : null,
      expectedPrincipalIsOwner: responses.iam ? responses.iam.bindings?.some(binding => binding.role === 'roles/owner' && binding.members?.includes('user:' + target.principal)) === true : null,
      authorizedDomains: responses.auth?.authorizedDomains || null,
      googleEnabled: responses.google ? responses.google.enabled === true : null,
      publishedRules: sourceFiles ? {rulesetName: responses.rules.release.rulesetName, updateTime: responses.rules.release.updateTime, files: sourceFiles.map(file => ({name: file.name, sha256: createHash('sha256').update(file.content).digest('hex')}))} : null,
      firestoreDocumentReadsIssued: 0, firestoreWritesIssued: 0, authUsersChanged: 0, billingChanged: false
    };
    const privateRoot = resolve(root, '.local-preview/management-split');
    for (const directory of [resolve(root, '.local-preview'), privateRoot]) {
      try { if ((await lstat(directory)).isSymbolicLink()) throw Error('PRIVATE_OUTPUT_LINK_FORBIDDEN'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const ignore = await readFile(resolve(root, '.gitignore'), 'utf8');
    if (!ignore.split(/\r?\n/).includes('.local-preview/')) throw Error('PRIVATE_OUTPUT_NOT_IGNORED');
    await mkdir(privateRoot, {recursive: true});
    const actualRoot = await realpath(root), actualOutput = await realpath(privateRoot), relation = relative(actualRoot, actualOutput);
    if (isAbsolute(relation) || relation.startsWith('..')) throw Error('PRIVATE_OUTPUT_ESCAPES_WORKTREE');
    const stamp = proof.verifiedAt.replace(/[^0-9]/g, '');
    const proofFile = resolve(privateRoot, 'metadata-' + process.argv[2] + '-' + stamp + '.json');
    if (sourceFiles) await writeFile(resolve(privateRoot, 'rules-' + process.argv[2] + '-' + stamp + '.json'), JSON.stringify({projectId: target.id, release: responses.rules.release, source: sourceFiles}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({project: target.id, status: Object.values(checks).every(check => check.status === 'VERIFIED') ? 'VERIFIED' : 'PARTIAL', projectMatches: proof.projectMatches, database: proof.database, billingEnabled: proof.billingEnabled, expectedPrincipalIsOwner: proof.expectedPrincipalIsOwner, googleEnabled: proof.googleEnabled, authorizedDomainPresent: proof.authorizedDomains?.includes('anestesiahmtforms.github.io') ?? null, checks, proofFile: proofFile.slice(root.length + 1), firestoreDocumentReadsIssued: 0, firestoreWritesIssued: 0}));
  }
} catch (error) {
  console.error(JSON.stringify({errorCode: safeError(error), firestoreDocumentReadsIssued: 0, firestoreWritesIssued: 0}));
  process.exitCode = 1;
}