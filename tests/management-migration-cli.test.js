import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile, writeFile, unlink, lstat, mkdir, rmdir} from 'node:fs/promises';
import {resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createPrivateJsonProtector} from '../scripts/lib/windows-protected-json.js';
import {snapshotDigest, prepareSplitPlan, documentDigest} from '../scripts/lib/management-split-plan.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = resolve(root, 'scripts/management-migration.mjs');
const directory = resolve(root, '.local-preview/management-split');
const run = args => spawnSync(process.execPath, [command, ...args],
  {cwd:root, encoding:'utf8', timeout:120000, maxBuffer:1024 * 1024, windowsHide:true});
const result = output => JSON.parse(output.trim());

async function protectedReviewSkipReason({base = directory, platform = process.platform,
  read = readFile, stat = lstat} = {}) {
  if (platform !== 'win32') return 'Windows DPAPI required for private local review';
  let receipt;
  try {receipt = JSON.parse((await read(resolve(base, 'management-split-receipt-v2.json'), 'utf8')).replace(/^\uFEFF/, ''));}
  catch (error) {
    if (error.code === 'ENOENT') return 'Private review receipt is absent from this checkout';
    return false; // Present but corrupt/inaccessible inputs must fail the real CLI assertion.
  }
  const names = ['capture-FA-20261009010412736-reviewed.dpapi.json',
    'capture-FB-20261009010036321.dpapi.json', receipt?.files?.manifest, receipt?.files?.plan];
  if (names.some(name => typeof name !== 'string' || name !== basename(name)
    || !/^[A-Za-z0-9._-]+\.dpapi\.json$/.test(name))) return false;
  for (const name of names) {
    try {await stat(resolve(base, name));}
    catch (error) {
      if (error.code === 'ENOENT') return 'Private reviewed snapshot or plan is absent from this checkout';
      return false;
    }
  }
  return false;
}
const reviewSkipReason = await protectedReviewSkipReason();
test('CLI rejeita comandos e argumentos sem ler credenciais ou iniciar Firestore', () => {
  for (const args of [[], ['--resume'], ['--review', 'unexpected'], ['--copy'],
    ['--copy', '../outside.dpapi.json'], ['--copy', 'plain.json'], ['--review', '--copy']]) {
    const output = run(args);
    assert.notEqual(output.status, 0);
    const receipt = result(output.stderr);
    assert.equal(receipt.firestoreReadAttemptsReserved, 0);
    assert.equal(receipt.firestoreWriteAttemptsIssued, 0);
    assert.equal(receipt.sourceWritesIssued, 0);
    assert.equal(receipt.appActivated, false);
    assert.equal(receipt.trainingStillStopped, true);
    assert.match(receipt.code, /^[A-Z][A-Z0-9_]+$/);
    assert.equal(output.stdout, '');
  }
});

test('CLI review verifica localmente os 134 pares protegidos, sem migração nem credenciais',
  {skip:reviewSkipReason}, () => {
    const output = run(['--review']);
    assert.equal(output.status, 0, output.stderr);
    const receipt = result(output.stdout);
    assert.equal(receipt.mode, 'LOCAL_PROTECTED_REVIEW');
    assert.equal(receipt.sourceProjectId, 'sahmt-17a16');
    assert.equal(receipt.destinationProjectId, 'sahmt-gestao-5ae66');
    assert.equal(receipt.counts.copy, 134);
    assert.equal(receipt.counts.keepFa, 231);
    assert.equal(receipt.firestoreReadsIssued, 0);
    assert.equal(receipt.firestoreWritesIssued, 0);
    assert.equal(receipt.credentialsLoaded, false);
    assert.equal(receipt.actualMigrationExecuted, false);
    assert.equal(receipt.sourceDeleted, false);
    assert.equal(receipt.trainingStillStopped, true);
    assert.equal(Object.hasOwn(receipt, 'documents'), false);
  });

