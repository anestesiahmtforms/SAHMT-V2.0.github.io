import test from 'node:test';
import assert from 'node:assert/strict';
import {getIndicatorsApp, getIndicatorsAuth, getIndicatorsFirestore} from '../src/indicators-firebase-app.js';
import {indicatorsFirebaseConfig, indicatorsFirebaseEnabled} from '../src/indicators-firebase-config.js';

test('reserved FC app is hard-disabled and missing web config cannot initialize Firebase', () => {
  assert.equal(indicatorsFirebaseEnabled, false);
  assert.equal(indicatorsFirebaseConfig.projectId, 'indicadores---sahmt');
  assert.equal(indicatorsFirebaseConfig.valid, false);
  assert.equal(getIndicatorsApp(), null);
  assert.equal(getIndicatorsAuth(), null);
  assert.equal(getIndicatorsFirestore(), null);
});
