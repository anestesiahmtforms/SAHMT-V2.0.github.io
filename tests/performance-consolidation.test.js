import test from 'node:test';
import assert from 'node:assert/strict';
import {Timestamp} from 'firebase/firestore';
import {consolidatePerformance} from '../src/performance-consolidation.js';

const fa = 'sahmt-fa-fixture', fb = 'sahmt-fb-fixture';
const confirmed = {complete: true, fromCache: false, pendingWrites: false, hasMore: false};
const member = (id = 'member-a') => ({memberId: id, faUid: `${id}-fa`, fbUid: `${id}-fb`, active: true, access: true});
const source = (projectId, awards = [], ledger = [], extra = {}) => ({projectId, status: 'ready', ...confirmed, coverage: {kind: 'team'}, awards, ledger, ...extra});
function award(extra = {}) {
  const record = {id: 'award-a', uid: 'member-a-fa', category: 'PERFORMANCE', modality: 'ACKNOWLEDGEMENT', creditScopeId: 'matter-a', activityId: 'form-a', areaId: 'area-a', version: 1, points: 1, originalPoints: 1, awardVersion: 1, adminOverride: false, sourceType: 'GOOGLE_FORM', sourceId: 'response-a', evidence: {formId: 'form-a', responseId: 'response-a'}, ...extra};
  return {...record, lastLedgerId: extra.lastLedgerId || `${record.id}-v${record.awardVersion}`};
}
function event(record, extra = {}) {
  return {id: `${record.id}-v${record.awardVersion}`, awardId: record.id, uid: record.uid, category: record.category, modality: record.modality, creditScopeId: record.creditScopeId, version: record.version, awardVersion: record.awardVersion, points: record.points, pointsBefore: 0, correctedPoints: record.points, originalPoints: record.originalPoints, correctsId: '', sourceType: record.sourceType, sourceId: record.sourceId, ...extra};
}
function input(extra = {}) {
  const record = award();
  return {faProjectId: fa, fbProjectId: fb, memberDirectory: {...confirmed, members: [member()]}, sources: [source(fa, [record], [event(record)]), source(fb)], migrationSidecars: [], scope: {kind: 'member', memberId: 'member-a'}, ...extra};
}
const sidecar = (collection, originalId, copyId) => ({sourceProjectId: fa, sourcePath: `${collection}/${originalId}`, destinationProjectId: fb, destinationPath: `${collection}/${copyId}`});
function copied(extra = {}) {
  const original = award(), copy = award({id: 'copy-a', uid: 'member-a-fb', ...extra});
  return input({sources: [source(fa, [original], [event(original)]), source(fb, [copy], [event(copy)])], migrationSidecars: [sidecar('evaluationAwards', original.id, copy.id), sidecar('evaluationLedger', event(original).id, event(copy).id)]});
}
const codes = result => result.issues.map(item => item.code);

test('an FA award and its explicit FB copy count once with both origins', () => {
  const result = consolidatePerformance(copied());
  assert.equal(result.status, 'CONFIRMED');
  assert.deepEqual(result.total, {performance: 1, governance: 0});
  assert.equal(result.awards.length, 1); assert.equal(result.ledger.length, 1);
  assert.deepEqual(result.awards[0].canonicalOrigin, {sourceProjectId: fa, sourcePath: 'evaluationAwards/award-a'});
  assert.deepEqual(result.awards[0].origins.map(item => item.projectId).sort(), [fa, fb].sort());
  assert.equal(result.teamReference, null);
});

test('equal points or equal email/name never prove migration identity', () => {
  const data = copied(); data.migrationSidecars = [];
  data.memberDirectory.members[0].email = 'same@example.invalid';
  data.memberDirectory.members[0].name = 'Same person';
  const result = consolidatePerformance(data);
  assert.equal(result.total, null); assert.equal(result.reviewRequired, true);
  assert.ok(codes(result).includes('AMBIGUOUS_CREDIT_SCOPE'));
});

