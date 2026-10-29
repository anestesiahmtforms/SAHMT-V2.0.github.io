import test from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlTrainingService } from '../worker-training/service.js';

// This adapter models optimistic Firestore transactions: a changed read causes
// the whole callback to retry, and no staged write leaks from a failed attempt.
function memoryStore() {
  const data = new Map(), revisions = new Map();
  const key = (c, id) => `${c}/${id}`;
  const clone = value => value === undefined ? null : structuredClone(value);
  let beforeCommit;
  const store = {
    seed(c, id, value) { const k = key(c, id); data.set(k, clone(value)); revisions.set(k, (revisions.get(k) || 0) + 1); },
    async get(c, id) { return clone(data.get(key(c, id))); },
    async list(c, filters = [], limit = 1000) {
      return [...data.entries()].filter(([k, d]) => k.startsWith(`${c}/`) && filters.every(f =>
        f.op === 'ARRAY_CONTAINS' ? d[f.field]?.includes(f.value) : d[f.field] === f.value)).slice(0, limit).map(([, d]) => clone(d));
    },
    set beforeCommit(fn) { beforeCommit = fn; },
    async transaction(fn) {
      for (let retry = 0; retry < 30; retry++) {
        const reads = new Map(), writes = [];
        const tx = {
          async get(c, id) { const k = key(c, id); reads.set(k, revisions.get(k) || 0); return clone(data.get(k)); },
          set(c, id, value) { writes.push({ c, id, value: clone(value) }); },
          create(c, id, value) { writes.push({ c, id, value: clone(value), create: true }); },
          delete(c, id) { writes.push({ c, id, remove: true }); },
        };
        if (store.batchReads) tx.getMany = async (c, ids) => { store.batchReads.push({ collection: c, count: ids.length }); return Promise.all(ids.map(id => tx.get(c, id))); };
        const result = await fn(tx);
        if (beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook(); }
        await Promise.resolve();
        if ([...reads].some(([k, rev]) => (revisions.get(k) || 0) !== rev)) continue;
        if (writes.some(w => w.create && data.has(key(w.c, w.id)))) throw new Error('ALREADY_EXISTS');
        for (const w of writes) {
          if (w.remove) data.delete(key(w.c, w.id)); else data.set(key(w.c, w.id), w.value);
          revisions.set(key(w.c, w.id), (revisions.get(key(w.c, w.id)) || 0) + 1);
        }
        return result;
      }
      throw new Error('RETRIES_EXHAUSTED');
    },
  };
  return store;
}

const identity = uid => ({ uid, email: `${uid}@example.invalid`, emailVerified: true, provider: 'google.com' });
const bank = () => Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, stem: `Question ${i}`, points: 1,
  options: [{ id: 'a', text: 'First' }, { id: 'b', text: 'Second' }], correctOptionId: 'a', comment: 'Private answer explanation' }));
const schema = () => ({ version: '1', tests: [{ code: 'T1' }], checks: [{ code: 'V1' }] });
const publication = (expectedVersion = 0) => ({ trainingId: 'rop-one', expectedVersion,
  training: { title: 'ROP One', category: 'ROPS', subcategory: 'Recovery', audienceGroup: 'GENERAL', managerUid: 'manager', status: 'PUBLISHED', source: { textDocId: 'private-text', bankDocId: 'private-bank', auditDocId: 'private-audit', folderId: 'private-folder' } },
  sections: [{ id: 'intro', title: 'Introduction', html: '<p>Study text</p>' }, { id: 'body', title: 'Body', html: '<table><tbody><tr><td>Body</td></tr></tbody></table>' }],
  bank: bank(), selectedQuestionIds: ['q0', 'q1', 'q2', 'q3', 'q4'], auditSchema: schema() });
async function setup() {
  const store = memoryStore(); let sequence = 0;
  for (const uid of ['admin', 'manager', 'participant', 'other']) {
    store.seed('users', uid, { uid, active: true, access: true, role: uid === 'admin' ? 'administrador_app' : 'colaborador', permissions: {} });
    store.seed('documentAccessEmails', `${uid}@example.invalid`, { id: `${uid}@example.invalid`, email: `${uid}@example.invalid`, active: true, groups: ['GENERAL'] });
  }
  store.seed('scores', 'legacy', { uid: 'participant', points: 77 });
  const service = createHtmlTrainingService({ store, now: () => 1792970000000, uuid: () => `run-${++sequence}` });
  const exec = (action, input = {}, uid = 'participant') => service.execute(action, input, identity(uid));
  await exec('PUBLISH', publication(), 'admin');
  return { store, service, exec };
}
async function ready(h, requestId = 'begin-one', uid = 'participant', answers = {}) {
  let { state } = await h.exec('BEGIN', { trainingId: 'rop-one', requestId }, uid);
  const runId = state.run.id;
  await h.exec('READ', { trainingId: 'rop-one', runId, index: 0 }, uid);
  await h.exec('READ', { trainingId: 'rop-one', runId, index: 1 }, uid);
  await h.exec('ACK', { trainingId: 'rop-one', runId, accepted: true }, uid);
  const result = await h.exec('QUIZ', { trainingId: 'rop-one', runId, answers: { q0: 'a', q1: 'a', q2: 'a', q3: 'a', q4: 'a', ...answers } }, uid);
  return { runId, state: result.state };
}
const submit = (h, runId, requestId = 'submit-one', uid = 'participant', suggestion = 'Consider an additional example') =>
  h.exec('SUBMIT', { trainingId: 'rop-one', runId, requestId, suggestion }, uid);
