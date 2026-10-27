import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {profileForPresentation} from '../src/profile-presentation.js';
import {isFirestoreCacheFallbackError} from '../src/offline-cache.js';
import {withinDeadline} from '../src/async-deadline.js';

const fixture = () => ({
  profile: {uid: 'fictional-uid', email: 'test-user-1@example.test', displayName: 'test-user-1@example.test', sigla: 'FC', phone: '', active: true, access: true, role: 'temporario', permissions: {managementRead: true, trainingsRead: true, notificationsRead: true}},
  user: {uid: 'fictional-uid', email: 'test-user-1@example.test', emailVerified: true, displayName: 'Nome Google Fictício', providerData: [{providerId: 'google.com'}]}
});

test('substitui somente nome-placeholder na apresentação sem mutar perfil ou permissões', () => {
  const {profile, user} = fixture();
  const original = structuredClone(profile);
  const display = profileForPresentation(profile, user);
  assert.equal(display.displayName, user.displayName);
  assert.deepEqual(profile, original);
  assert.equal(display.permissions, profile.permissions);
  assert.deepEqual({...display, displayName: original.displayName}, original);
});
test('preserva nome real cadastrado, ainda que o Google forneça nome diferente', () => {
  const {profile, user} = fixture();
  profile.displayName = 'Nome Cadastrado Fictício';
  assert.equal(profileForPresentation(profile, user), profile);
});
for (const [name, mutate] of [
  ['UID diferente', ({user}) => { user.uid = 'other-uid'; }],
  ['UID ausente', ({profile}) => { delete profile.uid; }],
  ['email diferente', ({user}) => { user.email = 'test-user-2@example.test'; }],
  ['email ausente', ({profile}) => { profile.email = ''; }],
  ['Google não verificado', ({user}) => { user.emailVerified = false; }],
  ['verificação textual', ({user}) => { user.emailVerified = 'true'; }],
  ['outro provedor', ({user}) => { user.providerData = [{providerId: 'password'}]; }],
  ['provedor ausente', ({user}) => { delete user.providerData; }],
  ['nome Google vazio', ({user}) => { user.displayName = '  '; }],
  ['nome Google igual email', ({user}) => { user.displayName = user.email; }],
  ['nome Google igual outro email', ({user}) => { user.displayName = 'test-user-2@example.test'; }],
  ['nome acima do limite', ({user}) => { user.displayName = 'N'.repeat(121); }],
  ['placeholder genérico diferente do email', ({profile}) => { profile.displayName = 'Usuário'; }]
]) test(`mantém o perfil sem alteração: ${name}`, () => {
  const f = fixture();
  mutate(f);
  assert.equal(profileForPresentation(f.profile, f.user), f.profile);
});
test('normaliza caixa/espaços do email e conserva nome/sigla/estado', () => {
  const {profile, user} = fixture();
  profile.email = ' test-user-1@example.test ';
  profile.displayName = 'test-user-1@example.test';
  const display = profileForPresentation(profile, user);
  assert.equal(display.displayName, user.displayName);
  assert.equal(display.sigla, 'FC');
  assert.equal(display.active, true);
});
test('um nome de apresentação não reativa perfil revogado', () => {
  const {profile, user} = fixture();
  profile.active = false;
  profile.access = false;
  const display = profileForPresentation(profile, user);
  assert.equal(display.active, false);
  assert.equal(display.access, false);
  assert.equal(display.permissions, profile.permissions);
});