test('a divergent copied award version makes the entire total unavailable', () => {
  const result = consolidatePerformance(copied({points: 2}));
  assert.equal(result.complete, false); assert.equal(result.totals, null);
  assert.ok(codes(result).includes('AWARD_VERSION_CONFLICT'));
});

test('an absent or ambiguous stable member association fails closed', () => {
  const unmapped = input(); unmapped.sources[0].awards[0].uid = 'not-mapped';
  assert.ok(codes(consolidatePerformance(unmapped)).includes('AWARD_MEMBER_NOT_MAPPED'));
  const duplicate = input(); duplicate.memberDirectory.members.push({...member('member-b'), faUid: member().faUid});
  const result = consolidatePerformance(duplicate);
  assert.equal(result.total, null); assert.ok(codes(result).includes('AMBIGUOUS_MEMBER_UID'));
});

test('error, cache, pending, pagination and incomplete sources never produce a complete total', () => {
  for (const patch of [{status: 'error'}, {status: 'unavailable'}, {fromCache: true}, {pendingWrites: true}, {hasMore: true}, {complete: false}, {complete: undefined}, {coverage: {kind: 'unknown'}}]) {
    const data = input(); Object.assign(data.sources[1], patch);
    const result = consolidatePerformance(data);
    assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.total, null);
    assert.equal(result.reviewRequired, false); assert.equal(result.sources[1].available, false);
  }
  const missing = input(); missing.sources.pop();
  assert.ok(codes(consolidatePerformance(missing)).includes('SOURCE_MISSING'));
});

test('an incomplete or inactive member directory blocks a complete result', () => {
  const data = input(); data.memberDirectory.hasMore = true;
  assert.equal(consolidatePerformance(data).total, null);
  data.memberDirectory.hasMore = false; data.memberDirectory.members[0].access = false;
  assert.ok(codes(consolidatePerformance(data)).includes('MEMBER_INACTIVE'));
});

test('a corrected FB copy preserves FA canonical scope, ledger versions and delta', () => {
  const original = award(), copy = award({id: 'copy-a', uid: 'member-a-fb', points: 3, awardVersion: 2, adminOverride: true});
  const copyV1 = award({id: copy.id, uid: copy.uid});
  const data = input({sources: [source(fa, [original], [event(original)]), source(fb, [copy], [event(copyV1), event(copy, {points: 2, pointsBefore: 1, correctedPoints: 3, correctsId: event(copyV1).id, sourceType: 'ADMIN_CORRECTION', sourceId: 'request-correction'})])], migrationSidecars: [sidecar('evaluationAwards', original.id, copy.id), sidecar('evaluationLedger', event(original).id, event(copyV1).id)]});
  const result = consolidatePerformance(data);
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.total.performance, 3);
  assert.equal(result.awards[0].originalPoints, 1); assert.equal(result.awards[0].awardVersion, 2);
  assert.deepEqual(result.ledger.map(item => [item.awardVersion, item.points]), [[1, 1], [2, 2]]);
  assert.deepEqual(result.ledger[1].canonicalOrigin, {sourceProjectId: fb, sourcePath: 'evaluationLedger/copy-a-v2'});
});

test('missing correction history, wrong predecessor or delta suppresses totals', () => {
  for (const failure of ['missing', 'predecessor', 'delta', 'pointer']) {
    const corrected = award({points: 2, awardVersion: 2});
    const initial = award();
    const latestEvent = event(corrected, {points: 1, pointsBefore: 1, correctedPoints: 2, correctsId: initial.lastLedgerId});
    const ledger = [event(initial), latestEvent];
    if (failure === 'missing') ledger.shift();
    if (failure === 'predecessor') latestEvent.correctsId = 'wrong-document';
    if (failure === 'delta') latestEvent.points = 3;
    if (failure === 'pointer') corrected.lastLedgerId = 'wrong-latest';
    const result = consolidatePerformance(input({sources: [source(fa, [corrected], ledger), source(fb)]}));
    assert.equal(result.total, null); assert.equal(result.reviewRequired, true);
  }
});

