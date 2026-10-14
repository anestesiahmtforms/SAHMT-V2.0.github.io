import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './evaluation-fb-harness.js';
const profile = uid => ({uid, active: true, access: true});
function pending(h, {same = false, day = '2026-10-03'} = {}) {
  const responsibleUid = 'fixture-a', signerUid = same ? responsibleUid : 'fixture-b';
  h.seed('users', responsibleUid, profile(responsibleUid)); h.seed('users', signerUid, profile(signerUid));
  const snapshot = {date: day, responsibleUid, entries: []}, revision = h.ctx.checklistStoredSnapshotRevision_(snapshot);
  const signature = {id: day + '_' + revision, date: day, responsibleUid, signerUid, revision, snapshot, declaration: true};
  const requestId = day + '_' + signerUid;
  h.ctx.checklistSourceTransaction_(tx => {
    const queued = h.ctx.evaluationQueueChecklistDelivery_(signature, requestId, tx);
    queued.writes.push(h.ctx.evaluationWrite_('checklistSignatures', signature.id, signature, null, ['signedAt']));
    queued.writes.push(h.ctx.evaluationWrite_('checklistSignatureRequests', requestId,
      {id: requestId, signerUid, status: 'VALIDATED', finalSignatureId: signature.id, evaluationStatus: 'PENDING_FB'}, null, ['validatedAt']));
    return {writes: queued.writes, result: true};
  });
  return {id: h.values('checklistScoreOutbox').at(-1).id, requestId, signature};
}
test('default remains FA; invalid project fails closed', () => {
  const h = harness({project:'FA'}); assert.equal(h.ctx.evaluationProject_(),'sahmt-17a16');
  h.properties.set('SAHMT_V2_EVALUATION_PROJECT_ID','arbitrary'); assert.throws(()=>h.ctx.evaluationProject_(),/PROJECT_INVALID/);
});

