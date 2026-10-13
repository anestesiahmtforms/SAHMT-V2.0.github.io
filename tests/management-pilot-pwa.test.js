import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {managementPilotPwaConfig, managementPilotManifest, managementPilotServiceWorker,
  managementPilotAssetsConfig, validateManagementPilotFirebaseConfig} from '../scripts/lib/management-pilot-pwa.js';
const endpoint = 'https://auth.example.invalid/v1/management/session';
test('isolated build is off by default and never enables first login or classification', () => {
  for (const enabled of [false, true]) {
    const flags = managementPilotPwaConfig({endpoint, enabled});
    assert.equal(flags.VITE_FIREBASE_PROJECT_AUTH_ENABLED, String(enabled));
    assert.equal(flags.VITE_FIREBASE_PROJECT_AUTH_AUTO_CONNECT_ENABLED, String(enabled));
    assert.equal(flags.VITE_MANAGEMENT_FIREBASE_ENABLED, String(enabled));
    assert.equal(flags.VITE_INDICATORS_FIREBASE_ENABLED, String(enabled));
    assert.equal(flags.VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN, 'https://auth.example.invalid');
    assert.equal(flags.VITE_MANAGEMENT_FA_FIRST_LOGIN_ENABLED, 'false');
    assert.equal(flags.VITE_MANAGEMENT_FIRST_LOGIN_COHORT_ADMIN_ENABLED, 'false');
    assert.equal(flags.VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS, 'true');
    assert.equal(Object.keys(flags).some(name => /UID|HMAC|SECRET/.test(name)), false);
  }
  assert.equal(managementPilotPwaConfig({endpoint}).VITE_FIREBASE_PROJECT_AUTH_ENABLED, 'false');
});
test('build rejects HTTP, credentials, wrong route and query secrets', () => {
  for (const value of ['', endpoint.replace('https:', 'http:'), endpoint + '?secret=private', endpoint + '#x',
    endpoint.replace('auth.', 'a:b@auth.'), 'https://auth.example.invalid/'])
    assert.throws(() => managementPilotPwaConfig({endpoint: value}), /PILOT_ENDPOINT_INVALID/);
});
test('manifest and service worker affect only isolated output path and caches', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url)));
  const result = managementPilotManifest(manifest);
  assert.equal(result.scope, '/'); assert.equal(result.start_url, '/');
  assert.equal(manifest.scope, '/SAHMT-V2.0.github.io/');
  assert.ok(result.icons.every(icon => icon.src.startsWith('/assets/')));
  const source = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');
  const sw = managementPilotServiceWorker(source);
  assert.ok(sw.includes("const BASE = '/';"));
  assert.equal(sw.includes('sahmt-v2-'), false);
  assert.ok(sw.includes("key.startsWith('sahmt-auth-pilot-')"));
  assert.ok(source.includes("const BASE = '/SAHMT-V2.0.github.io/';"));
  assert.throws(() => managementPilotServiceWorker('new unknown source'), /PILOT_SERVICE_WORKER_LAYOUT_CHANGED/);
});
test('assets deployment has a dedicated name and no production bindings', () => {
  assert.deepEqual(managementPilotAssetsConfig(), {name: 'sahmt-auth-pilot', compatibility_date: '2026-10-10', workers_dev: true,
    assets: {directory: './dist', not_found_handling: 'single-page-application'}});
});

test('build validates public FB/FC config and fails closed on missing or mismatched project', () => {
  const env = {};
  for (const [prefix, projectId] of [['MANAGEMENT', 'sahmt-gestao-5ae66'], ['INDICATORS', 'indicadores---sahmt']]) {
    env['VITE_' + prefix + '_FIREBASE_PROJECT_ID'] = projectId;
    env['VITE_' + prefix + '_FIREBASE_AUTH_DOMAIN'] = projectId + '.firebaseapp.com';
    env['VITE_' + prefix + '_FIREBASE_API_KEY'] = 'AIza' + 'x'.repeat(35);
    env['VITE_' + prefix + '_FIREBASE_APP_ID'] = '1:123456:web:abcdef';
  }
  assert.equal(validateManagementPilotFirebaseConfig(env), true);
  for (const key of Object.keys(env)) {
    const missing = {...env}; delete missing[key];
    assert.throws(() => validateManagementPilotFirebaseConfig(missing), /PILOT_FIREBASE_CONFIG_INVALID/);
  }
  assert.throws(() => validateManagementPilotFirebaseConfig({...env, VITE_INDICATORS_FIREBASE_PROJECT_ID: 'sahmt-17a16'}), /PILOT_FIREBASE_CONFIG_INVALID/);
});