test('a copied ledger version needs proof of the original document origin', () => {
  const data = copied(); data.migrationSidecars.pop();
  const result = consolidatePerformance(data);
  assert.equal(result.total, null);
  assert.ok(codes(result).includes('LEDGER_ORIGIN_NOT_PROVEN'));
});

test('an unrelated ledger origin cannot be attached to a copied award', () => {
  const data = copied(); data.migrationSidecars[1].sourcePath = 'evaluationLedger/unrelated-v1';
  const result = consolidatePerformance(data);
  assert.equal(result.total, null); assert.ok(codes(result).includes('MIGRATION_ORIGINAL_MISSING'));
});

test('the same canonical award cannot move to another credit scope', () => {
  const data = copied({creditScopeId: 'different-matter'});
  assert.ok(codes(consolidatePerformance(data)).includes('AWARD_IDENTITY_CONFLICT'));
});

test('governance remains separate from performance and team percentage', () => {
  const performance = award({points: 5, originalPoints: 5, modality: 'TEST'});
  const governance = award({id: 'governance-a', category: 'GOVERNANCE', modality: 'MATERIAL', points: 1, originalPoints: 1});
  const other = award({id: 'other-performance', uid: 'member-b-fb', modality: 'TEST', creditScopeId: 'matter-b', points: 10, originalPoints: 10});
  const data = input({memberDirectory: {...confirmed, members: [member(), member('member-b')]}, scope: {kind: 'team'}, sources: [source(fa, [performance, governance], [event(performance), event(governance)]), source(fb, [other], [event(other)])]});
  const result = consolidatePerformance(data);
  assert.equal(result.complete, true);
  assert.deepEqual(result.totals['member-a'], {performance: 5, governance: 1, percentage: 50});
  assert.deepEqual(result.teamReference, {complete: true, eligibleCount: 2, maxPerformance: 10, allZero: false});
  assert.deepEqual(result.awards.map(item => item.canonicalOrigin.sourceProjectId).sort(), [fa, fa, fb].sort());
});

test('individual snapshots cannot claim a complete team reference', () => {
  const data = input();
  for (const source of data.sources) source.coverage = {kind: 'member', memberId: 'member-a'};
  const individual = consolidatePerformance(data);
  assert.equal(individual.complete, true); assert.equal(individual.teamReference, null);
  data.scope = {kind: 'team'};
  const team = consolidatePerformance(data);
  assert.equal(team.complete, false); assert.equal(team.teamReference, null); assert.equal(team.totals, null);
});

test('team percentages are calculated from unique awards, not source percentages', () => {
  const data = copied(); data.scope = {kind: 'team'};
  for (const source of data.sources) source.reference = {maxPerformance: 100000, percentage: 99};
  const result = consolidatePerformance(data);
  assert.equal(result.teamReference.maxPerformance, 1); assert.equal(result.totals['member-a'].percentage, 100);
});

test('a complete Checklist pair remains zero across sources', () => {
  const debit = award({id: 'checklist-debit', modality: 'CHECKLIST', creditScopeId: 'checklist-2026-10-08', activityId: 'checklist-2026-10-08', points: -1, originalPoints: -1, transferId: 'checklist-2026-10-08', leg: 'DEBIT'});
  const credit = award({...debit, id: 'checklist-credit', lastLedgerId: 'checklist-credit-v1', uid: 'member-b-fb', points: 1, originalPoints: 1, leg: 'CREDIT'});
  const data = input({memberDirectory: {...confirmed, members: [member(), member('member-b')]}, scope: {kind: 'team'}, sources: [source(fa, [debit], [event(debit)]), source(fb, [credit], [event(credit)])]});
  const result = consolidatePerformance(data);
  assert.equal(result.complete, true); assert.equal(Object.values(result.totals).reduce((sum, item) => sum + item.performance, 0), 0);
  data.sources[1] = source(fb);
  const incompletePair = consolidatePerformance(data);
  assert.equal(incompletePair.totals, null); assert.ok(codes(incompletePair).includes('CHECKLIST_PAIR_CONFLICT'));
});

