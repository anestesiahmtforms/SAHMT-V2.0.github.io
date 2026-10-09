import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFbBootstrapReadBudget, fbBootstrapScopeSha256, fbBootstrapCaptureConfiguration,
  finishFbBootstrapReadBudget} from '../scripts/lib/management-fb-bootstrap-budget.js';
import {captureFirestoreSnapshot} from '../scripts/lib/firestore-snapshot-capture.js';
import {firestoreQuotaDayStart} from '../scripts/lib/management-read-budget.js';

const FB = 'sahmt-gestao-5ae66', FA = 'sahmt-17a16';
const NOW = Date.parse('2026-10-09T01:00:00.000Z');
const scope = {schemaVersion: 1, projectId: FB, databaseId: '(default)', rootCollections: ['users', 'documents']};
function policy(overrides = {}) {
  return {schemaVersion: 1, mode: 'FB_INITIAL_BACKUP_WITHOUT_COMPLETE_METRIC', projectId: FB,
    databaseId: '(default)', authorizedPurpose: 'MANAGEMENT_INITIAL_FB_BACKUP_ONLY',
    authorizationSource: 'EXPLICIT_HUMAN_CONTINUE_FB', authorizationId: 'a'.repeat(32),
    scopeSha256: fbBootstrapScopeSha256(scope), totalUsageKnown: false,
    observationSource: 'NO_COMPLETE_CURRENT_OBSERVATION', exactGlobalCutoff: false,
    renewalClearsPause: false, pausedRequiresReview: false, status: 'AUTHORIZED',
    humanDecisionAt: new Date(NOW - 1000).toISOString(), authorizedUntil: new Date(NOW + 600000).toISOString(),
    captureStartedAt: new Date(NOW).toISOString(), captureReadTime: new Date(NOW - 5000).toISOString(),
    quotaDayStart: firestoreQuotaDayStart(NOW), maximumReservedReads: 250,
    reservedReads: 0, reservationAttempts: 0, ...overrides};
}
function assess(value = policy(), overrides = {}) {
  return assessFbBootstrapReadBudget({projectId: FB, scope, policy: value, nowMs: NOW, ...overrides});
}
const reservation = (value = policy(), overrides = {}) => ({projectId: FB, databaseId: '(default)',
  readTime: value.captureReadTime, operation: 'listDocuments', maximumReads: 1,
  attempt: value.reservationAttempts + 1, requestSha256: 'b'.repeat(64), ...overrides});

