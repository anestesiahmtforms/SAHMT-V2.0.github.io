import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeManagementFirebaseConfig} from '../src/management-firebase-config.js';

const config = {
  apiKey: 'public-key',
  authDomain: 'sahmt-gestao-5ae66.firebaseapp.com',
  projectId: 'sahmt-gestao-5ae66',
  storageBucket: 'sahmt-gestao-5ae66.firebasestorage.app',
  messagingSenderId: '613953519880',
  appId: '1:613953519880:web:63b48dfa78ffd1f7ef6cbd'
};

test('normaliza e valida somente o projeto FB aprovado', () => {
  const result = normalizeManagementFirebaseConfig(config);
  assert.equal(result.valid, true);
  assert.equal(result.projectId, config.projectId);
  assert.equal(Object.isFrozen(result), true);
});

test('rejeita projeto ou configuração incompleta', () => {
  assert.equal(normalizeManagementFirebaseConfig({...config, projectId: 'sahmt-17a16'}).valid, false);
  assert.equal(normalizeManagementFirebaseConfig({...config, appId: ''}).valid, false);
  assert.equal(normalizeManagementFirebaseConfig({}).valid, false);
});