const errorCode = code => error => error.code === code && error.status >= 400;

test('published catalog and participant responses never expose private bank, source or answers', async () => {
  const h = await setup();
  const list = await h.exec('LIST'); assert.equal(list.trainings.length, 1);
  const open = await h.exec('OPEN', { trainingId: 'rop-one' });
  assert.equal(open.questions.length, 5); assert.equal(open.training.canManage, false); assert.equal(open.training.hasAudit, true);
  const serialized = JSON.stringify({ list, open });
  for (const secret of ['correctOptionId', 'private-text', 'Private answer explanation', 'q5']) assert.equal(serialized.includes(secret), false);
  const edit = await h.exec('EDIT', { trainingId: 'rop-one' }, 'manager'); assert.equal(edit.bank.length, 6);
  assert.equal(edit.bank[0].correctOptionId, 'a'); assert.equal(edit.training.source.textDocId, 'private-text');
  assert.equal((await h.exec('CONTENT', { trainingId: 'rop-one', version: 1 })).sections.length, 2);
});

test('verified current profile and exact document group control every participant action', async () => {
  const h = await setup();
  await assert.rejects(h.service.execute('LIST', {}, { ...identity('participant'), emailVerified: false }), errorCode('UNAUTHENTICATED'));
  h.store.seed('documentAccessEmails', 'participant@example.invalid', { id: 'participant@example.invalid', email: 'participant@example.invalid', active: true, groups: ['RESTRICTED'] });
  assert.deepEqual((await h.exec('LIST')).trainings, []);
  await assert.rejects(h.exec('OPEN', { trainingId: 'rop-one' }), errorCode('FORBIDDEN'));
  h.store.seed('users', 'participant', { active: false, access: true });
  await assert.rejects(h.exec('LIST'), errorCode('FORBIDDEN'));
});

test('second device resumes same unconsumed run, cannot skip reading or submit unfinished answers', async () => {
  const h = await setup();
  const [a, b] = await Promise.all([h.exec('BEGIN', { trainingId: 'rop-one', requestId: 'device-a' }), h.exec('BEGIN', { trainingId: 'rop-one', requestId: 'device-b' })]);
  assert.equal(a.state.run.id, b.state.run.id); assert.equal(a.state.attempts.length, 0);
  await assert.rejects(h.exec('READ', { trainingId: 'rop-one', runId: a.state.run.id, index: 1 }), errorCode('READ_ORDER'));
  await assert.rejects(h.exec('ACK', { trainingId: 'rop-one', runId: a.state.run.id, accepted: true }), errorCode('STAGE_CONFLICT'));
  await assert.rejects(submit(h, a.state.run.id), errorCode('STAGE_CONFLICT'));
  await h.exec('READ', { trainingId: 'rop-one', runId: a.state.run.id, index: 0 });
  await h.exec('READ', { trainingId: 'rop-one', runId: a.state.run.id, index: 0 });
  assert.equal((await h.exec('OPEN', { trainingId: 'rop-one' })).state.run.readCount, 1);
});

test('same attempt submitted concurrently with different request IDs awards one best score and acknowledgement', async () => {
  const h = await setup(); const { runId, state } = await ready(h);
  assert.equal('score' in state.run, false); assert.equal(state.ackPoints, 0);
  assert.equal(await h.store.get('htmlTrainingScores', 'participant'), null);
  const results = await Promise.all([submit(h, runId, 'device-a'), submit(h, runId, 'device-b')]);
  for (const res of results) { assert.equal(res.state.attempts.length, 1); assert.equal(res.score.total, 6); }
  assert.equal((await h.store.get('htmlTrainingScores', 'participant')).total, 6);
  assert.deepEqual(await h.store.get('scores', 'legacy'), { uid: 'participant', points: 77 });
  await assert.rejects(submit(h, runId, 'device-a', 'participant', 'Changed content'), errorCode('IDEMPOTENCY_CONFLICT'));
});