test('all management producers share FB while operational and identity sources stay FA',()=>{
 const h=harness();
 for(const collection of ['managementAreas','activities','activityInteractions','activityScoreReviews','indicators',
 'indicatorMeasurements','actionPlans','actionPlanItems','documents','scopedDocuments','equipment','equipmentEvents',
 'maintenanceRecords','scoringRules','scores','learningActivities','learningActivityReceipts','trainings','trainingProgress',
 'trainingReceipts','trainingCompletions','evaluationFormConfigs']) assert.equal(h.ctx.evaluationCollectionProject_(collection),'sahmt-gestao-5ae66');
 for(const collection of ['users','documentAccessEmails','checklists','checklistSignatures','events','labels','scheduleDays'])
 assert.equal(h.ctx.evaluationCollectionProject_(collection),'sahmt-17a16');
 for(const collection of ['occurrenceReports','occurrenceAudit','occurrenceScoreClaims'])
 assert.equal(h.ctx.evaluationCollectionProject_(collection),'indicadores---sahmt');
 assert.equal(h.ctx.evaluationCursorProperty_('CURSOR'),'CURSOR_FB');
 h.properties.delete('SAHMT_V2_EVALUATION_PROJECT_ID');assert.equal(h.ctx.evaluationCursorProperty_('CURSOR'),'CURSOR');
});
test('FA evidence/outbox and FB paired scoring are separated and repeatable', () => {
  const h=harness(), e=pending(h);
  assert.equal(h.values('evaluationLedger').length,0);
  h.ctx.evaluationDeliverChecklistEvent_(e.id); h.ctx.evaluationDeliverChecklistEvent_(e.id);
  assert.deepEqual(h.values('evaluationLedger').map(x=>x.points).sort(),[-1,1]);
  assert.equal(h.values('evaluationSourceReceipts').length,1);
  assert.equal(h.data('checklistScoreOutbox',e.id).status,'DELIVERED');
  assert.equal(h.data('checklistSignatureRequests',e.requestId).pointsAwarded,1);
  for(const [path] of h.store) {
    if (/\/evaluation[A-Z]/.test(path)) assert.match(path,/projects\/sahmt-gestao-5ae66\//);
    if (/\/(users|checklistSignatures|checklistScoreOutbox)\//.test(path)) assert.match(path,/projects\/sahmt-17a16\//);
  }
});
test('scheduled person receives no credit and no debit', () => {
  const h=harness(),e=pending(h,{same:true}); h.ctx.evaluationDeliverChecklistEvent_(e.id);
  assert.deepEqual(h.values('evaluationLedger').map(x=>x.points),[0]);
  assert.equal(h.data('checklistSignatureRequests',e.requestId).pointsAwarded,0);
});
test('FB outage leaves FA conference and pending delivery intact', () => {
  const h=harness(),e=pending(h),original=h.ctx.firestoreRequest_;
  h.ctx.firestoreRequest_=(url,o)=>{if(url.includes('/sahmt-gestao-5ae66/'))throw Object.assign(new Error('offline'),{status:503});return original(url,o);};
  assert.throws(()=>h.ctx.evaluationDeliverChecklistEvent_(e.id));
  assert.equal(h.data('checklistScoreOutbox',e.id).status,'PENDING'); assert.ok(h.data('checklistSignatures',e.signature.id));
  h.ctx.firestoreRequest_=original; h.ctx.evaluationDeliverChecklistEvent_(e.id); assert.equal(h.values('evaluationLedger').length,2);
});
test('lost FA acknowledgement retries FB receipt without duplicate points', () => {
  const h=harness(),e=pending(h),original=h.ctx.firestoreRequest_;let fail=true;
  h.ctx.firestoreRequest_=(url,o)=>{
    const b=JSON.parse(o?.payload||'{}');
    if(fail && url.endsWith(':commit') && b.writes?.some(w=>w.update.name.includes('/checklistScoreOutbox/'))) {fail=false;throw new Error('lost acknowledgement');}
    return original(url,o);
  };
  assert.throws(()=>h.ctx.evaluationDeliverChecklistEvent_(e.id));assert.equal(h.values('evaluationLedger').length,2);
  h.ctx.evaluationDeliverChecklistEvent_(e.id);assert.equal(h.values('evaluationLedger').length,2);assert.equal(h.data('checklistScoreOutbox',e.id).status,'DELIVERED');
});
test('tampered event or unapproved source cannot produce points', () => {
  for (const mutate of [
    (h,e)=>{const x=h.data('checklistScoreOutbox',e.id);x.payload.signerUid='attacker';h.seed('checklistScoreOutbox',e.id,x);},
    (h,e)=>h.seed('checklistSignatureRequests',e.requestId,{id:e.requestId,status:'PENDING_VALIDATION',signerUid:e.signature.signerUid,finalSignatureId:e.signature.id}),
    h=>h.seed('users','fixture-b',{uid:'fixture-b',active:false,access:false})
  ]) {const h=harness(),e=pending(h);mutate(h,e);assert.throws(()=>h.ctx.evaluationDeliverChecklistEvent_(e.id));assert.equal(h.values('evaluationLedger').length,0);}
});
test('field order returned by Firestore does not invalidate canonical payload',()=>{
  const h=harness(),e=pending(h),x=h.data('checklistScoreOutbox',e.id);x.payload=Object.fromEntries(Object.entries(x.payload).reverse());h.seed('checklistScoreOutbox',e.id,x);
  h.ctx.evaluationDeliverChecklistEvent_(e.id);assert.equal(h.values('evaluationLedger').length,2);
});
test('mixed-project commit is rejected before writing',()=>{
  const h=harness();assert.throws(()=>h.ctx.evaluationRunTransaction_(()=>({writes:[h.ctx.evaluationWrite_('users','x',{active:true},null)],result:true})),/CROSS_PROJECT_WRITE/);
  assert.equal(h.data('users','x'),null);
});
test('drain uses bounded FA pending query and skips delivered events',()=>{
  const h=harness(),e=pending(h);assert.equal(h.ctx.evaluationDrainChecklistDeliveries_().delivered,1);
  assert.equal(h.ctx.evaluationDrainChecklistDeliveries_().delivered,0);
  const q=h.requests.filter(r=>r.body.structuredQuery?.from[0]?.collectionId==='checklistScoreOutbox');assert.ok(q.every(r=>r.body.structuredQuery.limit===20 && r.url.includes('/sahmt-17a16/')));
});
