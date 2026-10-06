import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {profileForPresentation} from '../src/profile-presentation.js';

const fixture = () => ({
  profile: {uid: 'fictional-uid', email: 'fictional.member@gmail.com', displayName: 'fictional.member@gmail.com', sigla: 'FC', phone: '', active: true, access: true, role: 'temporario', permissions: {managementRead: true, trainingsRead: true, notificationsRead: true}},
  user: {uid: 'fictional-uid', email: 'fictional.member@gmail.com', emailVerified: true, displayName: 'Nome Google Fictício', providerData: [{providerId: 'google.com'}]}
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
  ['email diferente', ({user}) => { user.email = 'other@gmail.com'; }],
  ['email ausente', ({profile}) => { profile.email = ''; }],
  ['Google não verificado', ({user}) => { user.emailVerified = false; }],
  ['verificação textual', ({user}) => { user.emailVerified = 'true'; }],
  ['outro provedor', ({user}) => { user.providerData = [{providerId: 'password'}]; }],
  ['provedor ausente', ({user}) => { delete user.providerData; }],
  ['nome Google vazio', ({user}) => { user.displayName = '  '; }],
  ['nome Google igual email', ({user}) => { user.displayName = user.email; }],
  ['nome Google igual outro email', ({user}) => { user.displayName = 'other@gmail.com'; }],
  ['nome acima do limite', ({user}) => { user.displayName = 'N'.repeat(121); }],
  ['placeholder genérico diferente do email', ({profile}) => { profile.displayName = 'Usuário'; }]
]) test(`mantém o perfil sem alteração: ${name}`, () => {
  const f = fixture();
  mutate(f);
  assert.equal(profileForPresentation(f.profile, f.user), f.profile);
});
test('normaliza caixa/espaços do email e conserva nome/sigla/estado', () => {
  const {profile, user} = fixture();
  profile.email = ' Fictional.Member@GMAIL.com ';
  profile.displayName = 'FICTIONAL.MEMBER@gmail.com';
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

function harness({active = true, access = true, online = true} = {}) {
  const f = fixture();
  f.profile.active = active;
  f.profile.access = access;
  const cached = [], states = [];
  let snapshotCallback;
  const api = {doc: (_db, collection, id) => ({collection, id}), getDoc: async () => ({exists: () => true, data: () => f.profile}), onSnapshot: (_ref, callback) => { snapshotCallback = callback; return () => {}; }};
  const source = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/\bexport /g, '')
    .replace(/import\((['"][^'"]+['"])\)/g, 'fakeImport($1)');
  const context = vm.createContext({
    firebaseConfigured: true, profileForPresentation, navigator: {onLine: online},
    window: {requestIdleCallback: (fn) => { context.idle = fn; return 1; }, cancelIdleCallback() {}, addEventListener() {}, removeEventListener() {}},
    cacheProfile: async (_uid, value) => { cached.push(value); }, readCachedProfile: async () => f.profile,
    clearUserLocalData() {}, pendingOperationCount() {}, pendingTrainingProgressCount() {},
    fakeImport: async (name) => name.includes('firebase/firestore') ? api : {db: {}},
    onState: (next) => { states.push(next); }, user: f.user
  });
  vm.runInContext(source, context, {filename: 'src/auth.js'});
  return {...f, context, cached, states, callback: () => snapshotCallback};
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
  assert.equal(h.states[0].status, 'blocked');
  assert.equal(h.states[0].offline, true);
});