test('a zero team is confirmed only after both complete sources are supplied', () => {
  const result = consolidatePerformance(input({scope: {kind: 'team'}, sources: [source(fa), source(fb)]}));
  assert.deepEqual(result.teamReference, {complete: true, eligibleCount: 1, maxPerformance: 0, allZero: true});
  assert.equal(result.totals['member-a'].percentage, 0);
});

test('malformed arguments and data cannot silently create a balance', () => {
  assert.throws(() => consolidatePerformance(null), TypeError);
  assert.throws(() => consolidatePerformance(input({fbProjectId: fa})), TypeError);
  assert.throws(() => consolidatePerformance(input({scope: {kind: 'email', email: 'x@example.invalid'}})), TypeError);
  assert.throws(() => consolidatePerformance(input({migrationSidecars: [{sourceProjectId: fa, sourcePath: '../evaluationAwards/a', destinationProjectId: fb, destinationPath: 'evaluationAwards/a'}]})), TypeError);
  const invalid = input(); invalid.sources[0].awards[0].points = NaN;
  assert.equal(consolidatePerformance(invalid).total, null);
});

test('audit content conflicts and duplicate documents require review', () => {
  const data = copied(); data.sources[1].awards[0].evidence = {formId: 'changed-form', responseId: 'response-a'};
  assert.ok(codes(consolidatePerformance(data)).includes('AWARD_VERSION_CONFLICT'));
  const duplicate = input(); duplicate.sources[0].awards.push(structuredClone(duplicate.sources[0].awards[0]));
  assert.ok(codes(consolidatePerformance(duplicate)).includes('DUPLICATE_DOCUMENT'));
});

test('copied historical authorship keeps its FA UID association without email matching', () => {
  const data = copied();
  data.sources[0].awards[0].approvedByUid = 'member-a-fa';
  data.sources[1].awards[0].approvedByUid = 'member-a-fa';
  data.sources[0].ledger[0].approvedByUid = 'member-a-fa';
  data.sources[1].ledger[0].approvedByUid = 'member-a-fa';
  const result = consolidatePerformance(data);
  assert.equal(result.complete, true); assert.equal(result.total.performance, 1);
  assert.equal('approvedByUid' in result.awards[0], false);
});

test('even small finite delta corruption and malformed timestamps fail closed', () => {
  const data = input(); data.sources[0].ledger[0].points += 0.000001;
  assert.ok(codes(consolidatePerformance(data)).includes('LEDGER_DELTA_CONFLICT'));
  const badTime = copied();
  badTime.sources[1].awards[0].updatedAt = new Date(NaN);
  assert.throws(() => consolidatePerformance(badTime), TypeError);
});

test('real Firebase timestamps preserve nanosecond conflicts beyond toMillis precision', () => {
  const originalTime = new Timestamp(1791457200, 100), divergentTime = new Timestamp(1791457200, 110);
  assert.equal(originalTime.toMillis(), divergentTime.toMillis());
  for (const collection of ['awards', 'ledger']) {
    const data = copied();
    data.sources[0][collection][0].updatedAt = originalTime;
    data.sources[1][collection][0].updatedAt = new Timestamp(originalTime.seconds, originalTime.nanoseconds);
    assert.equal(consolidatePerformance(data).complete, true);
    data.sources[1][collection][0].updatedAt = divergentTime;
    const result = consolidatePerformance(data);
    assert.equal(result.total, null); assert.equal(result.reviewRequired, true);
    assert.ok(codes(result).includes(collection === 'awards' ? 'AWARD_VERSION_CONFLICT' : 'LEDGER_VERSION_CONFLICT'));
  }
});

test('version one original points must equal the initial corrected points', () => {
  const initial = award({points: 1, originalPoints: 777});
  const result = consolidatePerformance(input({sources: [source(fa, [initial], [event(initial)]), source(fb)]}));
  assert.equal(result.total, null); assert.equal(result.reviewRequired, true);
  assert.ok(codes(result).includes('ORIGINAL_POINTS_CONFLICT'));
});