test('preflight has unknown global usage; no zero measurement is fabricated', () => {
  const value = policy(), before = JSON.stringify(value), result = assess(value);
  assert.equal(result.allowed, true); assert.equal(result.measuredTotalReads, null);
  assert.equal(result.totalUsageKnown, false); assert.equal(result.exactGlobalCutoff, false);
  assert.equal(result.localReservationOnly, true); assert.equal(result.reservedReads, 0);
  assert.equal(JSON.stringify(value), before);
});
test('FA is rejected rather than inheriting or weakening its pause', () => {
  assert.throws(() => assess(policy(), {projectId: FA}), {code: 'FB_BOOTSTRAP_PROJECT_OR_CLOCK_INVALID'});
  assert.throws(() => fbBootstrapScopeSha256({...scope, projectId: FA}), {code: 'FB_BOOTSTRAP_SCOPE_INVALID'});
});
test('scope digest is order invariant and changing root trees is denied', () => {
  assert.equal(fbBootstrapScopeSha256(scope), fbBootstrapScopeSha256({...scope, rootCollections: [...scope.rootCollections].reverse()}));
  assert.throws(() => assess(policy(), {scope: {...scope, rootCollections: ['users']}}), {code: 'FB_BOOTSTRAP_EXPLICIT_AUTHORIZATION_REQUIRED'});
});
test('explicit bootstrap purpose, source and unknown observation are required', async t => {
  for (const override of [{authorizedPurpose: 'MANAGEMENT_BACKUP_ONLY'}, {authorizationSource: 'RENEWAL'},
    {totalUsageKnown: true}, {observationSource: 'STALE_METRIC'}, {exactGlobalCutoff: true},
    {renewalClearsPause: true}, {authorizationId: 'arbitrary'}]) await t.test(JSON.stringify(override), () => {
    assert.throws(() => assess(policy(override)), {code: 'FB_BOOTSTRAP_EXPLICIT_AUTHORIZATION_REQUIRED'});
  });
});
test('closed or paused FB authorization is never implicitly rearmed', async t => {
  for (const override of [{pausedRequiresReview: true}, {status: 'COMPLETE'}, {status: 'INCOMPLETE'}])
    await t.test(JSON.stringify(override), () => assert.throws(() => assess(policy(override)), {code: 'FB_BOOTSTRAP_CLOSED_OR_PAUSED'}));
});
test('deadline, runtime duration, day and future start fail closed', async t => {
  for (const override of [{authorizedUntil: new Date(NOW).toISOString()},
    {authorizedUntil: new Date(NOW + 900001).toISOString()},
    {captureStartedAt: new Date(NOW - 120000).toISOString(), humanDecisionAt: new Date(NOW - 120001).toISOString()},
    {quotaDayStart: '2026-10-07T07:00:00.000Z'}, {captureStartedAt: new Date(NOW + 1).toISOString()}])
    await t.test(JSON.stringify(override), () => assert.throws(() => assess(policy(override)), {code: 'FB_BOOTSTRAP_AUTHORIZATION_OR_DAY_EXPIRED'}));
});
test('readTime cannot change, exceed start or be too old', async t => {
  for (const captureReadTime of [new Date(NOW + 1).toISOString(), new Date(NOW - 10001).toISOString()])
    await t.test(captureReadTime, () => assert.throws(() => assess(policy({captureReadTime})), {code: 'FB_BOOTSTRAP_FIXED_READ_TIME_INVALID'}));
  const value = policy(); assert.throws(() => assess(value, {reservation: reservation(value, {readTime: new Date(NOW).toISOString()})}), {code: 'FB_BOOTSTRAP_RESERVATION_INVALID'});
});
test('reserve creates nextPolicy only, with debit before each attempt and no refund', () => {
  const value = policy(), before = JSON.stringify(value);
  const result = assess(value, {reservation: reservation(value)});
  assert.equal(result.nextPolicy.reservedReads, 1); assert.equal(result.nextPolicy.reservationAttempts, 1);
  assert.equal(result.nextPolicy.status, 'IN_PROGRESS'); assert.equal(JSON.stringify(value), before);
  const next = assess(result.nextPolicy, {reservation: reservation(result.nextPolicy, {operation: 'listCollectionIds'})});
  assert.equal(next.nextPolicy.reservedReads, 2);
});
test('reserve cap and state corruption cannot reset allowance', async t => {
  assert.throws(() => assess(policy({reservedReads: 250, reservationAttempts: 250}),
    {reservation: reservation(policy({reservedReads: 250, reservationAttempts: 250}))}), {code: 'FB_BOOTSTRAP_LOCAL_RESERVE_EXHAUSTED'});
  for (const override of [{reservedReads: -1}, {reservedReads: 251, reservationAttempts: 251},
    {reservedReads: 1, reservationAttempts: 0}, {maximumReservedReads: 1000}]) await t.test(JSON.stringify(override), () => {
    assert.throws(() => assess(policy(override)), {code: 'FB_BOOTSTRAP_RESERVATION_STATE_INVALID'});
  });
});
test('request amount, sequence, project and method are confined', async t => {
  const value = policy();
  for (const override of [{maximumReads: 100}, {attempt: 0}, {attempt: 2}, {projectId: FA},
    {databaseId: 'other'}, {operation: 'commit'}, {requestSha256: 'missing'}]) await t.test(JSON.stringify(override), () => {
    assert.throws(() => assess(value, {reservation: reservation(value, override)}), {code: 'FB_BOOTSTRAP_RESERVATION_INVALID'});
  });
});
test('configuration fixes small pages and bounded core limits without adapters', () => {
  const config = fbBootstrapCaptureConfiguration({projectId: FB, scope, policy: policy(), nowMs: NOW});
  assert.equal(config.pageSize, 1); assert.equal(config.collectionPageSize, 1);
  assert.equal(config.limits.maxPages, 250); assert.equal(config.limits.maxDurationMs, 120000);
  assert.equal(config.limits.maxDocuments, 100); assert.equal(config.readTime, policy().captureReadTime);
  assert.equal('transport' in config, false); assert.equal('credentials' in config, false);
});
test('terminal transitions preserve debits after expiry and consume authorization', () => {
  const value = policy({reservedReads: 12, reservationAttempts: 12, status: 'IN_PROGRESS'});
  for (const status of ['COMPLETE', 'INCOMPLETE']) {
    const finished = finishFbBootstrapReadBudget({projectId: FB, policy: value, nowMs: NOW + 1000000, status});
    assert.equal(finished.reservedReads, 12); assert.equal(finished.pausedRequiresReview, true);
    assert.throws(() => assess(finished), {code: 'FB_BOOTSTRAP_CLOSED_OR_PAUSED'});
    assert.throws(() => finishFbBootstrapReadBudget({projectId: FB, policy: finished, nowMs: NOW, status}), {code: 'FB_BOOTSTRAP_TERMINAL_TRANSITION_INVALID'});
  }
});
test('synthetic empty selected roots complete with one reservation per request', async () => {
  let value = policy(), credentialLookups = 0, calls = 0;
  const result = await captureFirestoreSnapshot({...fbBootstrapCaptureConfiguration({projectId: FB, scope, policy: value, nowMs: NOW}),
    clock: () => NOW, checkpoint: async () => {},
    reserveReads: async request => { const decision = assess(value, {reservation: request}); value = decision.nextPolicy; return decision; },
    transport: async request => { calls++; assert.equal(value.reservedReads, calls); assert.equal(request.query.showMissing, true); return {documents: []}; }});
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.snapshot.documents.length, 0);
  assert.equal(value.reservedReads, scope.rootCollections.length); assert.equal(credentialLookups, 0);
});
test('synthetic orphan tree is included under the same readTime and reservations', async () => {
  const tinyScope = {...scope, rootCollections: ['documents']};
  let value = policy({scopeSha256: fbBootstrapScopeSha256(tinyScope)}), calls = 0;
  const config = fbBootstrapCaptureConfiguration({projectId: FB, scope: tinyScope, policy: value, nowMs: NOW});
  const base = 'projects/' + FB + '/databases/(default)/documents/';
  const result = await captureFirestoreSnapshot({...config, clock: () => NOW, checkpoint: async () => {},
    reserveReads: async request => { const decision = assessFbBootstrapReadBudget({projectId: FB, scope: tinyScope, policy: value, nowMs: NOW, reservation: request}); value = decision.nextPolicy; return decision; },
    transport: async request => { calls++; assert.equal(value.reservedReads, calls);
      assert.equal((request.query || request.body).readTime, config.readTime);
      if (request.operation === 'listDocuments' && request.collectionId === 'documents') return {documents: [{name: base + 'documents/missing'}]};
      if (request.operation === 'listCollectionIds' && request.parent.endsWith('/documents/missing')) return {collectionIds: ['versions']};
      if (request.operation === 'listDocuments') return {documents: [{name: base + 'documents/missing/versions/v1', fields: {}, createTime: '2026-10-08T23:00:00.000Z', updateTime: '2026-10-08T23:00:00.000Z'}]};
      return {collectionIds: []}; }});
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.snapshot.documents.length, 1);
  assert.equal(result.receipt.counts.missingParents, 1); assert.equal(value.reservedReads, 4);
});

