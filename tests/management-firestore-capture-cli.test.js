import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, sep, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {firestoreQuotaDayStart} from '../scripts/lib/management-read-budget.js';
const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectId = 'sahmt-gestao-5ae66';
async function fixture(t, changes = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sahmt-management-cli-'));
  t.after(async () => {
    const target = resolve(directory), allowed = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(allowed) && target.slice(allowed.length).startsWith('sahmt-management-cli-'));
    await rm(target, {recursive: true, force: true});
  });
  const privateDir = resolve(directory, '.local-preview/management-split');
  await mkdir(resolve(directory, 'scripts/lib'), {recursive: true});
  await mkdir(privateDir, {recursive: true});
  for (const name of ['management-firestore-capture.mjs', 'lib/firestore-snapshot-capture.js', 'lib/management-split-plan.js', 'lib/management-read-budget.js', 'lib/management-fb-bootstrap-budget.js', 'lib/windows-protected-json.js']) {
    await copyFile(resolve(root, 'scripts', name), resolve(directory, 'scripts', name));
  }
  if (changes.failPolicyRename) {
    // Fault injection affects only the temporary fixture copy, never production or ACLs.
    const copied = resolve(directory, 'scripts/management-firestore-capture.mjs');
    const source = await readFile(copied, 'utf8'), needle = 'await rename(temporary, activePolicyPath);';
    assert.equal(source.split(needle).length, 2);
    await writeFile(copied, source.replace(needle, "throw Error('SYNTHETIC_POLICY_WRITE_FAILURE');"));
  }
  await writeFile(resolve(directory, 'package.json'), '{"type":"module"}');
  await writeFile(resolve(directory, '.gitignore'), '.local-preview/\n');
  const now = Date.now(), day = firestoreQuotaDayStart(now);
  const policy = {schemaVersion: 1, projectId, dailyReadLimit: 35000, quotaTimeZone: 'America/Los_Angeles', renewalClearsPause: false, pausedRequiresReview: false, authorizedPurpose: 'MANAGEMENT_BACKUP_ONLY', humanDecisionAt: new Date(now - 1000).toISOString(), appTrafficReserve: 5000, metricLagReserve: 2000, maximumCaptureReserve: 6000, reservationQuotaDayStart: day, reservedReads: 0, ...changes.policy};
  const observation = {project: projectId, metric: 'firestore.googleapis.com/document/read_ops_count', reads: 0, quotaDayStart: day, latestPoint: new Date(now - 60000).toISOString(), verifiedAt: new Date(now - 1000).toISOString(), complete: true, fresh: true, ...changes.observation};
  const policyPath = resolve(privateDir, 'backup-read-policy-FB.json');
  await writeFile(policyPath, JSON.stringify(policy));
  if (!changes.missingObservation) await writeFile(resolve(privateDir, 'daily-read-observation-FB.json'), JSON.stringify(observation));
  await writeFile(resolve(privateDir, 'backup-scope-FB.json'), JSON.stringify({schemaVersion: 1, projectId, databaseId: '(default)', rootCollections: ['managementAreas']}));
  return {directory, privateDir, policyPath, policy};
}
async function run(value, mode = '--preflight') {
  try { const result = await execute(process.execPath, [resolve(value.directory, 'scripts/management-firestore-capture.mjs'), 'FB', mode], {cwd: value.directory, timeout: 20000, windowsHide: true, maxBuffer: 65536}); return {exitCode: 0, output: JSON.parse(result.stdout.trim())}; }
  catch (error) { assert.equal(typeof error.code, 'number'); return {exitCode: error.code, output: JSON.parse(error.stderr.trim())}; }
}
const currentPolicy = async value => JSON.parse(await readFile(value.policyPath, 'utf8'));
test('pausa existente bloqueia antes de credenciais e APIs mesmo com métrica fresca', async t => {
  const value = await fixture(t, {policy: {pausedRequiresReview: true}}), result = await run(value);
  assert.equal(result.output.errorCode, 'MANAGEMENT_READ_PAUSED_REQUIRES_REVIEW');
  assert.equal(result.output.pausePersisted, false); assert.equal(result.exitCode, 1);
  assert.deepEqual(await currentPolicy(value), value.policy);
});
test('ponto antigo declarando fresh mantém pausa persistente sem consultar Firebase', async t => {
  const value = await fixture(t, {observation: {latestPoint: new Date(Date.now() - 900000).toISOString()}}), result = await run(value);
  assert.equal(result.output.errorCode, 'MANAGEMENT_READ_METRIC_STALE_OR_INCOMPLETE'); assert.equal(result.output.pausePersisted, true);
  const saved = await currentPolicy(value); assert.equal(saved.pausedRequiresReview, true); assert.equal(saved.reservedReads, 0);
  assert.equal((await run(value)).output.errorCode, 'MANAGEMENT_READ_PAUSED_REQUIRES_REVIEW');
});
test('margem insuficiente registra pausa antes de qualquer tentativa', async t => {
  const value = await fixture(t, {observation: {reads: 27900}}), result = await run(value);
  assert.equal(result.output.errorCode, 'MANAGEMENT_DAILY_LIMIT_OR_MARGIN'); assert.equal(result.output.pausePersisted, true);
  assert.equal((await currentPolicy(value)).pausedRequiresReview, true);
});
test('preflight considera próxima página de 100 e não uma leitura', async t => {
  const value = await fixture(t, {policy: {reservedReads: 5950}}), result = await run(value);
  assert.equal(result.output.errorCode, 'MANAGEMENT_CAPTURE_RESERVE_LIMIT'); assert.equal(result.output.pausePersisted, true);
  assert.equal((await currentPolicy(value)).reservedReads, 5950);
});
test('observação ausente pausa de forma persistente', async t => {
  const value = await fixture(t, {missingObservation: true}), result = await run(value);
  assert.equal(result.output.errorCode, 'MANAGEMENT_READ_OBSERVATION_UNAVAILABLE'); assert.equal(result.output.pausePersisted, true);
});
test('preflight respeita lock do capturador e não sobrescreve pausa concorrente', async t => {
  const value = await fixture(t), lock = resolve(value.privateDir, 'backup-read-FB.lock');
  await writeFile(lock, 'owned-by-other-run', {flag: 'wx'});
  const result = await run(value);
  assert.equal(result.exitCode, 1); assert.equal(result.output.pausePersisted, false);
  assert.deepEqual(await currentPolicy(value), value.policy); assert.equal(await readFile(lock, 'utf8'), 'owned-by-other-run');
});
test('preflight elegível permanece local, não reserva nem procura credenciais', async t => {
  const value = await fixture(t), result = await run(value);
  assert.equal(result.exitCode, 0); assert.equal(result.output.eligibleForCapture, true); assert.equal(result.output.firestoreDocumentReadsIssued, 0);
  assert.equal(result.output.budget.reservedReads, 100); assert.equal(result.output.budget.exactGlobalCutoff, false);
  assert.deepEqual(await currentPolicy(value), value.policy);
});

test('falha ao salvar pausa conserva lock durável e bloqueia nova execução', async t => {
  const value = await fixture(t, {failPolicyRename: true, observation: {reads: 27900}}), result = await run(value);
  assert.equal(result.output.errorCode, 'MANAGEMENT_DAILY_LIMIT_OR_MARGIN'); assert.equal(result.output.pausePersisted, false);
  assert.equal(result.output.lockRetainedRequiresReview, true); assert.deepEqual(await currentPolicy(value), value.policy);
  assert.equal(await readFile(resolve(value.privateDir, 'backup-read-FB.lock'), 'utf8'), '');
  const repeated = await run(value); assert.equal(repeated.output.errorCode, 'MANAGEMENT_CAPTURE_LOCK_PRESENT_REQUIRES_REVIEW');
  assert.deepEqual(await currentPolicy(value), value.policy);
});
