import test from 'node:test';
import assert from 'node:assert/strict';
import {featureChangeRequiresRender, sessionChangeGrantsAccess, sessionChangeRequiresRender, sessionChangeRevokesAccess} from '../src/session-refresh.js';
import {featureEnabledForRoute, DEFAULT_APP_FEATURES} from '../src/feature-flags.js';

const profile = {role: 'anestesiologista', active: true, access: true, permissions: {eventsRead: true}};
const signedIn = (uid, value = profile) => ({status: 'signed-in', user: {uid}, profile: value});

test('perfil repetido ou atualização sem revogação preserva a tela em edição', () => {
  assert.equal(sessionChangeRequiresRender(signedIn('u1'), signedIn('u1')), false);
  assert.equal(sessionChangeRequiresRender(signedIn('u1'), signedIn('u1', {...profile, displayName: 'Nome atualizado'})), false);
  assert.equal(sessionChangeRevokesAccess(signedIn('u1'), signedIn('u1', {...profile, displayName: 'Nome atualizado'})), false);
  assert.equal(sessionChangeGrantsAccess(signedIn('u1'), signedIn('u1', {...profile, displayName: 'Nome atualizado'})), false);
});

test('revogação de permissão, papel, acesso, conta, sessão ou UID exige render imediato', () => {
  const revoked = [
    {...profile, permissions: {eventsRead: false}},
    {...profile, role: 'residente'},
    {...profile, access: false},
    {...profile, active: false}
  ];
  for (const nextProfile of revoked) assert.equal(sessionChangeRequiresRender(signedIn('u1'), signedIn('u1', nextProfile)), true);
  assert.equal(sessionChangeRequiresRender(signedIn('u1'), {status: 'signed-out'}), true);
  assert.equal(sessionChangeRequiresRender(signedIn('u1'), signedIn('u2')), true);
});

test('administração efetiva preservada não conta remoção de permissões redundantes como revogação', () => {
  const before = signedIn('u1', {role: 'administrador_app', active: true, access: true, permissions: {eventsRead: true, admin: true}});
  const after = signedIn('u1', {role: 'administrador_app', active: true, access: true, permissions: {}});
  assert.equal(sessionChangeRequiresRender(before, after), false);
});

test('troca de sigla muda o escopo pessoal imediatamente; normalização e administração global preservam a tela', () => {
  const before = signedIn('u1', {...profile, sigla: 'FR'});
  const after = signedIn('u1', {...profile, sigla: 'RO'});
  assert.equal(sessionChangeRequiresRender(before, after), true);
  assert.equal(sessionChangeRequiresRender(before, signedIn('u1', {...profile, sigla: ' fr '})), false);
  assert.equal(sessionChangeRequiresRender(
    signedIn('u1', {...profile, role: 'administrador_app', sigla: 'FR'}),
    signedIn('u1', {...profile, role: 'administrador_app', sigla: 'RO'})
  ), false);
});

test('novas permissões atualizam a Home, sem reconstruir módulo aberto', () => {
  const granted = signedIn('u1', {...profile, permissions: {...profile.permissions, labelsRead: true}});
  assert.equal(sessionChangeGrantsAccess(signedIn('u1'), granted), true);
  assert.equal(sessionChangeRevokesAccess(signedIn('u1'), granted), false);
  const before = {...DEFAULT_APP_FEATURES};
  const after = {...before, labels: false};
  assert.equal(featureChangeRequiresRender(before, after, 'home', featureEnabledForRoute), true);
  assert.equal(featureChangeRequiresRender(before, after, 'events', featureEnabledForRoute), false);
  assert.equal(featureChangeRequiresRender(before, after, 'labels', featureEnabledForRoute), true);
  assert.equal(featureChangeRequiresRender(before, before, 'home', featureEnabledForRoute), false);
});
