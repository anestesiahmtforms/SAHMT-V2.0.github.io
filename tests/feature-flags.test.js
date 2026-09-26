import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_APP_FEATURES, featureEnabledForRoute, normalizeAppFeatures} from '../src/feature-flags.js';

test('flags padrão mantêm módulos publicados ativos e ESG/Inovação inativos', () => {
  assert.deepEqual(DEFAULT_APP_FEATURES, {
    checklist: true,
    labels: true,
    trainings: true,
    management: true,
    notifications: true,
    esg: false,
    innovation: false
  });
});

test('normaliza apenas valores booleanos reconhecidos sem alterar os padrões restantes', () => {
  assert.deepEqual(normalizeAppFeatures({checklist: false, labels: 0, esg: true, unknown: false}), {
    checklist: false,
    labels: true,
    trainings: true,
    management: true,
    notifications: true,
    esg: true,
    innovation: false
  });
  assert.deepEqual(normalizeAppFeatures(null), DEFAULT_APP_FEATURES);
});

test('mapeia flags aos caminhos de módulos e deixa rotas fixas inalteradas', () => {
  const features = {...DEFAULT_APP_FEATURES, checklist: false, labels: false, trainings: false, management: false, notifications: false};
  for (const route of ['checklist', 'labels', 'training', 'management', 'notifications']) {
    assert.equal(featureEnabledForRoute(route, features), false, `${route} deve obedecer à flag correspondente`);
  }
  for (const route of ['home', 'events', 'people', 'admin', 'offline', 'unknown']) {
    assert.equal(featureEnabledForRoute(route, features), true, `${route} não possui feature flag`);
  }
});