test('preflight denies started authorization before any credential or API adapter', () => {
  assert.throws(() => assess(policy({status: 'IN_PROGRESS', reservedReads: 1, reservationAttempts: 1})),
    {code: 'FB_BOOTSTRAP_ALREADY_STARTED_REQUIRES_REVIEW'});
  assert.throws(() => assess(policy({reservedReads: 250, reservationAttempts: 250})),
    {code: 'FB_BOOTSTRAP_ALREADY_STARTED_REQUIRES_REVIEW'});
});
test('transport failure retains reservation and never produces usable snapshot', async () => {
  let value = policy(), calls = 0;
  const result = await captureFirestoreSnapshot({...fbBootstrapCaptureConfiguration({projectId: FB, scope, policy: value, nowMs: NOW}),
    clock: () => NOW, checkpoint: async () => {},
    reserveReads: async request => { const decision = assess(value, {reservation: request}); value = decision.nextPolicy; return decision; },
    transport: async () => { calls++; throw Error('synthetic transport failure'); }});
  assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.snapshot, null);
  assert.equal(value.reservedReads, 1); assert.equal(calls, 1);
  const terminal = finishFbBootstrapReadBudget({projectId: FB, policy: value, nowMs: NOW, status: result.status});
  assert.equal(terminal.reservedReads, 1); assert.equal(terminal.pausedRequiresReview, true);
});
test('earlier human decision may authorize one newly prepared fixed window without faking its timestamp', () => {
  const result = assess(policy({humanDecisionAt: new Date(NOW - 3600000).toISOString()}));
  assert.equal(result.allowed, true); assert.equal(result.measuredTotalReads, null);
});