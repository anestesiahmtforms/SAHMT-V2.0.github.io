import test from 'node:test';
import assert from 'node:assert/strict';
import {isOfflineRuntimeForced, setOfflineRuntimeMode, shouldQueueOfflineOperationalWrite} from '../src/offline-runtime-mode.js';

test('offline runtime pode ser ativado pelo estado de sessão e depois reaberto após validação online', () => {
  setOfflineRuntimeMode(true);
  assert.equal(isOfflineRuntimeForced(), true);
  setOfflineRuntimeMode(false);
  assert.equal(isOfflineRuntimeForced(), false);
});

test('gravação operacional só é forçada para a fila durante indisponibilidade real', () => {
  setOfflineRuntimeMode(false);
  assert.equal(shouldQueueOfflineOperationalWrite({online: true, sessionOffline: false}), false);
  assert.equal(shouldQueueOfflineOperationalWrite({online: false, sessionOffline: false}), true);
  assert.equal(shouldQueueOfflineOperationalWrite({online: true, sessionOffline: true}), true);
  setOfflineRuntimeMode(true);
  assert.equal(shouldQueueOfflineOperationalWrite({online: true, sessionOffline: false}), true);
  setOfflineRuntimeMode(false);
});
