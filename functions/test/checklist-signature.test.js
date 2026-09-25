import assert from 'node:assert/strict';
import {after, before, beforeEach, describe, it} from 'node:test';
import {getAuth} from 'firebase-admin/auth';
import {initializeApp, deleteApp} from 'firebase-admin/app';
import {Timestamp, getFirestore} from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-sahmt-v2';
const authBase = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const functionBase = (name) => `http://127.0.0.1:5001/${projectId}/southamerica-east1/${name}`;
const app = initializeApp({projectId}, 'checklist-signature-tests');
const db = getFirestore(app);
let userCounter = 0;

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function createAuthUser({verified = true} = {}) {
  const email = `checklist-${Date.now()}-${++userCounter}@example.test`;
  const user = await getAuth(app).createUser({email, password: 'test-password-123', emailVerified: verified});
  const customToken = await getAuth(app).createCustomToken(user.uid);
  const signInResponse = await fetch(`${authBase}/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({token: customToken, returnSecureToken: true})
  });
  const signedIn = await signInResponse.json();
  assert.equal(signInResponse.ok, true, JSON.stringify(signedIn));
  return {uid: user.uid, idToken: signedIn.idToken, email};
}

async function callFunction(idToken, data, name = 'checklistSignature') {
  const response = await fetch(functionBase(name), {
    method: 'POST',
    headers: {authorization: `Bearer ${idToken}`, 'content-type': 'application/json'},
    body: JSON.stringify({data})
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message || `Callable returned HTTP ${response.status}`);
    error.status = body.error?.status;
    throw error;
  }
  return body.result;
}

async function clearCollection(name) {
  const rows = await db.collection(name).get();
  await Promise.all(rows.docs.map((row) => row.ref.delete()));
}

async function resetData() {
  for (const name of ['users', 'scheduleDays', 'stations', 'vacations', 'events', 'contacts', 'checklists', 'checklistSignatures', 'scores', 'trainings', 'trainingReceipts', 'trainingCompletions', 'trainingProgress', 'managementAreas', 'activities', 'activityInteractions', 'scoringRules']) {
    await clearCollection(name);
  }
}

async function seedBase({signer, responsible, stationCount = 1, answerCount = stationCount, positions} = {}) {
  const day = todayInSaoPaulo();
  const selectedSigner = signer || await createAuthUser();
  const selectedResponsible = responsible || await createAuthUser();
  const samePerson = selectedSigner.uid === selectedResponsible.uid;
  const signerPermissions = signer?.permissions || {checklistSign: true};
  await db.doc(`users/${selectedSigner.uid}`).set({
    uid: selectedSigner.uid, email: selectedSigner.email, displayName: 'Assinante de teste',
    ...(samePerson ? {sigla: 'CR'} : {}),
    role: 'temporario', active: true, access: true, permissions: signerPermissions
  });
  if (!samePerson) await db.doc(`users/${selectedResponsible.uid}`).set({
    uid: selectedResponsible.uid, email: selectedResponsible.email, displayName: 'Responsável de teste',
    sigla: 'CR', role: 'temporario', active: true, access: true, permissions: {}
  });
  await db.doc(`scheduleDays/${day}`).set({
    id: day, date: day, positions: positions || [{position: 1, sigla: 'CR'}, {position: 2, sigla: 'LH'}]
  });
  await db.doc('contacts/CR').set({sigla: 'CR', name: 'Responsável de teste', email: selectedResponsible.email, active: true});
  for (let index = 0; index < stationCount; index++) {
    const id = `station-${index + 1}`;
    await db.doc(`stations/${id}`).set({id, name: `Estação ${index + 1}`, active: true, start: '', end: '', order: index + 1, version: 1});
    if (index < answerCount) {
      await db.doc(`checklists/response-${index + 1}`).set({
        id: `response-${index + 1}`, stationId: id, date: day, condition: 'SIM', occurrence: '',
        createdAt: Timestamp.fromMillis(Date.now() + index), createdByUid: selectedSigner.uid
      });
    }
  }
  return {day, signer: selectedSigner, responsible: selectedResponsible};
}

describe('checklistSignature callable', () => {
  before(async () => {
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Start Firestore Emulator before this suite.');
    assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Start Auth Emulator before this suite.');
    await resetData();
  });
  beforeEach(resetData);
  after(async () => {
    await resetData();
    await deleteApp(app);
  });

  it('previews the server snapshot, signs that revision immutably, and makes retries idempotent', async () => {
    const {day, signer, responsible} = await seedBase();
    const preview = await callFunction(signer.idToken, {day, mode: 'preview'});
    assert.equal(preview.missing, 0);
    assert.equal(preview.total, 1);
    assert.equal(preview.responsible.uid, responsible.uid);
    assert.equal(preview.responsible.sigla, 'CR');
    assert.match(preview.revision, /^[a-f0-9]{64}$/);

    const result = await callFunction(signer.idToken, {
      day, mode: 'sign', revision: preview.revision, declaration: true,
      justification: 'Assinatura realizada por responsável de teste autorizado.'
    });
    assert.equal(result.signed, true);
    assert.equal(result.pointsAwarded, 1);
    assert.equal(result.responsibleAdjustment, -1);
    const signatureId = `${day}_${preview.revision}`;
    const stored = (await db.doc(`checklistSignatures/${signatureId}`).get()).data();
    assert.equal(stored.signerUid, signer.uid);
    assert.equal(stored.responsibleUid, responsible.uid);
    assert.equal(stored.snapshot.entries.length, 1);
    assert.equal(typeof stored.signedAt.toMillis(), 'number');
    const scores = (await db.collection('scores').where('sourceId', '==', signatureId).get()).docs.map((row) => row.data());
    assert.deepEqual(Object.fromEntries(scores.map(({uid, ruleId, points}) => [ruleId, {uid, points}])), {
      'checklist-daily-responsible-v1': {uid: responsible.uid, points: 1},
      'checklist-daily-substitution-adjustment-v1': {uid: responsible.uid, points: -1},
      'checklist-daily-substitute-v1': {uid: signer.uid, points: 1}
    });

    const duplicate = await callFunction(signer.idToken, {
      day, mode: 'sign', revision: preview.revision, declaration: true,
      justification: 'Assinatura realizada por responsável de teste autorizado.'
    });
    assert.equal(duplicate.alreadySigned, true);
    assert.equal((await db.collection('checklistSignatures').get()).size, 1);
    assert.equal((await db.collection('scores').get()).size, 3);
  });

  it('awards exactly one point when the responsible person signs a complete report', async () => {
    const person = await createAuthUser();
    const {day} = await seedBase({signer: person, responsible: person});
    const preview = await callFunction(person.idToken, {day, mode: 'preview'});
    const result = await callFunction(person.idToken, {
      day, mode: 'sign', revision: preview.revision, declaration: true
    });
    assert.equal(result.pointsAwarded, 1);
    assert.equal(result.responsibleAdjustment, 0);
    const scores = await db.collection('scores').get();
    assert.equal(scores.size, 1);
    assert.equal(scores.docs[0].data().uid, person.uid);
    assert.equal(scores.docs[0].data().points, 1);
  });

  it('rejects a signature if a response changes after preview', async () => {
    const {day, signer} = await seedBase();
    const preview = await callFunction(signer.idToken, {day, mode: 'preview'});
    await db.doc('checklists/response-1').update({createdAt: Timestamp.fromMillis(Date.now() + 5000)});
    await assert.rejects(
      callFunction(signer.idToken, {day, mode: 'sign', revision: preview.revision, declaration: true}),
      (error) => error.status === 'FAILED_PRECONDITION'
    );
    assert.equal((await db.collection('checklistSignatures').get()).size, 0);
  });

  it('requires a justification for incomplete reports', async () => {
    const {day, signer} = await seedBase({stationCount: 2, answerCount: 1});
    const preview = await callFunction(signer.idToken, {day, mode: 'preview'});
    assert.equal(preview.missing, 1);
    await assert.rejects(
      callFunction(signer.idToken, {day, mode: 'sign', revision: preview.revision, declaration: true}),
      (error) => error.status === 'INVALID_ARGUMENT'
    );
    const result = await callFunction(signer.idToken, {
      day, mode: 'sign', revision: preview.revision, declaration: true, justification: 'Estação indisponível para conferência.'
    });
    assert.equal(result.signed, true);
    assert.equal(result.pointsAwarded, 0);
    assert.equal(result.pointsPending, true);
    assert.equal((await db.collection('scores').get()).size, 0);
  });

  it('rejects unverified identities and profiles without checklistSign', async () => {
    const {day, signer} = await seedBase();
    const unverified = await createAuthUser({verified: false});
    await db.doc(`users/${unverified.uid}`).set({
      uid: unverified.uid, email: unverified.email, active: true, access: true,
      role: 'temporario', permissions: {checklistSign: true}
    });
    await assert.rejects(
      callFunction(unverified.idToken, {day, mode: 'preview'}),
      (error) => error.status === 'PERMISSION_DENIED'
    );

    const unauthorized = await createAuthUser();
    await db.doc(`users/${unauthorized.uid}`).set({
      uid: unauthorized.uid, email: unauthorized.email, active: true, access: true,
      role: 'temporario', permissions: {checklistRead: true}
    });
    await assert.rejects(
      callFunction(unauthorized.idToken, {day, mode: 'preview'}),
      (error) => error.status === 'PERMISSION_DENIED'
    );
    assert.ok(signer.uid);
  });

  it('fails closed when the first scheduled sigla has no unique active V2 profile', async () => {
    const {day, signer} = await seedBase({positions: [{position: 1, sigla: 'ZZ'}]});
    await assert.rejects(
      callFunction(signer.idToken, {day, mode: 'preview'}),
      (error) => error.status === 'FAILED_PRECONDITION'
    );
  });

  it('uses the next scheduled UID when vacation or a substitution removes the first sigla', async () => {
    const {day, signer} = await seedBase();
    await db.doc('users/lh-responsible').set({
      uid: 'lh-responsible', email: 'lh@example.test', displayName: 'Responsável LH',
      sigla: 'LH', role: 'temporario', active: true, access: true, permissions: {}
    });
    await db.doc(`vacations/vacation-${day}`).set({
      id: `vacation-${day}`, start: day, end: day, siglas: ['CR'], label: 'CR', active: true
    });
    const preview = await callFunction(signer.idToken, {day, mode: 'preview'});
    assert.equal(preview.responsible.uid, 'lh-responsible');
    assert.equal(preview.responsible.sigla, 'LH');
    assert.equal(preview.responsible.position, 2);
  });

  it('uses the next scheduled UID when an active substitution removes the first sigla', async () => {
    const {day, signer} = await seedBase();
    await db.doc('users/lh-responsible').set({
      uid: 'lh-responsible', email: 'lh@example.test', displayName: 'Responsável LH',
      sigla: 'LH', role: 'temporario', active: true, access: true, permissions: {}
    });
    await db.doc(`events/substitution-${day}`).set({
      id: `substitution-${day}`, date: day, memberStatus: 'CR', eventType: 'Pessoal',
      substitute: 'LH', active: true
    });
    const preview = await callFunction(signer.idToken, {day, mode: 'preview'});
    assert.equal(preview.responsible.uid, 'lh-responsible');
    assert.equal(preview.responsible.sigla, 'LH');
    assert.equal(preview.responsible.position, 2);
  });

  it('awards configured training access points once and keeps an immutable receipt', async () => {
    const person = await createAuthUser();
    const trainingId = `training-${Date.now()}-${++userCounter}`;
    await db.doc(`users/${person.uid}`).set({
      uid: person.uid, email: person.email, displayName: 'Participante de teste',
      role: 'temporario', active: true, access: true, permissions: {trainingsRead: true}
    });
    await db.doc(`trainings/${trainingId}`).set({
      id: trainingId, title: 'Treinamento de teste', active: true, accessPoints: 3,
      completionPoints: 5, version: 2
    });

    const first = await callFunction(person.idToken, {trainingId}, 'trainingStart');
    assert.deepEqual(first, {started: true, alreadyStarted: false, pointsAwarded: 3});
    const receipt = (await db.collection('trainingReceipts').where('uid', '==', person.uid).get()).docs[0].data();
    assert.equal(receipt.trainingId, trainingId);
    assert.equal(receipt.trainingVersion, 2);
    assert.equal(receipt.completionPoints, 5);
    assert.equal(typeof receipt.startedAt.toMillis(), 'number');
    const scoreDocs = await db.collection('scores').where('uid', '==', person.uid).get();
    assert.equal(scoreDocs.size, 1);
    assert.equal(scoreDocs.docs[0].data().points, 3);
    assert.equal(scoreDocs.docs[0].data().ruleId, 'training-access-v1');

    const retry = await callFunction(person.idToken, {trainingId}, 'trainingStart');
    assert.deepEqual(retry, {started: true, alreadyStarted: true, pointsAwarded: 0});
    assert.equal((await db.collection('trainingReceipts').get()).size, 1);
    assert.equal((await db.collection('scores').where('uid', '==', person.uid).get()).size, 1);
  });

  it('validates training access and awards no points for inactive catalogs or unauthorized profiles', async () => {
    const person = await createAuthUser();
    const trainingId = `training-${Date.now()}-${++userCounter}`;
    await db.doc(`users/${person.uid}`).set({
      uid: person.uid, email: person.email, role: 'temporario', active: true, access: true, permissions: {}
    });
    await db.doc(`trainings/${trainingId}`).set({id: trainingId, active: false, accessPoints: 10, completionPoints: 0});
    await assert.rejects(callFunction(person.idToken, {trainingId}, 'trainingStart'), (error) => error.status === 'PERMISSION_DENIED');
    await db.doc(`users/${person.uid}`).update({permissions: {trainingsRead: true}});
    await assert.rejects(callFunction(person.idToken, {trainingId}, 'trainingStart'), (error) => error.status === 'NOT_FOUND');
    await db.doc(`trainings/${trainingId}`).update({active: true, accessPoints: 0});
    const started = await callFunction(person.idToken, {trainingId}, 'trainingStart');
    assert.equal(started.pointsAwarded, 0);
    assert.equal((await db.collection('trainingReceipts').get()).size, 1);
    assert.equal((await db.collection('scores').get()).size, 0);
  });

  it('completes training at 95 percent, honors the start snapshot, and awards once', async () => {
    const person = await createAuthUser();
    const trainingId = `training-complete-${Date.now()}-${++userCounter}`;
    await db.doc(`users/${person.uid}`).set({
      uid: person.uid, email: person.email, role: 'temporario', active: true, access: true, permissions: {trainingsRead: true}
    });
    await db.doc(`trainings/${trainingId}`).set({
      id: trainingId, title: 'Treinamento de conclusão', active: true, accessPoints: 0,
      completionPoints: 5, version: 2
    });
    await callFunction(person.idToken, {trainingId}, 'trainingStart');
    const progressRef = db.doc(`trainingProgress/${person.uid}_${trainingId}`);
    await progressRef.set({
      uid: person.uid, trainingId, startedAt: Timestamp.now(), lastPosition: 120,
      watchedRanges: [{start: 0, end: 114}], duration: 120, status: 'IN_PROGRESS', updatedAt: Timestamp.now()
    });
    await db.doc(`trainings/${trainingId}`).update({completionPoints: 9, version: 3});

    const first = await callFunction(person.idToken, {trainingId, ended: true}, 'completeTraining');
    assert.deepEqual(first, {completed: true, alreadyCompleted: false, pointsAwarded: 5, watchedPercent: 95});
    const progress = (await progressRef.get()).data();
    assert.equal(progress.status, 'COMPLETED');
    assert.equal(typeof progress.completedAt.toMillis(), 'number');
    const completions = await db.collection('trainingCompletions').where('uid', '==', person.uid).get();
    assert.equal(completions.size, 1);
    assert.equal(completions.docs[0].data().trainingVersion, 2);
    assert.equal(completions.docs[0].data().points, 5);
    const scores = await db.collection('scores').where('uid', '==', person.uid).get();
    assert.equal(scores.size, 1);
    assert.equal(scores.docs[0].data().points, 5);
    assert.equal(scores.docs[0].data().ruleId, 'training-completion-v1');

    const retry = await callFunction(person.idToken, {trainingId, ended: true}, 'completeTraining');
    assert.deepEqual(retry, {completed: true, alreadyCompleted: true, pointsAwarded: 0, watchedPercent: 95});
    assert.equal((await db.collection('trainingCompletions').get()).size, 1);
    assert.equal((await db.collection('scores').get()).size, 1);
  });

  it('rejects training completion without player end or saved 95 percent progress', async () => {
    const person = await createAuthUser();
    const trainingId = `training-incomplete-${Date.now()}-${++userCounter}`;
    await db.doc(`users/${person.uid}`).set({
      uid: person.uid, email: person.email, role: 'temporario', active: true, access: true, permissions: {trainingsRead: true}
    });
    await db.doc(`trainings/${trainingId}`).set({
      id: trainingId, title: 'Treinamento incompleto', active: true, accessPoints: 0, completionPoints: 5, version: 1
    });
    await callFunction(person.idToken, {trainingId}, 'trainingStart');
    await db.doc(`trainingProgress/${person.uid}_${trainingId}`).set({
      uid: person.uid, trainingId, startedAt: Timestamp.now(), lastPosition: 120,
      watchedRanges: [{start: 0, end: 112}], duration: 120, status: 'IN_PROGRESS', updatedAt: Timestamp.now()
    });
    await assert.rejects(callFunction(person.idToken, {trainingId, ended: false}, 'completeTraining'),
      (error) => error.status === 'FAILED_PRECONDITION');
    await assert.rejects(callFunction(person.idToken, {trainingId, ended: true}, 'completeTraining'),
      (error) => error.status === 'FAILED_PRECONDITION' && error.message.includes('93.3%'));
    assert.equal((await db.doc(`trainingProgress/${person.uid}_${trainingId}`).get()).data().status, 'IN_PROGRESS');
    assert.equal((await db.collection('trainingCompletions').get()).size, 0);
    assert.equal((await db.collection('scores').get()).size, 0);
  });

  it('completes a managed task and awards its configured points once', async () => {
    const person = await createAuthUser();
    const activityId = `activity-${Date.now()}-${++userCounter}`;
    const ruleId = 'management-task-completion-v1';
    await db.doc(`users/${person.uid}`).set({
      uid: person.uid, email: person.email, role: 'temporario', active: true, access: true,
      permissions: {managementActivityWrite: true}
    });
    await db.doc('managementAreas/area-test').set({active: true, memberUids: [person.uid]});
    await db.doc(`scoringRules/${ruleId}`).set({
      id: ruleId, name: 'Conclusão', sourceType: 'MANAGEMENT_TASK_COMPLETION', points: 7, active: true, version: 1
    });
    await db.doc(`activities/${activityId}`).set({
      id: activityId, managementAreaId: 'area-test', createdByUid: 'manager-test', responsibleUids: [person.uid],
      status: 'IN_PROGRESS', active: true, evidenceRequired: false, pointsEnabled: true,
      points: 7, scoringRuleId: ruleId, scoringRuleVersion: 1, version: 2
    });
    await db.doc(`scoringRules/${ruleId}`).update({active: false, points: 11, version: 2});
    const first = await callFunction(person.idToken, {activityId}, 'completeManagementActivity');
    assert.deepEqual(first, {completed: true, alreadyCompleted: false, pointsAwarded: 7});
    const activity = (await db.doc(`activities/${activityId}`).get()).data();
    assert.equal(activity.status, 'COMPLETED');
    assert.equal(activity.version, 3);
    assert.equal((await db.collection('activityInteractions').get()).size, 1);
    assert.equal((await db.collection('activityInteractions').get()).docs[0].data().pointsGenerated, 7);
    const scoreDocs = await db.collection('scores').where('uid', '==', person.uid).get();
    assert.equal(scoreDocs.size, 1);
    assert.equal(scoreDocs.docs[0].data().points, 7);
    assert.equal(scoreDocs.docs[0].data().ruleId, ruleId);
    assert.equal(scoreDocs.docs[0].data().ruleVersion, 1);
    const retry = await callFunction(person.idToken, {activityId}, 'completeManagementActivity');
    assert.deepEqual(retry, {completed: true, alreadyCompleted: true, pointsAwarded: 0});
    assert.equal((await db.collection('scores').where('uid', '==', person.uid).get()).size, 1);
  });

  it('allows a member of an assigned team to complete a shared task only once', async () => {
    const firstMember = await createAuthUser();
    const secondMember = await createAuthUser();
    const activityId = `team-activity-${Date.now()}-${++userCounter}`;
    for (const person of [firstMember, secondMember]) {
      await db.doc(`users/${person.uid}`).set({
        uid: person.uid, email: person.email, role: 'temporario', active: true, access: true,
        permissions: {managementActivityWrite: true}
      });
    }
    await db.doc('managementAreas/area-team').set({active: true, memberUids: [firstMember.uid, secondMember.uid]});
    await db.doc(`activities/${activityId}`).set({
      id: activityId, managementAreaId: 'area-team', createdByUid: 'team-manager', responsibleUids: [firstMember.uid, secondMember.uid],
      status: 'IN_PROGRESS', active: true, evidenceRequired: false, pointsEnabled: false, version: 2
    });
    const first = await callFunction(firstMember.idToken, {activityId}, 'completeManagementActivity');
    assert.deepEqual(first, {completed: true, alreadyCompleted: false, pointsAwarded: 0});
    const replayFromSecondMember = await callFunction(secondMember.idToken, {activityId}, 'completeManagementActivity');
    assert.deepEqual(replayFromSecondMember, {completed: true, alreadyCompleted: true, pointsAwarded: 0});
    assert.equal((await db.doc(`activities/${activityId}`).get()).data().status, 'COMPLETED');
    assert.equal((await db.collection('activityInteractions').where('activityId', '==', activityId).get()).size, 1);
    assert.equal((await db.collection('scores').get()).size, 0);
  });

  it('cancels an open task once, records the audit event, and rejects unrelated users', async () => {
    const creator = await createAuthUser();
    const other = await createAuthUser();
    const activityId = `cancel-${Date.now()}-${++userCounter}`;
    for (const person of [creator, other]) {
      await db.doc(`users/${person.uid}`).set({
        uid: person.uid, email: person.email, role: 'temporario', active: true, access: true,
        permissions: {managementActivityWrite: true}
      });
    }
    await db.doc(`activities/${activityId}`).set({
      id: activityId, createdByUid: creator.uid, responsibleUids: [creator.uid],
      status: 'OPEN', active: true, version: 1, completedAt: null
    });
    const first = await callFunction(creator.idToken, {activityId}, 'cancelManagementActivity');
    assert.deepEqual(first, {cancelled: true, alreadyCancelled: false});
    const retry = await callFunction(creator.idToken, {activityId}, 'cancelManagementActivity');
    assert.deepEqual(retry, {cancelled: true, alreadyCancelled: true});
    assert.equal((await db.doc(`activities/${activityId}`).get()).data().status, 'CANCELLED');
    const audit = await db.collection('activityInteractions').get();
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].data().type, 'CANCELLATION');
    await db.doc(`activities/${activityId}-other`).set({
      id: `${activityId}-other`, createdByUid: creator.uid, responsibleUids: [creator.uid], status: 'IN_PROGRESS', active: true, version: 1
    });
    await assert.rejects(callFunction(other.idToken, {activityId: `${activityId}-other`}, 'cancelManagementActivity'),
      (error) => error.status === 'PERMISSION_DENIED');
    assert.equal((await db.collection('scores').get()).size, 0);
  });
});
