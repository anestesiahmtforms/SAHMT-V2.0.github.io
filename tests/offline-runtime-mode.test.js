import test from 'node:test';
import assert from 'node:assert/strict';
import {isOfflineRuntimeForced, setOfflineRuntimeMode} from '../src/offline-runtime-mode.js';

test('offline runtime pode ser ativado pelo estado de sessão e depois reaberto após validação online', () => {
  setOfflineRuntimeMode(true);
  assert.equal(isOfflineRuntimeForced(), true);
  setOfflineRuntimeMode(false);
  assert.equal(isOfflineRuntimeForced(), false);
});
