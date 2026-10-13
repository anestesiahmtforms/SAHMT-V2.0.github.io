import test from 'node:test';
import assert from 'node:assert/strict';
import {FIREBASE_PROJECTS, normalizeFirebaseWebConfig, resolveFirebaseProjectApp} from '../src/firebase-projects.js';

const fcConfig = Object.freeze({apiKey: 'synthetic-public-key', authDomain: 'indicadores---sahmt.firebaseapp.com',
  projectId: 'indicadores---sahmt', storageBucket: 'indicadores---sahmt.firebasestorage.app',
  messagingSenderId: '123456789012', appId: '1:123456789012:web:abcdef0123456789'});

test('central registry keeps FA, FB, and reserved FC on separate named Firebase apps', () => {
  assert.deepEqual(Object.keys(FIREBASE_PROJECTS), ['FA', 'FB', 'FC']);
  assert.deepEqual(Object.values(FIREBASE_PROJECTS).map(value => value.databaseId), ['(default)', '(default)', '(default)']);
  assert.equal(new Set(Object.values(FIREBASE_PROJECTS).map(value => value.projectId)).size, 3);
  assert.equal(new Set(Object.values(FIREBASE_PROJECTS).map(value => value.appName)).size, 3);
  assert.equal(FIREBASE_PROJECTS.FC.projectId, 'indicadores---sahmt');
});

test('FC web configuration accepts only the reserved project and a complete registered app config', () => {
  const normalized = normalizeFirebaseWebConfig(fcConfig, 'FC');
  assert.equal(normalized.valid, true);
  assert.equal(normalized.projectId, FIREBASE_PROJECTS.FC.projectId);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(normalizeFirebaseWebConfig({...fcConfig, projectId: FIREBASE_PROJECTS.FB.projectId}, 'FC').valid, false);
  assert.equal(normalizeFirebaseWebConfig({...fcConfig, authDomain: 'other.firebaseapp.com'}, 'FC').valid, false);
  assert.equal(normalizeFirebaseWebConfig({...fcConfig, appId: ''}, 'FC').valid, false);
  assert.throws(() => normalizeFirebaseWebConfig(fcConfig, 'UNKNOWN'), /FIREBASE_PROJECT_TARGET_INVALID/);
});

test('disabled target never initializes and leaves existing project apps untouched', () => {
  const calls = [];
  const app = resolveFirebaseProjectApp({target: 'FC', enabled: false, config: normalizeFirebaseWebConfig(fcConfig, 'FC'),
    getApps: () => [], initializeApp: (...args) => { calls.push(args); }});
  assert.equal(app, null);
  assert.equal(calls.length, 0);
});

test('enabled target initializes/reuses only the exact named project instance', () => {
  const config = normalizeFirebaseWebConfig(fcConfig, 'FC'), calls = [];
  const created = {name: FIREBASE_PROJECTS.FC.appName, options: config};
  const initializeApp = (...args) => { calls.push(args); return created; };
  assert.equal(resolveFirebaseProjectApp({target: 'FC', enabled: true, config, getApps: () => [], initializeApp}), created);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], FIREBASE_PROJECTS.FC.appName);
  assert.equal(resolveFirebaseProjectApp({target: 'FC', enabled: true, config, getApps: () => [created], initializeApp}), created);
  assert.equal(calls.length, 1);
  assert.throws(() => resolveFirebaseProjectApp({target: 'FC', enabled: true, config: {...config, valid: false},
    getApps: () => [], initializeApp}), /FIREBASE_PROJECT_CONFIG_INVALID/);
  assert.throws(() => resolveFirebaseProjectApp({target: 'FC', enabled: true, config,
    getApps: () => [{name: FIREBASE_PROJECTS.FC.appName, options: {...config, projectId: FIREBASE_PROJECTS.FA.projectId}}], initializeApp}),
    /FIREBASE_PROJECT_INSTANCE_MISMATCH/);
});
