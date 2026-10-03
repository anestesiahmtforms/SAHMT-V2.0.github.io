// Evaluation reads never use the legacy scores collection or the privileged integration.
async function store() {
  const [{db}, sdk] = await Promise.all([import('./firebase.js'), import('firebase/firestore')]);
  if (!db) throw new Error('A integração de avaliação não está disponível.');
  return {db, sdk};
}
const categories = ['PERFORMANCE', 'GOVERNANCE'];
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const httpsList = value => Array.isArray(value) && value.length <= 10 && value.every(item => {
  try { const url = new URL(item); return text(item, 1, 1500) && url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
});
const keys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString().slice(0, 10) === value;

/** Browser input is a request, never proof of a response, identity, grade or award. */
export function validateEvaluationRequest(type, payload) {
  let valid = false;
  if (type === 'RECONCILE_LINKS') valid = keys(payload, []);
  if (type === 'ASSIGN_MANAGER') valid = keys(payload, ['areaId', 'managerUid', 'expectedVersion']) && validId(payload.areaId) && validId(payload.managerUid) && integer(payload.expectedVersion);
  if (type === 'CONFIGURE_ACTIVITY') valid = keys(payload, ['activityId', 'creditScopeId', 'version', 'modalities', 'acknowledgementItemId', 'suggestionProblemItemId', 'suggestionProposalItemId', 'suggestionBenefitItemId', 'validFrom', 'validUntil', 'eligibleUids', 'managerAreaId', 'expectedVersion'], ['acknowledgementValue', 'materialUrls']) && validId(payload.activityId) && validId(payload.creditScopeId) && integer(payload.version) && payload.version > 0 && integer(payload.expectedVersion) && validId(payload.managerAreaId) && keys(payload.modalities, ['acknowledgement', 'suggestion', 'test']) && Object.values(payload.modalities).every(value => typeof value === 'boolean') && Object.values(payload.modalities).some(Boolean) && ['acknowledgementItemId', 'suggestionProblemItemId', 'suggestionProposalItemId', 'suggestionBenefitItemId'].every(key => typeof payload[key] === 'string' && /^[A-Za-z0-9_-]{0,200}$/.test(payload[key])) && date(payload.validFrom) && date(payload.validUntil) && payload.validFrom <= payload.validUntil && Array.isArray(payload.eligibleUids) && payload.eligibleUids.length > 0 && payload.eligibleUids.length <= 500 && payload.eligibleUids.every(validId) && (!Object.hasOwn(payload, 'acknowledgementValue') || text(payload.acknowledgementValue, 1, 200)) && (!Object.hasOwn(payload, 'materialUrls') || httpsList(payload.materialUrls));
  if (type === 'CORRECT_SCORE') valid = keys(payload, ['awardId', 'category', 'expectedAwardVersion', 'correctedPoints', 'reason']) && validId(payload.awardId) && categories.includes(payload.category) && integer(payload.expectedAwardVersion) && typeof payload.correctedPoints === 'number' && Number.isFinite(payload.correctedPoints) && Math.abs(payload.correctedPoints) <= 100000 && text(payload.reason, 8, 1000);
  if (type === 'REVIEW_SUGGESTION') valid = keys(payload, ['participationId', 'decision', 'note']) && validId(payload.participationId) && ['APPROVE', 'REJECT'].includes(payload.decision) && text(payload.note, 8, 1000);
  if (type === 'REVIEW_GOVERNANCE') valid = keys(payload, ['revisionId', 'decision', 'note']) && validId(payload.revisionId) && ['APPROVE', 'REJECT'].includes(payload.decision) && text(payload.note, 8, 1000);
  if (type === 'REQUEST_GOVERNANCE') valid = keys(payload, ['activityId', 'areaId', 'assignmentId', 'previousVersion', 'newVersion', 'summary', 'components', 'materialEvidence', 'questionEvidence']) && ['activityId', 'areaId', 'assignmentId'].every(key => validId(payload[key])) && integer(payload.previousVersion) && integer(payload.newVersion) && payload.newVersion > payload.previousVersion && text(payload.summary, 8, 2000) && Array.isArray(payload.components) && payload.components.length >= 1 && payload.components.length <= 2 && new Set(payload.components).size === payload.components.length && payload.components.every(value => ['MATERIAL', 'QUESTIONS'].includes(value)) && httpsList(payload.materialEvidence) && httpsList(payload.questionEvidence) && (!payload.components.includes('MATERIAL') || payload.materialEvidence.length > 0) && (!payload.components.includes('QUESTIONS') || payload.questionEvidence.length > 0);
  if (!valid) throw new Error('Confira os campos e a versão da solicitação de avaliação.');
  return payload;
}

async function actor(store, uid) {
  if (!validId(uid)) throw new Error('A sessão expirou. Entre novamente.');
  const snap = await store.sdk.getDocFromServer(store.sdk.doc(store.db, 'users', uid));
  const profile = snap.exists() ? snap.data() : null;
  if (!profile?.active || !profile.access) throw new Error('Seu acesso foi revogado.');
  return {...profile, uid, isAdmin: profile.role === 'administrador_app' || profile.permissions?.admin === true};
}
const rows = snapshot => snapshot.docs.map(doc => ({...doc.data(), id: doc.id}));
async function listAll({db, sdk}, name, filters = []) {
  const items = []; let cursor = null;
  do {
    const snap = await sdk.getDocsFromServer(sdk.query(sdk.collection(db, name), ...filters, sdk.orderBy(sdk.documentId()), ...(cursor ? [sdk.startAfter(cursor)] : []), sdk.limit(250)));
    items.push(...rows(snap)); cursor = snap.docs.length === 250 ? snap.docs.at(-1) : null;
  } while (cursor);
  return items;
}

/** Cleanup is synchronous even if closed before Firebase finishes loading. */
export function watchEvaluation({actorUid, subjectUid = actorUid, category = 'PERFORMANCE', loadedLimit = 200, onData, onError}) {
  let closed = false; const releases = [], values = new Map(), metadata = new Map();
  const stop = () => { if (closed) return; closed = true; releases.splice(0).forEach(release => release()); values.clear(); metadata.clear(); };
  const fail = error => { if (closed) return; stop(); onError?.(error); };
  const count = Math.max(1, Math.min(5000, Number.isSafeInteger(loadedLimit) ? loadedLimit : 200));
  Promise.resolve().then(async () => {
    if (!validId(actorUid) || !validId(subjectUid) || !categories.includes(category) || typeof onData !== 'function') throw new Error('Escopo de avaliação inválido.');
    const service = await store(); if (closed) return;
    const {db, sdk} = service;
    const profile = await actor(service, actorUid); if (closed) return;
    if (subjectUid !== actorUid && !profile.isAdmin) throw new Error('Você pode consultar somente sua avaliação.');
    const privateQuery = (name, field = 'uid', extra = []) => sdk.query(sdk.collection(db, name), sdk.where(field, '==', subjectUid), ...extra);
    const sources = [
      ['summary', sdk.doc(db, 'evaluationSummaries', subjectUid), false],
      ['reference', sdk.doc(db, 'evaluationReference', 'team'), false],
      ['ledger', privateQuery('evaluationLedger', 'uid', [sdk.where('category', '==', category), sdk.orderBy('createdAt', 'desc'), sdk.limit(count + 1)]), true],
      ['awards', privateQuery('evaluationAwards', 'uid', [sdk.where('category', '==', category)]), true],
      ['requests', privateQuery('evaluationRequests', 'actorUid'), true],
      ...(category === 'PERFORMANCE' ? [['participations', privateQuery('evaluationParticipations'), true]] : [['revisions', privateQuery('evaluationGovernanceRevisions'), true]])
    ];
    for (const [key, ref, multiple] of sources) {
      if (closed) break;
      const release = sdk.onSnapshot(ref, {includeMetadataChanges: true}, snap => {
        if (closed) return;
        values.set(key, multiple ? rows(snap) : snap.exists() ? {...snap.data(), id: snap.id} : null);
        metadata.set(key, {fromCache: snap.metadata?.fromCache !== false, pending: snap.metadata?.hasPendingWrites === true || snap.docs?.some(doc => doc.metadata?.hasPendingWrites === true)});
        const ready = metadata.size === sources.length;
        const ledger = values.get('ledger') || [];
        onData({summary: values.get('summary') || null, reference: values.get('reference') || null, ledger: ledger.slice(0, count), hasMore: ledger.length > count, loadedLimit: count,
          awards: values.get('awards') || [], participations: values.get('participations') || [], revisions: values.get('revisions') || [], requests: values.get('requests') || [],
          fromCache: !ready || [...metadata.values()].some(item => item.fromCache), pendingWrites: [...metadata.values()].some(item => item.pending), complete: ready});
      }, fail);
      if (closed) release(); else releases.push(release);
    }
  }).catch(fail);
  return stop;
}

export async function listEvaluationActivities(actorUid) {
  const service = await store(), profile = await actor(service, actorUid), {sdk} = service;
  if (profile.isAdmin) return listAll(service, 'evaluationActivities');
  const [eligible, managed] = await Promise.all([listAll(service, 'evaluationActivities', [sdk.where('eligibleUids', 'array-contains', actorUid)]), listAll(service, 'evaluationActivities', [sdk.where('managerUid', '==', actorUid)])]);
  return [...new Map([...eligible, ...managed].map(item => [item.id, item])).values()];
}
export async function listEvaluationPeople(actorUid) {
  const service = await store(), profile = await actor(service, actorUid);
  if (!profile.isAdmin) throw new Error('A seleção de usuários exige acesso administrativo.');
  return (await listAll(service, 'users')).map(item => ({id: item.id, uid: item.id, displayName: item.displayName || item.name || item.sigla || item.id, sigla: item.sigla || '', active: item.active === true && item.access === true}));
}
export async function listEvaluationAssignments(actorUid) {
  const service = await store(), profile = await actor(service, actorUid);
  return listAll(service, 'evaluationAssignments', profile.isAdmin ? [] : [service.sdk.where('uid', '==', actorUid)]);
}
export async function listEvaluationReviewQueue(actorUid) {
  const service = await store(), profile = await actor(service, actorUid), {sdk} = service;
  const names = ['evaluationParticipations', 'evaluationGovernanceRevisions', 'evaluationRequests', 'evaluationActivities', 'evaluationLinks', 'evaluationAssignments'];
  const filters = profile.isAdmin ? names.map(() => []) : [[sdk.where('managerUid', '==', actorUid)], [sdk.where('uid', '==', actorUid)], [sdk.where('actorUid', '==', actorUid)], [sdk.where('managerUid', '==', actorUid)], null, [sdk.where('uid', '==', actorUid)]];
  if (!profile.isAdmin && profile.permissions?.managementManage) filters[0] = [];
  const results = await Promise.all(names.map((name, index) => filters[index] === null ? [] : listAll(service, name, filters[index])));
  if (!profile.isAdmin && profile.permissions?.qualityManage && !profile.permissions?.managementManage) {
    const quality = await listAll(service, names[0], [sdk.where('areaIds', 'array-contains', 'area-gestao-da-qualidade')]);
    results[0] = [...new Map([...results[0], ...quality].map(item => [item.id, item])).values()];
  }
  return Object.fromEntries(['participations', 'revisions', 'requests', 'activities', 'links', 'assignments'].map((name, index) => [name, results[index]]));
}
export async function submitEvaluationRequest(type, payload, actorUid, {requestId = crypto.randomUUID().replaceAll('-', '')} = {}) {
  validateEvaluationRequest(type, payload);
  if (!validId(requestId)) throw new Error('Identificador da solicitação inválido.');
  if (globalThis.navigator?.onLine === false) throw new Error('Conecte-se para enviar a solicitação. Seu rascunho foi preservado.');
  const service = await store(); await actor(service, actorUid); const {sdk, db} = service;
  const ref = sdk.doc(db, 'evaluationRequests', requestId);
  // Repeating this action reuses its ID. A completed request is never reset to PENDING.
  await sdk.runTransaction(db, async transaction => {
    const current = await transaction.get(ref);
    if (current.exists()) {
      const old = current.data();
      if (old.actorUid !== actorUid || old.type !== type || canonical(old.payload) !== canonical(payload)) throw new Error('Este identificador pertence a outra solicitação.');
      return;
    }
    transaction.set(ref, {id: requestId, type, actorUid, payload, status: 'PENDING', createdAt: sdk.serverTimestamp()});
  });
  return requestId;
}