function correctedSuggestion() {
  const evidence = {participationId: 'part-a', reviewerUid: 'member-b-fa'};
  const original = award({modality: 'SUGGESTION', points: 2, originalPoints: 2, approvedByUid: 'member-b-fa', evidence});
  const copyV1 = award({...original, id: 'copy-a', uid: 'member-a-fb', lastLedgerId: 'copy-a-v1'});
  const corrected = award({...copyV1, points: 3, awardVersion: 2, lastLedgerId: 'copy-a-v2', sourceType: 'ADMIN_CORRECTION', sourceId: 'correction-a', approvedByUid: 'member-a-fb', adminOverride: true});
  const initialEvent = event(original, {approvedByUid: original.approvedByUid, evidence: {...evidence}});
  const copyEvent = event(copyV1, {approvedByUid: original.approvedByUid, evidence: {...evidence}});
  const correctionEvent = event(corrected, {points: 1, pointsBefore: 2, correctedPoints: 3, correctsId: copyEvent.id, approvedByUid: 'member-a-fb', evidence: {...evidence}});
  return input({memberDirectory: {...confirmed, members: [member(), member('member-b')]}, sources: [source(fa, [original], [initialEvent]), source(fb, [corrected], [copyEvent, correctionEvent])], migrationSidecars: [sidecar('evaluationAwards', original.id, corrected.id), sidecar('evaluationLedger', initialEvent.id, copyEvent.id)]});
}

test('a new FB correction can preserve proven FA reviewer evidence with distinct mapped UIDs', () => {
  const data = correctedSuggestion(), before = structuredClone(data);
  assert.notEqual(data.memberDirectory.members[1].faUid, data.memberDirectory.members[1].fbUid);
  const result = consolidatePerformance(data);
  assert.equal(result.complete, true); assert.deepEqual(result.total, {performance: 3, governance: 0});
  assert.deepEqual(result.ledger.map(item => [item.awardVersion, item.points]), [[1, 2], [2, 1]]);
  assert.deepEqual(result.ledger[1].canonicalOrigin, {sourceProjectId: fb, sourcePath: 'evaluationLedger/copy-a-v2'});
  assert.equal(JSON.stringify(result).includes('member-b-fa'), false);
  assert.deepEqual(data, before);
});

test('new FB actors and changed evidence cannot borrow historical FA UID mapping', () => {
  const actor = correctedSuggestion();
  actor.sources[1].ledger[1].approvedByUid = 'member-b-fa';
  const actorResult = consolidatePerformance(actor);
  assert.equal(actorResult.total, null); assert.ok(codes(actorResult).includes('AUDIT_UID_NOT_MAPPED'));
  const changedEvidence = correctedSuggestion();
  changedEvidence.sources[1].ledger[1].evidence.participationId = 'different-participation';
  const evidenceResult = consolidatePerformance(changedEvidence);
  assert.equal(evidenceResult.total, null); assert.ok(codes(evidenceResult).includes('AUDIT_UID_NOT_MAPPED'));
});

test('each consolidated category balance stays within the EvaluationLedger bound', () => {
  for (const category of ['PERFORMANCE', 'GOVERNANCE']) {
    for (const sign of [1, -1]) {
      const first = award({modality: 'TEST', category, points: sign * 600000, originalPoints: sign * 600000});
      const second = award({id: 'award-b', uid: 'member-a-fb', creditScopeId: 'matter-b', modality: 'TEST', category, points: sign * 600000, originalPoints: sign * 600000});
      const result = consolidatePerformance(input({sources: [source(fa, [first], [event(first)]), source(fb, [second], [event(second)])]}));
      assert.equal(result.total, null); assert.equal(result.reviewRequired, true);
      assert.ok(result.issues.some(item => item.code === 'BALANCE_LIMIT_EXCEEDED' && item.category === category));
    }
  }
});