function harness({active = true, access = true, online = true, profileReadError = null, cachedProfile = undefined} = {}) {
  const f = fixture();
  f.profile.active = active;
  f.profile.access = access;
  const cached = [], states = []; let cacheReads = 0;
  let snapshotCallback;
  const api = {doc: (_db, collection, id) => ({collection, id}), getDoc: async () => { if(profileReadError) throw profileReadError; return {exists: () => true, data: () => f.profile}; }, onSnapshot: (_ref, callback) => { snapshotCallback = callback; return () => {}; }};
  const source = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8')
    .replace(/^import(?!\s*\()[\s\S]*?;\r?\n/gm, '')
    .replace(/\bexport /g, '')
    .replace(/import\((['"][^'"]+['"])\)/g, 'fakeImport($1)');
  const context = vm.createContext({
    withinDeadline,operationalBackend:{run:(_key,action)=>action(),reset(){},noteFailure(){}},isFirestoreCacheFallbackError,
    firebaseConfigured: true, profileForPresentation, navigator: {onLine: online},
    window: {requestIdleCallback: (fn) => { context.idle = fn; return 1; }, cancelIdleCallback() {}, addEventListener() {}, removeEventListener() {}},
    cacheProfile: async (_uid, value) => { cached.push(value); }, readCachedProfile: async () => { cacheReads++; return cachedProfile === undefined ? f.profile : cachedProfile; },
    clearUserLocalData() {}, pendingOperationCount() {}, pendingTrainingProgressCount() {},
    fakeImport: async (name) => name==='./profile-server.js'?{readOwnProfileDocument:api.getDoc}:name.includes('firebase/firestore') ? api : {db: {}},
    onState: (next) => { states.push(next); }, user: f.user
  });
  vm.runInContext(source, context, {filename: 'src/auth.js'});
  return {...f, context, cached, states, get cacheReads(){return cacheReads;}, callback: () => snapshotCallback};
}
test('leitura inicial usa nome Google em memória e guarda cache do perfil original', async () => {
  const h = harness();
  await vm.runInContext('onAuthChangedProfile(user, onState, 1, () => 1, () => {})', h.context);
  assert.equal(h.states[0].profile.displayName, h.user.displayName);
  assert.equal(h.cached[0], h.profile);
  assert.equal(h.profile.displayName, h.profile.email);
});
test('primeiro observador repetido conserva a mesma apresentação, sem sobrescrever cache', async () => {
  const h = harness();
  await vm.runInContext('onAuthChangedProfile(user, onState, 1, () => 1, () => {})', h.context);
  await h.context.idle();
  await h.callback()({exists: () => true, data: () => h.profile});
  assert.equal(h.states.length, 2);
  assert.equal(h.states[0].profile.displayName, h.states[1].profile.displayName);
  assert.equal(h.cached[1], h.profile);
});
test('revogação do observador permanece bloqueada apesar de nome resolvido', async () => {
  const h = harness();
  await vm.runInContext('onAuthChangedProfile(user, onState, 1, () => 1, () => {})', h.context);
  await h.context.idle();
  h.profile.access = false;
  await h.callback()({exists: () => true, data: () => h.profile});
  assert.equal(h.states.at(-1).status, 'blocked');
  assert.equal(h.states.at(-1).profile.access, false);
});
test('cache offline usa a mesma apresentação sem conceder acesso novo', async () => {
  const h = harness({active: false, online: false});
  await vm.runInContext('showCachedSession(user, onState)', h.context);
  assert.equal(h.states[0].profile.displayName, h.user.displayName);
  assert.equal(h.states[0].status, 'auth-limited');
  assert.equal(h.states[0].offline, true);
});

test('cache concluído após troca de conta não emite novamente a sessão anterior', async () => {
  const h = harness(); let finish;
  h.context.cacheProfile = () => new Promise(resolve => {finish = resolve;}); h.context.currentGeneration = 1;
  const loading = vm.runInContext('onAuthChangedProfile(user, onState, 1, () => currentGeneration, () => {})', h.context);
  await loading;assert.equal(typeof finish,'function');assert.equal(h.states.length,1);
  h.context.currentGeneration = 2; finish(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.states.length, 1);
});
for (const code of ['resource-exhausted','firestore/unavailable']) test(`perfil cacheado não libera o app durante falha transitória do Firestore (${code})`, async () => {
  const h = harness({profileReadError: Object.assign(new Error('private response'), {code})});
  await vm.runInContext('onAuthChangedProfile(user, onState, 1, () => 1, () => {})', h.context);
  assert.equal(h.states.at(-1).status, 'auth-limited');
  assert.equal(h.states.at(-1).offline, true);
  assert.equal(h.states.at(-1).profile.uid, h.user.uid);
  assert.equal(h.cacheReads, 0);
});
for(const online of [true,false])test(`cache não contorna negação explícita do perfil (${online?'online':'offline'})`, async () => {
  const h = harness({online,profileReadError: Object.assign(new Error('private response'), {code: 'permission-denied'})});
  await vm.runInContext('onAuthChangedProfile(user, onState, 1, () => 1, () => {})', h.context);
  assert.equal(h.states.at(-1).status, 'auth-limited');
  assert.equal(h.cacheReads, 0);
});
test('perfil cacheado inativo continua bloqueado durante esgotamento de cota', async () => {
  const cachedProfile = {...fixture().profile, active: false};
  const h = harness({profileReadError: Object.assign(new Error('private response'), {code: 'resource-exhausted'}), cachedProfile});
  await vm.runInContext('onAuthChangedProfile(user, onState, 1, () => 1, () => {})', h.context);
  assert.equal(h.states.at(-1).status, 'auth-limited');
  assert.equal(h.states.at(-1).profile.active, false);
  assert.equal(h.cacheReads, 0);
});
test('cache ausente não libera a sessão quando Firestore está indisponível', async () => {
  const h = harness({profileReadError: Object.assign(new Error('private response'), {code: 'resource-exhausted'}), cachedProfile: null});
  await vm.runInContext('onAuthChangedProfile(user, onState, 1, () => 1, () => {})', h.context);
  assert.equal(h.states.at(-1).status, 'auth-limited');
  assert.equal(h.states.at(-1).profile.active, false);
  assert.equal(Object.keys(h.states.at(-1).profile.permissions).length, 0);
  assert.equal(h.cacheReads, 0);
});