test('second attempt repeats stages, keeps highest score and lifetime limit across publications', async () => {
  const h = await setup(); let { runId } = await ready(h); await submit(h, runId);
  await h.exec('PUBLISH', publication(1), 'manager');
  ({ runId } = await ready(h, 'begin-two', 'participant', { q0: 'b', q1: 'b' }));
  const done = await submit(h, runId, 'submit-two', 'participant', '');
  assert.equal(done.state.attempts.length, 2); assert.equal(done.state.attempts[1].score, 3);
  assert.equal(done.score.test, 5); assert.equal(done.score.acknowledgement, 1); assert.equal(done.score.total, 6);
  await h.exec('PUBLISH', publication(2), 'admin');
  await assert.rejects(h.exec('BEGIN', { trainingId: 'rop-one', requestId: 'begin-three' }), errorCode('ATTEMPT_LIMIT'));
  const replay = await submit(h, done.state.attempts[0].runId, 'submit-one'); assert.equal(replay.state.attempts.length, 2);
});

test('publishing while reading invalidates old run and cached content without consuming an attempt', async () => {
  const h = await setup(); const old = await ready(h);
  await h.exec('PUBLISH', publication(1), 'manager');
  await assert.rejects(submit(h, old.runId), errorCode('VERSION_CHANGED'));
  await assert.rejects(h.exec('CONTENT', { trainingId: 'rop-one', version: 1 }), errorCode('VERSION_CHANGED'));
  assert.equal((await h.exec('OPEN', { trainingId: 'rop-one' })).state.run, null);
  const fresh = await h.exec('BEGIN', { trainingId: 'rop-one', requestId: 'new-version' });
  assert.equal(fresh.state.run.trainingVersion, 2); assert.equal(fresh.state.run.readCount, 0); assert.equal(fresh.state.attempts.length, 0);
});

