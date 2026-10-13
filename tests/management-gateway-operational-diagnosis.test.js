import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './helpers/gateway-vm.js';

// All calls stay in the Apps Script VM and its synthetic UrlFetchApp fixture.
// In particular, an access token returned by ScriptApp is an opaque value.
test('operational Auth lookups accept opaque server OAuth tokens containing two periods', async t => {
  for (const operation of ['AUTH_USER_LOOKUP_FA', 'AUTH_USER_LOOKUP_FB', 'AUTH_USER_LOOKUP_FC']) {
    await t.test(operation, () => {
      const h = harness();
      h.state.oauthValue = 'opaque.access.value';
      const request = h.rawRequest(operation);
      const response = h.call(request);
      assert.equal(response.status, 'SUCCESS');
      assert.equal(h.protocol().verifyResponse(response, request).body.users[0].localId, 'member-a');
      assert.equal(h.state.googleCalls.length, 1);
      assert.equal(h.state.googleCalls[0].options.headers.Authorization, 'Bearer opaque.access.value');
      assert.equal(JSON.stringify(response).includes(h.state.oauthValue), false);
      assert.equal(JSON.stringify(h.state.executionLogs).includes(h.state.oauthValue), false);
    });
  }
});

test('synthetic IAM proofs also accept opaque server OAuth values containing two periods', async t => {
  for (const project of ['Fa', 'Fb', 'Fc']) {
    await t.test(project, () => {
      const h = harness({withoutProperties: true});
      h.state.oauthValue = 'opaque.access.value';
      const response = h.context['provarAssinaturaIam' + project + 'SinteticaV1']();
      assert.equal(response.code, project.toUpperCase() + '_IAM_SIGNJWT_SYNTHETIC_PROOF_OK');
      assert.equal(response.httpStatus, 200);
      assert.equal(h.state.googleCalls.length, 1);
      assert.equal(JSON.stringify(h.state.executionLogs).includes(h.state.oauthValue), false);
    });
  }
});

test('Auth lookup defaults an omitted emailVerified field to false without claiming verification', async t => {
  for (const operation of ['AUTH_USER_LOOKUP_FA', 'AUTH_USER_LOOKUP_FB', 'AUTH_USER_LOOKUP_FC']) {
    await t.test(operation, () => {
      const h = harness();
      delete h.state.user.emailVerified;
      const request = h.rawRequest(operation);
      const response = h.call(request);
      assert.equal(response.status, 'SUCCESS');
      const user = h.protocol().verifyResponse(response, request).body.users[0];
      assert.equal(user.emailVerified, false);
      assert.equal(user.localId, 'member-a');
    });
  }
});

test('Auth lookup continues rejecting nonboolean emailVerified fields', async t => {
  for (const value of [null, 'true', 1, {}, []]) {
    await t.test(typeof value + ':' + JSON.stringify(value), () => {
      const h = harness();
      h.state.user.emailVerified = value;
      const response = h.call(h.rawRequest('AUTH_USER_LOOKUP_FC'));
      assert.equal(response.status, 'DENIED');
      assert.equal(response.code, 'GATEWAY_RESULT_INVALID');
    });
  }
});

test('missing FA protected identities fails closed before lookup but does not disable destination lookups', () => {
  const fa = harness({withoutIdentityPolicy: true});
  const response = fa.call(fa.rawRequest('AUTH_USER_LOOKUP_FA'));
  assert.equal(response.status, 'DENIED');
  assert.equal(response.code, 'GATEWAY_OPERATION_FAILED');
  assert.equal(fa.state.googleCalls.length, 0);
  for (const operation of ['AUTH_USER_LOOKUP_FB', 'AUTH_USER_LOOKUP_FC']) {
    const destination = harness({withoutIdentityPolicy: true});
    assert.equal(destination.call(destination.rawRequest(operation)).status, 'SUCCESS');
    assert.equal(destination.state.googleCalls.length, 1);
  }
});

test('authentication HTTP failure remains distinguishable from prior successful synthetic IAM proof', () => {
  const h = harness();
  assert.equal(h.context.provarAssinaturaIamFaSinteticaV1().httpStatus, 200);
  h.state.responseOverride = (_url, _options, reply) => reply({error: {
    status: 'PERMISSION_DENIED', message: 'private-email@example.invalid private-uid opaque.access.value',
    details: [{secret: 'must-not-be-logged'}]
  }}, {status: 403});
  const response = h.call(h.rawRequest('AUTH_USER_LOOKUP_FB'));
  assert.equal(response.status, 'DENIED');
  assert.equal(response.code, 'GATEWAY_OPERATION_FAILED');
  const publicOutput = JSON.stringify({response, logs: h.state.executionLogs});
  for (const marker of ['private-email', 'private-uid', 'opaque.access.value', 'must-not-be-logged']) {
    assert.equal(publicOutput.includes(marker), false);
  }
});

test('OAuth retrieval and fetch exceptions never disclose exception messages', async t => {
  for (const stage of ['oauth', 'fetch']) {
    await t.test(stage, () => {
      const h = harness();
      const fail = () => { throw new Error('private-email@example.invalid private-uid opaque.access.value'); };
      if (stage === 'oauth') h.context.ScriptApp.getOAuthToken = fail;
      else h.state.responseOverride = fail;
      const response = h.call(h.rawRequest('AUTH_USER_LOOKUP_FB'));
      assert.equal(response.status, 'DENIED');
      assert.equal(response.code, 'GATEWAY_OPERATION_FAILED');
      const publicOutput = JSON.stringify({response, logs: h.state.executionLogs});
      for (const marker of ['private-email', 'private-uid', 'opaque.access.value']) assert.equal(publicOutput.includes(marker), false);
    });
  }
});

test('private deployment policy is accepted only from trusted server code and never replaces a property', () => {
  const reference = harness().values.get('SAHMT_FA_PROTECTED_IDENTITIES_JSON');
  const h = harness({withoutIdentityPolicy: true});
  h.context.mgwDeploymentProtectedIdentityPolicyJson_ = () => reference;
  assert.equal(h.call(h.rawRequest()).status, 'SUCCESS');
  assert.equal(h.state.propertyWrites.includes('SAHMT_FA_PROTECTED_IDENTITIES_JSON'), false);
  h.values.set('SAHMT_FA_PROTECTED_IDENTITIES_JSON', '');
  assert.equal(h.call(h.rawRequest()).code, 'GATEWAY_OPERATION_FAILED');
  h.values.delete('SAHMT_FA_PROTECTED_IDENTITIES_JSON');
  h.context.mgwDeploymentProtectedIdentityPolicyJson_ = () => '{}';
  assert.equal(h.call(h.rawRequest()).code, 'GATEWAY_OPERATION_FAILED');
});