test('CLI cópia recusa cápsula protegida expirada antes de contexto, credenciais ou rede',
  {skip:process.platform !== 'win32'}, async () => {
    const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
    const time = new Date(Date.now() - 3600000).toISOString();
    const document = {path:'managementAreas/synthetic', fields:{name:{stringValue:'PRIVATE_SYNTHETIC_CLI_DATA'}},
      createTime:time, updateTime:time};
    const sourceSnapshot = {schemaVersion:1, projectId:FA, databaseId:'(default)', readTime:time,
      coverage:{complete:true, consistent:true, rootCollections:['managementAreas']}, documents:[document]};
    const destinationSnapshot = {schemaVersion:1, projectId:FB, databaseId:'(default)', readTime:time,
      coverage:{complete:true, consistent:true, rootCollections:['managementAreas','migrationOrigins']}, documents:[]};
    const manifest = {schemaVersion:1, sourceProjectId:FA, destinationProjectId:FB,
      sourceDatabaseId:'(default)', destinationDatabaseId:'(default)', backupSha256:snapshotDigest(sourceSnapshot),
      identityMappings:[{memberId:'member-synthetic', faUid:'uid-synthetic', fbUid:'uid-synthetic'}],
      entries:[{path:document.path, action:'COPY', reason:'Synthetic local CLI test only', scope:'GESTAO',
        evidence:'RELATION_VERIFIED', sourceSha256:documentDigest(document), dependencies:[]}]};
    const plan = prepareSplitPlan(sourceSnapshot, manifest, destinationSnapshot);
    const pins = {planSha256:plan.planSha256, sourceSnapshotSha256:snapshotDigest(sourceSnapshot),
      manifestSha256:snapshotDigest(manifest), destinationSnapshotSha256:snapshotDigest(destinationSnapshot),
      aclSha256:'a'.repeat(64), identitySha256:snapshotDigest(manifest.identityMappings)};
    const approval = {schemaVersion:1, authorized:true, purpose:'MANAGEMENT_MIGRATION_CREATE_ONLY',
      requestId:'synthetic-expired-cli', sourceProjectId:FA, destinationProjectId:FB, databaseId:'(default)',
      approvedAt:time, expiresAt:new Date(Date.parse(time) + 600000).toISOString(), pins};
    let directoryCreated = false;
    try {await lstat(directory);} catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(directory, {recursive:true}); directoryCreated = true;
    }
    const protector = await createPrivateJsonProtector();
    const name = 'cli-test-' + randomUUID() + '.dpapi.json', file = resolve(directory, name);
    assert.equal(dirname(file), directory);
    const capsule = {schemaVersion:1, kind:'MANAGEMENT_MIGRATION_EXECUTION_CAPSULE',
      sourceSnapshot, manifest, destinationSnapshot, plan, approval, evidence:{}};
    try {
      await writeFile(file, JSON.stringify(protector.seal(capsule)) + '\n', {flag:'wx', mode:0o600});
      const output = run(['--copy', name]);
      assert.equal(output.status, 1);
      const receipt = result(output.stderr);
      assert.equal(receipt.code, 'MIGRATION_APPROVAL_EXPIRED');
      assert.equal(receipt.phase, 'CAPSULE_VALIDATION');
      assert.equal(receipt.firestoreReadAttemptsReserved, 0);
      assert.equal(receipt.firestoreWriteAttemptsIssued, 0);
      assert.equal(receipt.sourceWritesIssued, 0);
      assert.equal(output.stderr.includes('PRIVATE_SYNTHETIC_CLI_DATA'), false);
      assert.equal(output.stdout, '');
    } finally {
      // Exact owned test file; never recursive removal or a computed external path.
      await unlink(file);
      if (directoryCreated) {try {await rmdir(directory);} catch (error) {if (error.code !== 'ENOTEMPTY') throw error;}}
    }
  });

test('CLI vincula pósconferência e preserva budget em catch antes de fechar store', async () => {
  const code = await readFile(command, 'utf8');
  assert.match(code, /approvedAt:approval\.approvedAt/);
  assert.match(code, /createManagementMigrationPrivateStore\(\{root,directory,runId,pins:validated\.pins,scope,initialBudget:budget\}\)/);
  assert.match(code, /rest\.readDestinationPair\(\{runId,approvalRequestId:approval\.requestId/);
  const postcheck = code.slice(code.indexOf("phase='POSTCHECK'"));
  assert.equal((postcheck.match(/validateFbMigrationDestinationBudgetProof/g) || []).length, 2);
  assert.ok(postcheck.indexOf('validateFbMigrationDestinationBudgetProof') < postcheck.indexOf('rest.readDestinationPair'));
  const catchCode = code.slice(code.indexOf('}catch(error){'));
  assert.match(catchCode, /pauseFbMigrationDestinationBudget/);
  assert.match(catchCode, /finishFbMigrationDestinationBudget/);
  assert.match(catchCode, /status:'INCOMPLETE'/);
  assert.match(catchCode, /store\.retainForReview/);
});

test('review ignora só backups privados ausentes e conserva falhas de entradas presentes', async () => {
  const missing = Object.assign(new Error('fixture absent'), {code:'ENOENT'});
  const denied = Object.assign(new Error('fixture access denied'), {code:'EACCES'});
  const receipt = JSON.stringify({files:{manifest:'fixture-manifest.dpapi.json', plan:'fixture-plan.dpapi.json'}});
  assert.match(await protectedReviewSkipReason({platform:'win32', read:async()=>{throw missing;}}), /absent/);
  assert.match(await protectedReviewSkipReason({platform:'win32', read:async()=>receipt,
    stat:async()=>{throw missing;}}), /absent/);
  assert.equal(await protectedReviewSkipReason({platform:'win32', read:async()=>receipt, stat:async()=>({})}), false);
  assert.equal(await protectedReviewSkipReason({platform:'win32', read:async()=>'{invalid json'}), false);
  assert.equal(await protectedReviewSkipReason({platform:'win32', read:async()=>{throw denied;}}), false);
  assert.equal(await protectedReviewSkipReason({platform:'win32', read:async()=>receipt,
    stat:async()=>{throw denied;}}), false);
  assert.equal(await protectedReviewSkipReason({platform:'win32',
    read:async()=>JSON.stringify({files:{manifest:'../outside.dpapi.json', plan:'fixture-plan.dpapi.json'}})}), false);
});