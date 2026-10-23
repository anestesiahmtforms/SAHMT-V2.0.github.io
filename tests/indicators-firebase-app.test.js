import test from 'node:test';
import assert from 'node:assert/strict';
import {getIndicatorsApp, getIndicatorsAuth, getIndicatorsFirestore} from '../src/indicators-firebase-app.js';
import {indicatorsFirebaseConfig, indicatorsFirebaseEnabled} from '../src/indicators-firebase-config.js';

test('FC app has the verified web configuration but stays disabled unless the release build enables it', () => {
  assert.equal(indicatorsFirebaseEnabled, false);
  assert.equal(indicatorsFirebaseConfig.projectId, 'indicadores---sahmt');
  assert.equal(indicatorsFirebaseConfig.valid, true);
  assert.equal(getIndicatorsApp(), null);
  assert.equal(getIndicatorsAuth(), null);
  assert.equal(getIndicatorsFirestore(), null);
});
