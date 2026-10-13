import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementGoogleLogin} from '../src/management-google-login.js';
import {managementFaFirstLoginConfig} from '../src/management-fa-first-login-config.js';

test('first-login client config is disabled and empty by default', () => {
  assert.deepEqual(managementFaFirstLoginConfig, {enabled: false, endpoint: '', googleClientId: '', allowedBrokerOrigin: ''});
});

test('disabled first-login flag preserves the existing popup flow exactly', async () => {
  const calls = [];
  const login = createManagementGoogleLogin({enabled: false,
    firstLogin: {signIn: async () => calls.push('special')},
    popupSignIn: async () => { calls.push('popup'); return 'popup-result'; }});
  assert.equal(await login.signIn(), 'popup-result');
  assert.deepEqual(calls, ['popup']);
});

test('enabled first-login flow returns the UID-preserving link result without popup', async () => {
  const calls = [];
  const login = createManagementGoogleLogin({enabled: true,
    firstLogin: {signIn: async () => { calls.push('first-login'); return {ok: true, status: 'FIRST_LOGIN_LINKED'}; }},
    popupSignIn: async () => { calls.push('popup'); }});
  assert.deepEqual(await login.signIn(), {ok: true, status: 'FIRST_LOGIN_LINKED'});
  assert.deepEqual(calls, ['first-login']);
});

test('only the server-confirmed already-linked result falls back to the current popup', async () => {
  const calls = [];
  const login = createManagementGoogleLogin({enabled: true,
    firstLogin: {signIn: async () => ({ok: false, code: 'USE_EXISTING_SIGN_IN_GOOGLE_POPUP'})},
    popupSignIn: async () => { calls.push('popup'); return 'existing-login'; }});
  assert.equal(await login.signIn(), 'existing-login');
  assert.deepEqual(calls, ['popup']);
});

test('denials and broker failures never fall through to popup account creation', async () => {
  for (const result of [{ok: false, code: 'FA_PROFILE_NOT_AUTHORIZED'}, {ok: false, code: 'FIRST_LOGIN_FAILED'}]) {
    let popupCalls = 0;
    const login = createManagementGoogleLogin({enabled: true,
      firstLogin: {signIn: async () => result},
      popupSignIn: async () => { popupCalls++; }});
    await assert.rejects(login.signIn(), error => error.code === result.code);
    assert.equal(popupCalls, 0);
  }
});

test('a missing first-login flow fails closed when the flag is enabled', () => {
  assert.throws(() => createManagementGoogleLogin({enabled: true, popupSignIn: async () => {}}),
    /FIRST_LOGIN_CONFIG_INVALID/);
});
