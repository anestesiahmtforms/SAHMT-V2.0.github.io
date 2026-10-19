import test from 'node:test';
import assert from 'node:assert/strict';
import {isOfflineOperationAuthorized, offlineOperationPermission} from '../src/offline-outbox-policy.js';

const profile = {active: true, access: true, permissions: {eventsWrite: true, labelsWrite: true, checklistWrite: true, admin: true}};

test('cada ação offline exige sua permissão própria atual, sem aceitar admin genérico', () => {
  for (const [type, permission] of [['events', 'eventsWrite'], ['eventEdits', 'eventsWrite'], ['labels', 'labelsWrite'], ['checklists', 'checklistWrite'], ['activities', 'managementActivityWrite'], ['scheduleReleases', 'scheduleWrite']]) {
    assert.equal(offlineOperationPermission(type), permission);
    assert.equal(isOfflineOperationAuthorized({type}, profile), profile.permissions[permission] === true);
  }
  assert.equal(offlineOperationPermission('users'), '');
});

test('perfil inativo, sem acesso ou permissão revogada não libera envio da fila', () => {
  assert.equal(isOfflineOperationAuthorized({type: 'events'}, profile), true);
  assert.equal(isOfflineOperationAuthorized({type: 'events'}, {...profile, active: false}), false);
  assert.equal(isOfflineOperationAuthorized({type: 'events'}, {...profile, access: false}), false);
  assert.equal(isOfflineOperationAuthorized({type: 'labels'}, {...profile, permissions: {labelsWrite: false}}), false);
  assert.equal(isOfflineOperationAuthorized({type: 'events'}, profile, {online: false}), false);
});
