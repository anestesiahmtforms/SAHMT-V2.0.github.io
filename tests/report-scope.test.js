import test from 'node:test';
import assert from 'node:assert/strict';
import {captureReportReadScope} from '../src/report-read-scope.js';
import {createStartupReportCache} from '../src/startup-report-cache.js';

const signedIn = (uid = 'fictional-user', overrides = {}) => ({
  status: 'signed-in', user: {uid}, offline: false,
  profile: {active: true, access: true, role: 'anestesiologista', sigla: 'FA',
    permissions: {labelsRead: true, labelsWrite: true, labelsManage: false}, ...overrides}
});
const effectiveLabelPermissions = current => {
  const profile = current?.profile || {};
  const elevated = profile.role === 'administrador_app' || profile.permissions?.admin === true;
  return Object.fromEntries(['labelsRead', 'labelsWrite', 'labelsManage'].map(permission =>
    [permission, elevated || profile.permissions?.[permission] === true]));
};
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function setup(initial = signedIn()) {
  let current = initial;
  const scope = captureReportReadScope({getSession: () => current, getPermissions: effectiveLabelPermissions});
  return {scope, set: next => { current = next; }, get: () => current};
}

test('captura UID, sigla, papel e permissões efetivas sem referência mutável ao perfil', () => {
  const fixture = setup();
  assert.equal(fixture.scope.uid, 'fictional-user');
  assert.equal(fixture.scope.sigla, 'FA');
  assert.equal(fixture.scope.role, 'anestesiologista');
  assert.equal(fixture.scope.permissions.labelsWrite, true);
  fixture.get().profile.permissions.labelsWrite = false;
  fixture.get().profile.sigla = 'FB';
  assert.equal(fixture.scope.permissions.labelsWrite, true);
  assert.equal(fixture.scope.sigla, 'FA');
  assert.equal(fixture.scope.isCurrent(), false);
});

test('revogação durante importação impede iniciar consulta com permissões antigas', async () => {
  const fixture = setup();
  const importing = deferred();
  let reads = 0;
  const operation = (async () => {
    fixture.scope.assertCurrent();
    await importing.promise;
    fixture.scope.assertCurrent();
    reads++;
  })();
  fixture.set(signedIn('fictional-user', {permissions: {labelsRead: true, labelsWrite: false}}));
  importing.resolve();
  await assert.rejects(operation, {code: 'session-changed'});
  assert.equal(reads, 0);
});

test('resposta tardia não é aplicada após troca de conta, bloqueio, papel ou sigla', async () => {
  for (const replacement of [signedIn('another-fictional-user'), {status: 'signed-out'},
    {...signedIn(), status: 'blocked'}, signedIn('fictional-user', {active: false}),
    signedIn('fictional-user', {access: false}), signedIn('fictional-user', {role: 'gestor'}),
    signedIn('fictional-user', {sigla: 'FB'})]) {
    const fixture = setup();
    const reading = deferred();
    const rendered = [];
    const operation = (async () => {
      const result = await reading.promise;
      if (fixture.scope.isCurrent()) rendered.push(result);
    })();
    fixture.set(replacement);
    reading.resolve({records: [{id: 'fictional-label'}]});
    await operation;
    assert.deepEqual(rendered, []);
  }
});

test('cache inicial fica separado por escopo inclusive em mudança de papel na mesma conta', async () => {
  const cache = createStartupReportCache();
  const fixture = setup();
  await cache.warm(fixture.scope.key, () => ({records: []}));
  fixture.set(signedIn('fictional-user', {role: 'administrador_app'}));
  const elevated = captureReportReadScope({getSession: fixture.get, getPermissions: effectiveLabelPermissions});
  assert.equal(elevated.permissions.labelsManage, true);
  assert.notEqual(fixture.scope.key, elevated.key);
  assert.equal(cache.take(elevated.key), null);
});

test('perfil repetido, nome, updatedAt, offline e permissão de outro módulo preservam o escopo', () => {
  const fixture = setup();
  fixture.set({...signedIn('fictional-user', {displayName: 'Outro nome fictício', updatedAt: 'later',
    permissions: {labelsWrite: true, labelsManage: false, labelsRead: true, eventsWrite: true}}), offline: true});
  assert.equal(fixture.scope.isCurrent(), true);
  assert.equal(fixture.scope.assertCurrent(), 'fictional-user');
});

test('permissões brutas de administrador não invalidam acesso efetivo idêntico', () => {
  const fixture = setup(signedIn('fictional-user', {role: 'administrador_app'}));
  fixture.set(signedIn('fictional-user', {role: 'administrador_app', permissions: {labelsRead: false}}));
  assert.equal(fixture.scope.isCurrent(), true);
  assert.deepEqual(Object.keys(fixture.scope.permissions), ['labelsManage', 'labelsRead', 'labelsWrite']);
});

test('módulo desativado, relatório fechado ou alvo removido invalidam retomada da leitura', () => {
  let enabled = true;
  let connected = true;
  const scope = captureReportReadScope({getSession: () => signedIn(), getPermissions: effectiveLabelPermissions,
    isAllowed: () => enabled, isContextCurrent: () => connected});
  enabled = false;
  assert.equal(scope.isCurrent(), false);
  enabled = true; connected = false;
  assert.throws(() => scope.assertCurrent(), {code: 'session-changed'});
});

test('promoção por admin na mesma função invalida consulta restrita de Eventos', () => {
  let current = signedIn('fictional-user', {permissions: {eventsRead: true, eventsWrite: true}});
  const getPermissions = session => {
    const elevated = session.profile.role === 'administrador_app' || session.profile.permissions.admin === true;
    return {eventsRead: elevated || session.profile.permissions.eventsRead === true,
      eventsWrite: elevated || session.profile.permissions.eventsWrite === true, admin: elevated};
  };
  const scope = captureReportReadScope({getSession: () => current, getPermissions});
  current = signedIn('fictional-user', {permissions: {eventsRead: true, eventsWrite: true, admin: true}});
  assert.equal(scope.isCurrent(), false);
  assert.equal(scope.permissions.admin, undefined);
  const elevated = captureReportReadScope({getSession: () => current, getPermissions});
  assert.equal(elevated.permissions.admin, true);
  assert.notEqual(scope.key, elevated.key);
});