test('suggestion decision is one shared grant, manager replay is rejected and administrator correction replaces points', async () => {
  const h = await setup(); const { runId } = await ready(h); const done = await submit(h, runId);
  const request = { trainingId: 'rop-one', uid: 'participant', expectedVersion: done.state.version, points: 2, note: 'Useful suggestion' };
  const results = await Promise.allSettled([h.exec('REVIEW', request, 'manager'), h.exec('REVIEW', request, 'admin')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const state = (await h.exec('OPEN', { trainingId: 'rop-one' })).state;
  assert.equal((await h.store.get('htmlTrainingScores', 'participant')).total, 8);
  await assert.rejects(h.exec('REVIEW', { ...request, expectedVersion: state.version }, 'manager'), errorCode('ALREADY_REVIEWED'));
  const corrected = await h.exec('REVIEW', { ...request, expectedVersion: state.version, points: 1, note: 'Adjusted' }, 'admin');
  assert.equal(corrected.score.total, 7); assert.equal(corrected.state.suggestionDecision.history.length, 1);
  assert.equal(corrected.state.suggestionDecision.history[0].points, 2);
  await assert.rejects(h.exec('REVIEW', { ...request, expectedVersion: corrected.state.version, points: 3 }, 'admin'), errorCode('INVALID_INPUT'));
});

test('no self review or empty suggestion awards, and regular manager uses only individual assignment', async () => {
  const h = await setup(); const own = await ready(h, 'manager-start', 'manager'); const ownDone = await submit(h, own.runId, 'manager-submit', 'manager');
  await assert.rejects(h.exec('REVIEW', { trainingId: 'rop-one', uid: 'manager', expectedVersion: ownDone.state.version, points: 1 }, 'manager'), errorCode('SELF_REVIEW'));
  await assert.rejects(h.exec('EDIT', { trainingId: 'rop-one' }, 'other'), errorCode('FORBIDDEN'));
  const participant = await ready(h); const empty = await submit(h, participant.runId, 'submit-one', 'participant', '');
  await assert.rejects(h.exec('REVIEW', { trainingId: 'rop-one', uid: 'participant', expectedVersion: empty.state.version, points: 2 }, 'manager'), errorCode('NO_SUGGESTION'));
});

test('revoked assignment and user authorization during commit abort mutations atomically', async () => {
  const h = await setup();
  h.store.beforeCommit = async () => { const training = await h.store.get('htmlTrainings', 'rop-one'); h.store.seed('htmlTrainings', 'rop-one', { ...training, managerUid: 'other' }); };
  await assert.rejects(h.exec('PUBLISH', publication(1), 'manager'), errorCode('FORBIDDEN'));
  assert.equal(await h.store.get('htmlTrainingVersions', 'rop-one_v2'), null);
  const { runId } = await ready(h);
  h.store.beforeCommit = () => h.store.seed('users', 'participant', { uid: 'participant', active: true, access: false });
  await assert.rejects(submit(h, runId), errorCode('FORBIDDEN'));
  assert.equal((await h.store.get('htmlTrainingStates', 'rop-one_participant')).attempts.length, 0);
  assert.equal(await h.store.get('htmlTrainingScores', 'participant'), null);
});

test('publishing uses CAS, preserves immutable versions and bank, cannot reassign manager or accept unsafe HTML', async () => {
  const h = await setup(); const original = await h.store.get('htmlTrainingVersions', 'rop-one_v1');
  const replacement = publication(1); replacement.training.managerUid = 'other';
  await assert.rejects(h.exec('PUBLISH', replacement, 'manager'), errorCode('FORBIDDEN'));
  const [a, b] = await Promise.allSettled([h.exec('PUBLISH', publication(1), 'manager'), h.exec('PUBLISH', publication(1), 'admin')]);
  assert.equal([a, b].filter(x => x.status === 'fulfilled').length, 1);
  assert.deepEqual(await h.store.get('htmlTrainingVersions', 'rop-one_v1'), original);
  const deletedBank = publication(2); deletedBank.bank.pop();
  await assert.rejects(h.exec('PUBLISH', deletedBank, 'manager'), errorCode('BANK_QUESTIONS_REMOVED'));
  for (const html of ['<script>alert(1)</script>', '<img src="data:image/svg+xml;base64,PHN2Zz4=">', '<p onclick="alert(1)">x</p>', '<iframe src="https://evil.invalid"></iframe>', '<p style="background:url(https://evil.invalid)">x</p>', '<a href="javascript:alert(1)">x</a>', '<img src="https://evil.invalid/pixel.png">']) {
    const bad = publication(2); bad.sections[0].html = html;
    await assert.rejects(h.exec('PUBLISH', bad, 'manager'), errorCode('UNSAFE_CONTENT'));
  }
});

test('audit completion validates ROP domain, stays immutable, enforces assignment, and never changes score', async () => {
  const h = await setup(); const draft = { trainingId: 'rop-one', context: { sector: 'Recovery', auditor: 'Auditor', date: '2026-10-25', periodStart: '2026-10-01', periodEnd: '2026-10-25', method: 'Observation', population: 'Eligible transitions', sampling: 'Consecutive' }, answers: { T1: { status: 'C', evidence: 'E001' } }, checks: { V1: { finding: 'Separate check' } }, actions: [], cases: [{ reference: 'anon-1', criterion: 'Transfer', result: 'NO' }], validation: { reviewer: 'Validator' } };
  const req = { trainingId: 'rop-one', id: 'audit-one', expectedVersion: 0, draft, complete: false };
  await assert.rejects(h.exec('AUDIT_SAVE', req), errorCode('FORBIDDEN'));
  const saved = await h.exec('AUDIT_SAVE', req, 'manager'); assert.equal(saved.audit.version, 1);
  await assert.rejects(h.exec('AUDIT_SAVE', { ...req, complete: true, expectedVersion: 1, draft: { ...draft, answers: {} } }, 'manager'), errorCode('AUDIT_INVALID'));
  const done = await h.exec('AUDIT_SAVE', { ...req, expectedVersion: 1, complete: true }, 'manager');
  assert.equal(done.audit.status, 'completed'); assert.equal(done.audit.conclusion, 'conforming'); assert.equal(done.audit.collection.adherence, null);
  await assert.rejects(h.exec('AUDIT_SAVE', { ...req, expectedVersion: 2 }, 'admin'), errorCode('AUDIT_IMMUTABLE'));
  assert.equal((await h.exec('AUDIT_LIST', { trainingId: 'rop-one' }, 'manager')).audits.length, 1);
  assert.equal(await h.store.get('htmlTrainingScores', 'manager'), null);
});

test('simultaneous completions on different items retain both contributions in the own score projection', async () => {
  const h = await setup(); const second = publication(); second.trainingId = 'rop-two';
  await h.exec('PUBLISH', second, 'admin');
  const firstRun = await ready(h);
  const begun = await h.exec('BEGIN', { trainingId: 'rop-two', requestId: 'second-item' });
  const runId = begun.state.run.id;
  await h.exec('READ', { trainingId: 'rop-two', runId, index: 0 });
  await h.exec('READ', { trainingId: 'rop-two', runId, index: 1 });
  await h.exec('ACK', { trainingId: 'rop-two', runId, accepted: true });
  await h.exec('QUIZ', { trainingId: 'rop-two', runId, answers: { q0: 'a', q1: 'a', q2: 'a', q3: 'b', q4: 'b' } });
  await Promise.all([submit(h, firstRun.runId), h.exec('SUBMIT', { trainingId: 'rop-two', runId, requestId: 'second-submit', suggestion: '' })]);
  const score = await h.store.get('htmlTrainingScores', 'participant');
  assert.equal(score.total, 10); assert.equal(score.acknowledgement, 2); assert.equal(score.test, 8);
  assert.deepEqual(Object.keys(score.items).sort(), ['rop-one', 'rop-two']);
});

test('five exact answers are required, answer edits after quiz confirmation and supplied client scores are ignored', async () => {
  const h = await setup();
  const { state } = await h.exec('BEGIN', { trainingId: 'rop-one', requestId: 'one' }); const runId = state.run.id;
  await h.exec('READ', { trainingId: 'rop-one', runId, index: 0 }); await h.exec('READ', { trainingId: 'rop-one', runId, index: 1 });
  await h.exec('ACK', { trainingId: 'rop-one', runId, accepted: true });
  for (const answers of [{ q0: 'a' }, { q0: 'x', q1: 'a', q2: 'a', q3: 'a', q4: 'a' }, { q0: 'a', q1: 'a', q2: 'a', q3: 'a', q4: 'a', q5: 'a' }]) {
    await assert.rejects(h.exec('QUIZ', { trainingId: 'rop-one', runId, answers }), errorCode('INVALID_ANSWERS'));
  }
  await h.exec('QUIZ', { trainingId: 'rop-one', runId, answers: { q0: 'b', q1: 'b', q2: 'b', q3: 'b', q4: 'b' } });
  await assert.rejects(h.exec('QUIZ', { trainingId: 'rop-one', runId, answers: { q0: 'a', q1: 'a', q2: 'a', q3: 'a', q4: 'a' } }), errorCode('STAGE_CONFLICT'));
  const done = await h.exec('SUBMIT', { trainingId: 'rop-one', runId, requestId: 'final', suggestion: '', score: 100, uid: 'other', ackPoints: 10 });
  assert.equal(done.score.total, 1); assert.equal(done.score.uid, 'participant'); assert.equal(done.state.bestScore, 0);
  assert.equal(await h.store.get('htmlTrainingScores', 'other'), null);
});

test('group revocation during submit and source edits by manager are rejected before any score or publication write', async () => {
  const h = await setup(); const run = await ready(h);
  h.store.beforeCommit = () => h.store.seed('documentAccessEmails', 'participant@example.invalid', { id: 'participant@example.invalid', email: 'participant@example.invalid', active: false, groups: ['GENERAL'] });
  await assert.rejects(submit(h, run.runId), errorCode('FORBIDDEN'));
  assert.equal(await h.store.get('htmlTrainingScores', 'participant'), null);
  const badSource = publication(1); badSource.training.source.textDocId = 'unrelated-doc';
  await assert.rejects(h.exec('PUBLISH', badSource, 'manager'), errorCode('FORBIDDEN'));
  assert.equal(await h.store.get('htmlTrainingVersions', 'rop-one_v2'), null);
});

test('malformed publication nodes produce safe validation errors rather than internal exceptions', async () => {
  const h = await setup();
  for (const change of [req => { req.sections[0] = null; }, req => { req.bank[0] = null; }, req => { req.bank[0].options[0] = null; }, req => { req.auditSchema.tests[0] = null; }, req => { req.training.source = 'invalid'; }]) {
    const req = publication(1); change(req);
    await assert.rejects(h.exec('PUBLISH', req, 'manager'), errorCode('INVALID_INPUT'));
  }
});

test('a first zero-point manual decision consumes the same grant, and permission admin can correct it', async () => {
  const h = await setup(); const { runId } = await ready(h); const done = await submit(h, runId);
  const zero = await h.exec('REVIEW', { trainingId: 'rop-one', uid: 'participant', expectedVersion: done.state.version, points: 0, note: 'Not applicable' }, 'manager');
  assert.equal(zero.score.total, 6);
  await assert.rejects(h.exec('REVIEW', { trainingId: 'rop-one', uid: 'participant', expectedVersion: zero.state.version, points: 2 }, 'manager'), errorCode('ALREADY_REVIEWED'));
  h.store.seed('users', 'other', { uid: 'other', active: true, access: true, role: 'colaborador', permissions: { admin: true } });
  const corrected = await h.exec('REVIEW', { trainingId: 'rop-one', uid: 'participant', expectedVersion: zero.state.version, points: 2 }, 'other');
  assert.equal(corrected.score.total, 8); assert.equal(corrected.state.suggestionDecision.history[0].points, 0);
});

test('bulk transaction reads preserve content, catalog and suggestions without a per-document network requirement', async () => {
  const h = await setup(); h.store.batchReads = [];
  const { runId } = await ready(h); await submit(h, runId);
  assert.equal((await h.exec('LIST')).trainings[0].id, 'rop-one');
  assert.equal((await h.exec('CONTENT', { trainingId: 'rop-one', version: 1 })).sections[1].id, 'body');
  assert.equal((await h.exec('EDIT', { trainingId: 'rop-one' }, 'manager')).suggestions[0].uid, 'participant');
  assert.ok(h.store.batchReads.some(read => read.collection === 'htmlTrainings' && read.count === 1));
  const contentVersion=await h.store.get('htmlTrainingVersions','rop-one_v1');
  assert.ok(h.store.batchReads.some(read => read.collection === 'htmlTrainingContent' && read.count === contentVersion.chunkCount));
  assert.ok(h.store.batchReads.some(read => read.collection === 'htmlTrainingStates' && read.count === 1));
});

test('audit saves have compare-and-swap, preserve previous draft author/value, and cannot cross item IDs', async () => {
  const h = await setup();
  const evidence = [{ code: 'E001', reference: 'Anonymous operational evidence', date: '2026-10-25', version: '1' }];
  const req = { trainingId: 'rop-one', id: 'audit-one', expectedVersion: 0, draft: { context: { sector: 'First' }, evidence, score: 999 }, complete: false };
  const race = await Promise.allSettled([h.exec('AUDIT_SAVE', req, 'manager'), h.exec('AUDIT_SAVE', req, 'admin')]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  const result = await h.exec('AUDIT_SAVE', { ...req, expectedVersion: 1, draft: { context: { sector: 'Revised' }, evidence } }, 'admin');
  assert.equal(result.audit.history[0].draft.context.sector, 'First'); assert.equal(result.audit.updatedByUid, 'admin'); assert.equal('score' in result.audit, false);
  assert.deepEqual(result.audit.evidence, evidence); assert.deepEqual(result.audit.history[0].draft.evidence, evidence);
  const second = publication(); second.trainingId = 'rop-two'; await h.exec('PUBLISH', second, 'admin');
  await assert.rejects(h.exec('AUDIT_SAVE', { ...req, trainingId: 'rop-two', expectedVersion: 2 }, 'admin'), errorCode('FORBIDDEN'));
  assert.equal((await h.store.get('htmlTrainingAudits', 'audit-one')).trainingId, 'rop-one');
});

test('draft items are visible only to current manager/admin and do not accept participant runs', async () => {
  const h = await setup(); const draft = publication(1); draft.training.status = 'DRAFT';
  await h.exec('PUBLISH', draft, 'manager');
  assert.equal((await h.exec('LIST')).trainings.length, 0);
  await assert.rejects(h.exec('OPEN', { trainingId: 'rop-one' }), errorCode('FORBIDDEN'));
  const managerList = await h.exec('LIST', {}, 'manager'); assert.equal(managerList.trainings.length, 1);
  await assert.rejects(h.exec('BEGIN', { trainingId: 'rop-one', requestId: 'begin' }, 'manager'), errorCode('NOT_PUBLISHED'));
});

test('SCORE returns confirmed zero for a missing own projection without creating an award', async () => {
  const h = await setup();
  const result = await h.exec('SCORE');
  assert.deepEqual(result.score, { uid: 'participant', acknowledgement: 0, test: 0, suggestion: 0, total: 0, version: 0, items: {}, updatedAt: null });
  assert.deepEqual(result.trainings, []);
  assert.equal(await h.store.get('htmlTrainingScores', 'participant'), null);
});

test('SCORE restricts foreign balances to current administrators and rechecks revocation during the read', async () => {
  const h = await setup(); const { runId } = await ready(h); await submit(h, runId);
  await assert.rejects(h.exec('SCORE', { subjectUid: 'participant' }, 'other'), errorCode('FORBIDDEN'));
  await assert.rejects(h.exec('SCORE', { subjectUid: 'participant' }, 'manager'), errorCode('FORBIDDEN'));
  const result = await h.exec('SCORE', { subjectUid: 'participant' }, 'admin');
  assert.equal(result.score.uid, 'participant'); assert.equal(result.score.total, 6);
  h.store.beforeCommit = () => h.store.seed('users', 'admin', { uid: 'admin', active: true, access: true, permissions: {} });
  await assert.rejects(h.exec('SCORE', { subjectUid: 'participant' }, 'admin'), errorCode('FORBIDDEN'));
});

test('SCORE batches title lookup, preserves unpublished/deleted item history and exposes no private content', async () => {
  const h = await setup(); h.store.batchReads = [];
  const { runId } = await ready(h); await submit(h, runId);
  const draft = publication(1); draft.training.status = 'DRAFT'; await h.exec('PUBLISH', draft, 'manager');
  const projection = await h.store.get('htmlTrainingScores', 'participant');
  h.store.seed('htmlTrainingScores', 'participant', { ...projection, acknowledgement: 2, test: 9, suggestion: 2, total: 13,
    items: { ...projection.items, 'deleted-item': { acknowledgement: 1, test: 4, suggestion: 2, answers: { q0: 'private-answer' } } } });
  const result = await h.exec('SCORE');
  assert.equal(result.score.total, 13);
  assert.deepEqual(result.trainings, [
    { trainingId: 'deleted-item', title: 'deleted-item', acknowledgement: 1, test: 4, suggestion: 2, total: 7 },
    { trainingId: 'rop-one', title: 'ROP One', acknowledgement: 1, test: 5, suggestion: 0, total: 6 },
  ]);
  assert.ok(h.store.batchReads.some(read => read.collection === 'htmlTrainings' && read.count === 2));
  for (const secret of ['correctOptionId', 'private-text', 'Private answer explanation', 'suggestionDecision', 'Consider an additional example', 'answers']) assert.equal(JSON.stringify(result).includes(secret), false);
});

test('only administrators can publish without an assigned manager, with later assignment preserving the item', async () => {
  const h = await setup(); const req = publication(); req.trainingId = 'unassigned'; req.training.managerUid = ''; req.training.status = 'DRAFT';
  await assert.rejects(h.exec('PUBLISH', req, 'manager'), errorCode('FORBIDDEN'));
  const saved = await h.exec('PUBLISH', req, 'admin');
  assert.equal(saved.training.status, 'DRAFT'); assert.equal(saved.training.managerUid, '');
  const publish = { ...req, expectedVersion: 1, training: { ...req.training, status: 'PUBLISHED' } };
  assert.equal((await h.exec('PUBLISH', publish, 'admin')).training.managerUid, '');
  await assert.rejects(h.exec('EDIT', {trainingId:'unassigned'}, 'manager'), errorCode('FORBIDDEN'));
  publish.expectedVersion = 2;
  publish.training.managerUid = 'manager';
  assert.equal((await h.exec('PUBLISH', publish, 'admin')).training.status, 'PUBLISHED');
});

test('administrator can defer a documented review without falsely recording it as completed',async()=>{
 const h=await setup(),request=publication(1);request.training.source.pendingInstitutionalReview=true;
 request.deferInstitutionalReview=true;request.reviewDeferralReason='Publicar agora por autorização do administrador; revisar posteriormente.';
 await assert.rejects(h.exec('PUBLISH',request,'manager'),errorCode('FORBIDDEN'));
 const result=await h.exec('PUBLISH',request,'admin');
 assert.equal(result.training.source.pendingInstitutionalReview,true);
 assert.equal(result.training.source.institutionalReview,undefined);
 assert.equal(result.training.source.pendingReviewPublication.uid,'admin');
 assert.equal(result.training.source.pendingReviewPublication.reason,request.reviewDeferralReason);
 const invalid={...request,expectedVersion:2,reviewDeferralReason:''};
 await assert.rejects(h.exec('PUBLISH',invalid,'admin'),errorCode('INVALID_INPUT'));
});

test('audited flow diagrams and disclosure markup allow only the explicitly supported class tokens', async () => {
  const h = await setup(); const req = publication(1);
  req.sections[0].html = '<section class="flow"><div class="branch action">Check</div><details class="scroll"><summary class="notice">Reference</summary><p class="source">Source</p></details></section>';
  await h.exec('PUBLISH', req, 'manager');
  const content = await h.exec('CONTENT', { trainingId: 'rop-one', version: 2 }); assert.equal(content.sections[0].html, req.sections[0].html);
  for (const html of ['<section class="flow evil">x</section>', '<details class="notice" onclick="alert(1)"><summary>Open</summary></details>']) {
    const bad = publication(2); bad.sections[0].html = html;
    await assert.rejects(h.exec('PUBLISH', bad, 'manager'), errorCode('UNSAFE_CONTENT'));
  }
});

test('large illustrated sections are split into bounded storage documents without changing the reading sequence',async()=>{
 const h=await setup(),req=publication(1);
 req.sections[0].html='<p>Imagem clínica preservada 🩺</p><img alt="Diagrama" src="data:image/png;base64,'+'A'.repeat(1500000)+'">';
 await h.exec('PUBLISH',req,'manager');
 const snapshot=await h.store.get('htmlTrainingVersions','rop-one_v2');
 assert.ok(snapshot.chunkCount>req.sections.length);
 for(let i=0;i<snapshot.chunkCount;i++){const chunk=await h.store.get('htmlTrainingContent',`rop-one_v2_p${i}`);assert.ok(Buffer.byteLength(JSON.stringify(chunk))<800000);}
 const result=await h.exec('CONTENT',{trainingId:'rop-one',version:2});assert.deepEqual(result.sections,req.sections);
 assert.equal((await h.exec('OPEN',{trainingId:'rop-one'})).training.sectionCount,2);
});

test('the assigned manager can resolve documented institutional review and publish without administrator approval',async()=>{
 const h=await setup(),draft=publication(1);draft.training.status='DRAFT';draft.training.source.pendingInstitutionalReview=true;
 await h.exec('PUBLISH',draft,'admin');
 const request={...draft,expectedVersion:2,training:{...draft.training,status:'PUBLISHED'}};
 await assert.rejects(h.exec('PUBLISH',request,'manager'),errorCode('INSTITUTIONAL_REVIEW_REQUIRED'));
 const result=await h.exec('PUBLISH',{...request,institutionalReviewConfirmed:true},'manager');
 assert.equal(result.training.status,'PUBLISHED');assert.equal(result.training.source.pendingInstitutionalReview,false);
 assert.equal(result.training.source.institutionalReview.uid,'manager');
});

test('audit autosave history remains durable without growing the current draft past the Firestore document limit',async()=>{
 const h=await setup();let audit;
 for(let n=0;n<120;n++)({audit}=await h.exec('AUDIT_SAVE',{trainingId:'rop-one',id:'long-audit',expectedVersion:n,complete:false,draft:{context:{sector:'Sector '+n,notes:'e'.repeat(9000)}}},'manager'));
 assert.equal(audit.version,120);assert.ok(Buffer.byteLength(JSON.stringify(audit))<100000);
 const earliest=await h.store.get('htmlTrainingAuditHistory','long-audit_v1');
 assert.equal(earliest.context.sector,'Sector 0');assert.equal(earliest.updatedByUid,'manager');
});


test('only administrators change folder access; disabled parents and children block direct reads and managers',async()=>{
 const h=await setup();
 await assert.rejects(h.exec('SET_FOLDER_ACCESS',{path:['ROPs'],enabled:false,expectedVersion:0}),{code:'FORBIDDEN'});
 const changed=await h.exec('SET_FOLDER_ACCESS',{path:['ROPs'],enabled:false,expectedVersion:0},'admin');
 assert.equal(changed.folderAccess.version,1);
 assert.equal((await h.exec('LIST')).trainings.length,0);
 for(const action of ['OPEN','CONTENT','BEGIN'])await assert.rejects(h.exec(action,{trainingId:'rop-one',requestId:'one'}),{code:'FORBIDDEN'});
 await assert.rejects(h.exec('EDIT',{trainingId:'rop-one'},'manager'),{code:'FORBIDDEN'});
 assert.equal((await h.exec('LIST',{},'admin')).trainings.length,1);
 await assert.rejects(h.exec('SET_FOLDER_ACCESS',{path:['ROPs'],enabled:true,expectedVersion:0},'admin'),{code:'VERSION_CONFLICT'});
 await h.exec('SET_FOLDER_ACCESS',{path:['ROPs'],enabled:true,expectedVersion:1},'admin');
 await h.exec('SET_FOLDER_ACCESS',{path:['ROPs','Recovery'],enabled:false,expectedVersion:2},'admin');
 assert.equal((await h.exec('LIST')).trainings.length,0);
 await h.exec('SET_FOLDER_ACCESS',{path:['ROPs','Recovery'],enabled:true,expectedVersion:3},'admin');
 assert.equal((await h.exec('LIST')).trainings.length,1);
 assert.equal(await h.store.get('htmlTrainingStates','rop-one_participant'),null);
});

test('folder changes racing an existing reading revoke writes and preserve progress',async()=>{
 const h=await setup();const begun=await h.exec('BEGIN',{trainingId:'rop-one',requestId:'begin-folder'});
 h.store.beforeCommit=()=>h.store.seed('htmlTrainingSettings','folders',{version:1,disabled:[JSON.stringify(['ROPs'])]});
 await assert.rejects(h.exec('READ',{trainingId:'rop-one',runId:begun.state.run.id,index:0}),{code:'FORBIDDEN'});
 assert.equal((await h.store.get('htmlTrainingStates','rop-one_participant')).run.readCount,0);
});
