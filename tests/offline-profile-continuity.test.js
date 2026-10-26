import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB, IDBKeyRange} from 'fake-indexeddb';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {isFirestoreCacheFallbackError} from '../src/offline-cache.js';
import {firebaseFailureCode} from '../src/firebase-failure.js';
import {withinDeadline} from '../src/async-deadline.js';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
const outbox = await import('../src/outbox.js');
const HOUR = 3600000;
const source = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8')
  .replace(/^import(?!\s*\()[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, '')
  .replace(/import\((['"][^'"]+['"])\)/g, 'fakeImport($1)');

async function seed(uid, ageHours, extra = {}) {
  const now = Date.now;
  const snapshotTime = now() - ageHours * HOUR;
  Date.now = () => snapshotTime;
  try {await outbox.cacheProfile(uid, {uid, active: true, access: true, permissions: {checklistRead: true}, ...extra});}
  finally {Date.now = now;}
}

test('perfil já validado de 25 horas continua disponível localmente sem renovar sua data', async () => {
  await seed('continuity', 25);
  const profile = await outbox.readCachedProfile('continuity');
  assert.ok(profile);
  assert.equal(profile.uid, 'continuity');
  assert.deepEqual(profile.permissions, {checklistRead: true});
  assert.ok(Date.now() - profile.cachedAt >= 25 * HOUR);
});

test('limite explícito de 24h e limite padrão de sete dias são respeitados', async () => {
  await seed('explicit-age', 25);
  assert.equal(await outbox.readCachedProfile('explicit-age', 24 * HOUR), null);
  await seed('expired', 169);
  assert.equal(await outbox.readCachedProfile('expired'), null);
});

test('data futura não é aceita como perfil validado', async () => {
  await seed('future', -1);
  assert.equal(await outbox.readCachedProfile('future'), null);
});

function harness(code, uid) {
  const states = [];
  const context = vm.createContext({
    withinDeadline, firebaseConfigured: true, firebaseFailureCode, isFirestoreCacheFallbackError,
    profileForPresentation: value => value, readCachedProfile: outbox.readCachedProfile,
    cacheProfile: outbox.cacheProfile, navigator: {onLine: true},
    operationalBackend: {run: (_key, action) => action()},
    fakeImport: async () => ({readOwnProfileDocument: async () => {throw Object.assign(new Error('private body must never appear'), {code});}})
  });
  vm.runInContext(source, context);
  return {states, run: () => context.onAuthChangedProfile({uid}, state => states.push(state), 1, () => 1, () => {})};
}

test('cota indisponível usa perfil de 25h somente em sessão offline', async () => {
  await seed('quota-profile', 25);
  const h = harness('resource-exhausted', 'quota-profile'); await h.run();
  assert.equal(h.states.at(-1).status, 'signed-in');
  assert.equal(h.states.at(-1).offline, true);
  assert.deepEqual(h.states.at(-1).profile.permissions, {checklistRead: true});
});

test('cache ausente continua restrito e explica a falta de perfil local', async () => {
  const h = harness('resource-exhausted', 'missing-profile'); await h.run();
  assert.equal(h.states.at(-1).status, 'auth-limited');
  assert.equal(h.states.at(-1).profileFailureCode, 'LOCAL_PROFILE_UNAVAILABLE');
  assert.equal(Object.keys(h.states.at(-1).profile.permissions).length, 0);
});

test('negação explícita não é contornada pelo cache de sete dias', async () => {
  await seed('denied-profile', 25);
  const h = harness('permission-denied', 'denied-profile'); await h.run();
  assert.equal(h.states.at(-1).status, 'auth-limited');
  assert.equal(h.states.at(-1).profileFailureCode, 'PROFILE_PERMISSION_DENIED');
  assert.doesNotMatch(JSON.stringify(h.states), /private body/);
});

test('perfil desativado continua bloqueado', async () => {
  await seed('inactive-profile', 25, {active: false});
  const h = harness('resource-exhausted', 'inactive-profile'); await h.run();
  assert.equal(h.states.at(-1).status, 'blocked');
});

test('falha no armazenamento local é identificada sem expor exceções', async () => {
  const context = vm.createContext({withinDeadline,readCachedProfile: async () => {throw Error('private storage details');}, profileForPresentation: value => value});
  const slice = source.slice(source.indexOf('async function showCachedSession('), source.indexOf('function watchSession('));
  vm.runInContext(slice, context); const states = [];
  await context.showCachedSession({uid: 'storage-fixture'}, state => states.push(state));
  assert.equal(states[0].profileFailureCode, 'LOCAL_STORAGE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(states), /private storage/);
});

test('banner restrito mostra somente o código seguro de diagnóstico', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /data-profile-diagnostic/);
  assert.match(main, /escapeHtml\(session\.profileFailureCode\)/);
});
