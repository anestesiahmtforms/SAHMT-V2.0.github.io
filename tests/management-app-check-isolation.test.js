import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/firebase-app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replaceAll('import.meta.env', 'env')
  .replace("import('firebase/app-check')", 'loadAppCheck()')
  .replaceAll('export ', '');

async function initialize(target, values = {}) {
  const projectId = target === 'FB' ? 'sahmt-gestao-5ae66' : 'sahmt-17a16';
  const calls = [];
  const context = vm.createContext({
    env: {VITE_APP_CHECK_SITE_KEY: 'public-fa-site-key', ...values},
    firebaseConfig: {projectId, apiKey: 'public-key', authDomain: projectId + '.firebaseapp.com', appId: 'web-app'},
    deployment: {target, projectId, appName: target},
    getApps: () => [], initializeApp: options => ({options}),
    withAppCheckTokenDeadline: action => action(),
    loadAppCheck: async () => {
      calls.push('load');
      return {
        ReCaptchaEnterpriseProvider: class {constructor(key) {this.key = key;}},
        initializeAppCheck: (app, options) => {calls.push({projectId: app.options.projectId, key: options.provider.key}); return {app};}
      };
    }
  });
  vm.runInContext(source + '\nthis.ready = appCheckReady;', context);
  return {value: await context.ready, calls};
}

for (const flag of ['VITE_FI_ADMIN_ENABLED', 'VITE_FI_PILOT_ENABLED']) {
  test(`FB restores its session without inheriting the FA App Check key when ${flag} is enabled`, async () => {
    const result = await initialize('FB', {[flag]: 'true', VITE_LABEL_AI_ENABLED: 'false'});
    assert.equal(result.value, null);
    assert.deepEqual(result.calls, []);
  });
  test(`FA still initializes attestation for ${flag}`, async () => {
    const result = await initialize('FA', {[flag]: 'true'});
    assert.ok(result.value);
    assert.equal(result.calls[1].projectId, 'sahmt-17a16');
    assert.equal(result.calls[1].key, 'public-fa-site-key');
  });
}

test('FA label AI retains its attestation requirement', async () => {
  assert.ok((await initialize('FA', {VITE_LABEL_AI_ENABLED: 'true'})).value);
});

test('disabled features, absent key and development emulators do not initialize App Check', async () => {
  for (const values of [{}, {VITE_FI_ADMIN_ENABLED: 'true', VITE_APP_CHECK_SITE_KEY: ''},
    {VITE_FI_ADMIN_ENABLED: 'true', DEV: true, VITE_USE_FIREBASE_EMULATORS: 'true'}]) {
    const result = await initialize('FA', values);
    assert.equal(result.value, null);
    assert.deepEqual(result.calls, []);
  }
});
