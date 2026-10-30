import { documentGroupsFromAccess, normalizeDocumentAccessEmail } from '../src/document-access.js';
import {trainingPathAllowed,trainingCategories,trainingAccessPath} from '../src/html-training-folders.js';
import {Buffer} from 'node:buffer';
import { finalizeRopAudit } from '../src/domain/rop-audit.js';
import { copy, documentSize, fail, identifier, publication, text, version } from './domain-validation.js';
import {buildReadingPlan} from './reading-plan.js';
import {startReading,readingProgress,assertReadingComplete} from './reading-state.js';

const C = Object.freeze({ training: 'htmlTrainings', versions: 'htmlTrainingVersions', content: 'htmlTrainingContent',
  state: 'htmlTrainingStates', score: 'htmlTrainingScores', audits: 'htmlTrainingAudits', sync: 'htmlTrainingSync' });
const managedActions = new Set(['EDIT', 'REVIEW', 'AUDIT_LIST', 'AUDIT_SAVE']);
const actions = new Set(['LIST', 'SCORE', 'OPEN', 'CONTENT', 'BEGIN', 'READ', 'ACK', 'QUIZ', 'SUBMIT', 'EDIT', 'PUBLISH', 'REVIEW', 'AUDIT_LIST', 'AUDIT_SAVE', 'SET_FOLDER_ACCESS','READING_START','READING_PROGRESS']);
const admin = profile => profile.role === 'administrador_app' || profile.permissions?.admin === true;
const manages = (profile, training, uid) => admin(profile) || training.managerUid === uid;
const emptyState = (trainingId, uid) => ({ uid, trainingId, attempts: [], bestScore: 0, ackPoints: 0, suggestionDecision: null, version: 0, run: null });
const selectedQuestions = privateVersion => privateVersion.selectedQuestionIds.map(id => privateVersion.bank.find(q => q.id === id));
const participantQuestions = privateVersion => selectedQuestions(privateVersion).map(q => ({ id: q.id, stem: q.stem, options: copy(q.options), points: q.points }));
const publicTraining = (training, profile, uid) => {
  const fields = ['id', 'title', 'category', 'subcategory', 'audienceGroup', 'managerUid', 'status', 'version', 'sectionCount', 'selectedQuestionIds', 'maxScore', 'updatedAt'];
  return { ...Object.fromEntries(fields.filter(k => training[k] !== undefined).map(k => [k, copy(training[k])])), canManage: manages(profile, training, uid), hasAudit: training.hasAudit === true };
};
const publicState = (state, training) => ({ ...copy(state), ...(state.run && state.run.stage !== 'COMPLETED' && state.run.trainingVersion !== training.version ? { run: null, versionChanged: true } : {}) });
const itemScore = state => ({ acknowledgement: state.ackPoints, test: state.bestScore, suggestion: state.suggestionDecision?.points || 0 });
const total = score => score.acknowledgement + score.test + score.suggestion;
const getMany = (tx, collection, ids) => typeof tx.getMany === 'function' ? tx.getMany(collection, ids) : Promise.all(ids.map(id => tx.get(collection, id)));
export function contentParts(sections) {
  const bytes=Buffer.from(JSON.stringify(sections)),parts=[];
  for(let start=0;start<bytes.length;){
    let end=Math.min(start+180000,bytes.length);
    while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
    parts.push(bytes.subarray(start,end).toString('utf8'));start=end;
  }
  return parts;
}

function checkedIdentity(identity) {
  if (!identity || identity.emailVerified !== true || identity.provider !== 'google.com') fail('UNAUTHENTICATED', 401);
  try { identifier(identity.uid); return { uid: identity.uid, email: normalizeDocumentAccessEmail(identity.email) }; }
  catch { fail('UNAUTHENTICATED', 401); }
}

/**
 * Trusted, storage-independent domain service. transaction callbacks may retry;
 * they perform no external side effects and create all writes atomically.
 */
export function createHtmlTrainingService({ store, now = Date.now, uuid = () => globalThis.crypto.randomUUID(), readingRequired = false } = {}) {
  if (!store || !['get', 'list', 'transaction'].every(method => typeof store[method] === 'function')) throw new TypeError('TRAINING_STORE_REQUIRED');

  async function authorize(tx, identity) {
    const profile = await tx.get('users', identity.uid);
    if (!profile || profile.active !== true || profile.access !== true || (profile.uid && profile.uid !== identity.uid)) fail('FORBIDDEN', 403);
    const access = await tx.get('documentAccessEmails', identity.email);
    const settings=await tx.get('htmlTrainingSettings','folders');
    return { profile, groups: documentGroupsFromAccess(access, identity.email), folderAccess:{version:settings?.version||0,disabled:settings?.disabled||[]} }; 
  }
  function canRead(auth, training, uid) {
    const path=trainingAccessPath(training);
    if(!admin(auth.profile)&&!trainingPathAllowed(auth.folderAccess,path))return false;
    return manages(auth.profile, training, uid) || training.status === 'PUBLISHED' && auth.groups.includes(training.audienceGroup);
  }
  async function getVersion(tx, training) {
    const snapshot = await tx.get(C.versions, `${training.id}_v${training.version}`);
    if (!snapshot) fail('CONTENT_UNAVAILABLE', 503);
    return snapshot;
  }
  async function getReadingPlan(tx,training){
    const snapshot=await getVersion(tx,training);
    const plan=snapshot.readingPlan||await tx.get('htmlTrainingReadingPlans',`${training.id}_v${training.version}`);
    if(!plan||plan.schemaVersion!==1||!Array.isArray(plan.blocks)||typeof plan.hash!=='string')fail('TRAINING_READING_PLAN_UNAVAILABLE',503);
    return plan;
  }
  async function sectionsFor(tx, training, snapshot) {
    let sections = [];
    const chunks = await getMany(tx, C.content, Array.from({ length: snapshot.chunkCount }, (_, i) => `${training.id}_v${training.version}_p${i}`));
    for (const [i, chunk] of chunks.entries()) {
      if (!chunk || chunk.trainingId !== training.id || chunk.version !== training.version || chunk.index !== i) fail('CONTENT_UNAVAILABLE', 503);
      if(snapshot.contentEncoding==='JSON_UTF8_CHUNKS_V1') { if(typeof chunk.part!=='string')fail('CONTENT_UNAVAILABLE',503); }
      else {if(!Array.isArray(chunk.sections))fail('CONTENT_UNAVAILABLE',503);sections.push(...chunk.sections);}
    }
    if(snapshot.contentEncoding==='JSON_UTF8_CHUNKS_V1') {try{sections=JSON.parse(chunks.map(chunk=>chunk.part).join(''));}catch{fail('CONTENT_UNAVAILABLE',503);}if(!Array.isArray(sections))fail('CONTENT_UNAVAILABLE',503);}
    if (sections.length !== training.sectionCount) fail('CONTENT_UNAVAILABLE', 503);
    return sections;
  }
  async function updateScore(tx, state, timestamp) {
    const existing = await tx.get(C.score, state.uid);
    const items = { ...(existing?.items || {}), [state.trainingId]: itemScore(state) };
    const score = { uid: state.uid, acknowledgement: 0, test: 0, suggestion: 0, total: 0, version: (existing?.version || 0) + 1, items, updatedAt: timestamp };
    for (const item of Object.values(items)) {
      score.acknowledgement += item.acknowledgement; score.test += item.test; score.suggestion += item.suggestion;
    }
    score.total = total(score); documentSize(score);
    return score;
  }
  const saveState = (tx, state, timestamp) => { state.version++; state.updatedAt = timestamp; documentSize(state); tx.set(C.state, `${state.trainingId}_${state.uid}`, state); };

  async function execute(action, input = {}, principal) {
    const identity = checkedIdentity(principal);
    if (!actions.has(action) || !input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT');
    documentSize(input, 10000000);
    const timestamp = now(); if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError('TRAINING_CLOCK_INVALID');
    // Collection queries discover candidate IDs only. Each returned document,
    // profile and assignment is read again inside the authorization transaction.
    let candidates = [];
    if (action === 'LIST') {
      // Preflight avoids scanning the catalog for a revoked account.
      await store.transaction(tx => authorize(tx, identity));
      candidates = await store.list(C.training, [], 1000);
    } else if (action === 'EDIT' || action === 'AUDIT_LIST') {
      identifier(input.trainingId);
      await store.transaction(async tx => {
        const auth = await authorize(tx, identity), training = await tx.get(C.training, input.trainingId);
        if (!training) fail('NOT_FOUND', 404);
        if (!manages(auth.profile, training, identity.uid)) fail('FORBIDDEN', 403);
      });
      candidates = await store.list(action === 'EDIT' ? C.state : C.audits, [{ field: 'trainingId', op: 'EQUAL', value: input.trainingId }], 1000);
    }
    const publish = action === 'PUBLISH' ? publication(input) : null;
    const runId = action === 'BEGIN' ? identifier(uuid()) : null;
    return store.transaction(async tx => {
      const auth = await authorize(tx, identity);
      if(action==='SET_FOLDER_ACCESS'){
        if(!admin(auth.profile))fail('FORBIDDEN',403);
        const path=input.path;
        if(!Array.isArray(path)||path.length<1||path.length>2||!trainingCategories.includes(path[0])||path.some(value=>typeof value!=='string'||!value.trim()||value.length>160)||typeof input.enabled!=='boolean')fail('INVALID_INPUT');
        version(input.expectedVersion);
        if(input.expectedVersion!==auth.folderAccess.version)fail('VERSION_CONFLICT',409);
        const key=JSON.stringify(path),disabled=new Set(auth.folderAccess.disabled);
        if(input.enabled)disabled.delete(key);else disabled.add(key);
        const folderAccess={version:auth.folderAccess.version+1,disabled:[...disabled].sort()};
        documentSize(folderAccess);
        tx.set('htmlTrainingSettings','folders',{...folderAccess,updatedAt:timestamp,updatedByUid:identity.uid});
        return {folderAccess};
      }
      if (action === 'SCORE') {
        const uid = input.subjectUid === undefined ? identity.uid : identifier(input.subjectUid);
        if (uid !== identity.uid && !admin(auth.profile)) fail('FORBIDDEN', 403);
        const projection = await tx.get(C.score, uid);
        const fields = ['uid', 'acknowledgement', 'test', 'suggestion', 'total', 'version', 'items', 'updatedAt'];
        const score = projection ? Object.fromEntries(fields.map(field => [field, copy(projection[field])])) :
          { uid, acknowledgement: 0, test: 0, suggestion: 0, total: 0, version: 0, items: {}, updatedAt: null };
        if (score.uid !== uid) fail('SCORE_UNAVAILABLE', 503);
        score.items = Object.fromEntries(Object.entries(score.items).map(([id, item]) => [id,
          { acknowledgement: item.acknowledgement, test: item.test, suggestion: item.suggestion }]));
        const ids = Object.keys(score.items).sort();
        const metadata = ids.length ? await getMany(tx, C.training, ids.map(identifier)) : [];
        const trainings = ids.map((trainingId, index) => {
          const item = score.items[trainingId];
          return { trainingId, title: metadata[index]?.title || trainingId, acknowledgement: item.acknowledgement,
            test: item.test, suggestion: item.suggestion, total: total(item) };
        });
        return { score, trainings };
      }
      if (action === 'LIST') {
        const trainings = [];
        for (const training of await getMany(tx, C.training, candidates.map(candidate => identifier(candidate.id)))) {
          if (training && canRead(auth, training, identity.uid)) trainings.push(publicTraining(training, auth.profile, identity.uid));
        }
        return { trainings: trainings.sort((a, b) => a.title.localeCompare(b.title)),folderAccess:auth.folderAccess,canManageFolders:admin(auth.profile) };
      }
      const trainingId = identifier(input.trainingId);
      const training = await tx.get(C.training, trainingId);

      if(training&&!admin(auth.profile)&&!trainingPathAllowed(auth.folderAccess,trainingAccessPath(training)))fail('FORBIDDEN',403);
      if (action === 'PUBLISH') {
        if (!training && !admin(auth.profile) || training && !manages(auth.profile, training, identity.uid)) fail('FORBIDDEN', 403);
        if (publish.training.managerUid === '' && !admin(auth.profile) || input.deferInstitutionalReview === true && !admin(auth.profile)) fail('FORBIDDEN', 403);
        if (training && !admin(auth.profile) && publish.training.managerUid !== training.managerUid) fail('FORBIDDEN', 403);
        if ((training?.version || 0) !== publish.expectedVersion) fail('VERSION_CONFLICT', 409);
        if (publish.training.managerUid) {
          const manager = await tx.get('users', publish.training.managerUid);
          if (!manager || manager.active !== true || manager.access !== true) fail('INVALID_MANAGER');
        }
        if (training) {
          const prior = await getVersion(tx, training);
          if (prior.bank.some(q => !publish.privateVersion.bank.some(next => next.id === q.id))) fail('BANK_QUESTIONS_REMOVED');
          if (!admin(auth.profile) && JSON.stringify(publish.training.source) !== JSON.stringify(training.source || {})) fail('FORBIDDEN', 403);
        }
        if(publish.training.status==='PUBLISHED'&&publish.training.source.pendingInstitutionalReview===true&&input.institutionalReviewConfirmed===true){
          publish.training.source.pendingInstitutionalReview=false;
          publish.training.source.institutionalReview={uid:identity.uid,at:timestamp};
        }
        if(publish.training.status==='PUBLISHED'&&publish.training.source.pendingInstitutionalReview===true&&input.deferInstitutionalReview===true){
          publish.training.source.pendingReviewPublication={uid:identity.uid,at:timestamp,reason:text(input.reviewDeferralReason,2000)};
        }
        const nextVersion = publish.expectedVersion + 1, id = `${trainingId}_v${nextVersion}`;
        const metadata = { ...publish.training, version: nextVersion, sectionCount: publish.sections.length,
          selectedQuestionIds: [...publish.privateVersion.selectedQuestionIds], maxScore: selectedQuestions(publish.privateVersion).reduce((sum, q) => sum + q.points, 0),
          hasAudit: !!publish.privateVersion.auditSchema, createdAt: training?.createdAt ?? timestamp, createdByUid: training?.createdByUid ?? identity.uid,
          updatedAt: timestamp, updatedByUid: identity.uid, syncStatus: 'PENDING' };
        if(training?.importPending)metadata.importPending=copy(training.importPending).filter(item=>
          !(metadata.status==='PUBLISHED'&&item.code==='MANAGER_ASSIGNMENT_REQUIRED')&&
          !(input.institutionalReviewConfirmed===true&&['SOURCE_REVIEW_REQUIRED','INSTITUTIONAL_REVIEW_REQUIRED'].includes(item.code)));
        if(training?.initialImportSha256)metadata.initialImportSha256=training.initialImportSha256;
        const parts=contentParts(publish.sections);
        const snapshot = { id, trainingId, version: nextVersion, ...publish.privateVersion,
          ...(readingRequired?{readingPlan:buildReadingPlan(publish.sections)}:{}),
          training: copy(metadata), sectionCount: publish.sections.length, chunkCount: parts.length, contentEncoding:'JSON_UTF8_CHUNKS_V1',
          createdAt: timestamp, createdByUid: identity.uid, previousVersion: publish.expectedVersion };
        documentSize(snapshot);
        // Transport chunks preserve reading sections, including images larger
        // than one Firestore document. Version/content IDs remain create-only.
        tx.create(C.versions, id, snapshot);
        parts.forEach((part, index) => {
          const chunk = { id: `${id}_p${index}`, trainingId, version: nextVersion, index, part };
          documentSize(chunk); tx.create(C.content, chunk.id, chunk);
        });
        tx.set(C.training, trainingId, metadata);
        tx.create(C.sync, id, { id, trainingId, version: nextVersion, status: 'PENDING', source: copy(metadata.source), expectedSourceRevisions: copy(metadata.source.revisions || {}), createdAt: timestamp, createdByUid: identity.uid, attempts: 0 });
        return { training: { ...copy(metadata), canManage: true } };
      }

      if (!training) fail('NOT_FOUND', 404);
      if (managedActions.has(action)) {
        if (!manages(auth.profile, training, identity.uid)) fail('FORBIDDEN', 403);
      } else if (!canRead(auth, training, identity.uid)) fail('FORBIDDEN', 403);

      if (action === 'AUDIT_LIST') {
        const audits = [];
        for (const audit of await getMany(tx, C.audits, candidates.map(candidate => identifier(candidate.id)))) {
          if (audit?.trainingId === trainingId) audits.push(audit);
        }
        return { audits: audits.sort((a, b) => b.updatedAt - a.updatedAt) };
      }

      if (action === 'EDIT') {
        const snapshot = await getVersion(tx, training), sections = await sectionsFor(tx, training, snapshot), suggestions = [];
        for (const state of await getMany(tx, C.state, candidates.map(candidate => `${trainingId}_${identifier(candidate.uid)}`))) {
          if (state?.trainingId === trainingId && state.attempts.some(attempt => attempt.suggestion?.trim())) suggestions.push({ uid: state.uid, version: state.version, attempts: copy(state.attempts), suggestionDecision: copy(state.suggestionDecision) });
        }
        return { training: { ...copy(training), canManage: true }, bank: copy(snapshot.bank), sections, auditSchema: copy(snapshot.auditSchema), suggestions };
      }

      if (action === 'AUDIT_SAVE') {
        const id = identifier(input.id); version(input.expectedVersion);
        if (typeof input.complete !== 'boolean' || !input.draft || typeof input.draft !== 'object' || Array.isArray(input.draft)) fail('INVALID_INPUT');
        const prior = await tx.get(C.audits, id);
        if (prior && prior.trainingId !== trainingId) fail('FORBIDDEN', 403);
        if (prior?.status === 'completed') fail('AUDIT_IMMUTABLE', 409);
        if ((prior?.version || 0) !== input.expectedVersion) fail('VERSION_CONFLICT', 409);
        const snapshot = await getVersion(tx, training);
        if (!snapshot.auditSchema) fail('AUDIT_UNAVAILABLE', 404);
        if (prior && prior.trainingVersion !== training.version) fail('VERSION_CHANGED', 409);
        if (input.draft.trainingId && input.draft.trainingId !== trainingId) fail('AUDIT_INVALID');
        // Discard client-controlled lifecycle/score fields and capture the model
        // used. Audit completion never reads or writes a score projection.
        const draft = { trainingId };
        for (const field of ['context', 'answers', 'checks', 'actions', 'cases', 'evidence', 'validation']) if (input.draft[field] !== undefined) draft[field] = copy(input.draft[field]);
        for (const field of ['actions', 'cases', 'evidence']) if (draft[field] !== undefined && !Array.isArray(draft[field])) fail('AUDIT_INVALID');
        let value = draft;
        if (input.complete) {
          let finalized;
          try { finalized = finalizeRopAudit({ ...snapshot.auditSchema, trainingId }, draft, timestamp); }
          catch { fail('AUDIT_INVALID'); }
          if (!finalized.ok) fail('AUDIT_INVALID');
          value = finalized.audit;
        }
        const audit = { ...value, id, status: input.complete ? 'completed' : 'draft', version: input.expectedVersion + 1, trainingVersion: training.version,
          schemaVersion: snapshot.auditSchema.version ?? training.version, createdAt: prior?.createdAt ?? timestamp, createdByUid: prior?.createdByUid ?? identity.uid,
          updatedAt: timestamp, updatedByUid: identity.uid, history: [...(prior ? [{ version: prior.version, updatedAt: prior.updatedAt, updatedByUid: prior.updatedByUid,
            draft: Object.fromEntries(['context', 'answers', 'checks', 'actions', 'cases', 'evidence', 'validation'].filter(k => prior[k] !== undefined).map(k => [k, copy(prior[k])])) }] : [])] };
        if(prior){
          // Immutable revisions live separately; autosaves must not repeatedly
          // embed every previous body into the current Firestore document.
          const previous=Object.fromEntries(Object.entries(prior).filter(([key])=>key!=='history'));
          documentSize(previous);tx.create('htmlTrainingAuditHistory',`${id}_v${prior.version}`,previous);
        }
        documentSize(audit); tx.set(C.audits, id, audit); return { audit };
      }

      const uid = action === 'REVIEW' ? identifier(input.uid) : identity.uid;
      const state = await tx.get(C.state, `${trainingId}_${uid}`) || emptyState(trainingId, uid);

      if (action === 'REVIEW') {
        version(input.expectedVersion);
        if (uid === identity.uid) fail('SELF_REVIEW', 403);
        if (typeof input.points !== 'number' || !Number.isFinite(input.points) || input.points < 0 || input.points > 2) fail('INVALID_INPUT');
        const note = text(input.note ?? '', 8000, true);
        if (state.version !== input.expectedVersion) fail('VERSION_CONFLICT', 409);
        if (!state.attempts.some(attempt => attempt.suggestion?.trim())) fail('NO_SUGGESTION', 409);
        if (state.suggestionDecision && !admin(auth.profile)) fail('ALREADY_REVIEWED', 409);
        const previous = state.suggestionDecision;
        state.suggestionDecision = { points: input.points, note, decidedAt: timestamp, decidedByUid: identity.uid,
          history: [...(previous?.history || []), ...(previous ? [Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'history'))] : [])] };
        const score = await updateScore(tx, state, timestamp);
        saveState(tx, state, timestamp); tx.set(C.score, uid, score); return { state, score };
      }

      if (action === 'OPEN') {
        const snapshot = await getVersion(tx, training);
        return { training: publicTraining(training, auth.profile, uid), questions: participantQuestions(snapshot), state: publicState(state, training),...(readingRequired?{readingPlan:await getReadingPlan(tx,training)}:{}) };
      }
      if (action === 'CONTENT') {
        version(input.version);
        if (input.version !== training.version) fail('VERSION_CHANGED', 409);
        const snapshot = await getVersion(tx, training);
        return { sections: await sectionsFor(tx, training, snapshot), revision: training.version };
      }
      if (training.status !== 'PUBLISHED') fail('NOT_PUBLISHED', 409);
      if (action === 'BEGIN') {
        const requestId = identifier(input.requestId);
        if (state.attempts.some(attempt => attempt.beginRequestId === requestId)) return { state: publicState(state, training) };
        if (state.run && state.run.stage !== 'COMPLETED' && state.run.trainingVersion === training.version) return { state };
        if (state.attempts.length >= 2) fail('ATTEMPT_LIMIT', 409);
        state.run = { id: runId, trainingVersion: training.version, readCount: 0, stage: 'READING', beginRequestId: requestId, startedAt: timestamp };
        saveState(tx, state, timestamp); return { state };
      }

      const submittedRunId = identifier(input.runId);
      if (action === 'SUBMIT') {
        const requestId = identifier(input.requestId), suggestion = text(input.suggestion ?? '', 8000, true);
        const prior = state.attempts.find(attempt => attempt.runId === submittedRunId || attempt.requestId === requestId);
        if (prior) {
          if (prior.runId !== submittedRunId || prior.suggestion !== suggestion) fail('IDEMPOTENCY_CONFLICT', 409);
          const score = await tx.get(C.score, uid);
          if (!score) fail('SCORE_UNAVAILABLE', 503);
          return { state: publicState(state, training), score };
        }
      }
      if (!state.run || state.run.id !== submittedRunId) fail('RUN_CONFLICT', 409);
      if (state.run.trainingVersion !== training.version) fail('VERSION_CHANGED', 409);
      const run = state.run;

      if(readingRequired){
        const plan=await getReadingPlan(tx,training);
        if(action==='READING_START'){
          if(run.stage==='COMPLETED')fail('STAGE_CONFLICT',409);
          startReading(run,plan,input,timestamp);saveState(tx,state,timestamp);return {state};
        }
        if(action==='READING_PROGRESS'){
          if(run.stage!=='READING')fail('STAGE_CONFLICT',409);
          if(readingProgress(run,plan,input,timestamp))saveState(tx,state,timestamp);
          return {state};
        }
        assertReadingComplete(run,plan,action==='READ'?input.index:undefined);
      }else if(action==='READING_START'||action==='READING_PROGRESS')fail('TRAINING_READING_NOT_ENABLED',409);

      if (action === 'READ') {
        if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= training.sectionCount) fail('INVALID_INPUT');
        if (input.index < run.readCount) return { state };
        if (run.stage !== 'READING') fail('STAGE_CONFLICT', 409);
        if (input.index !== run.readCount) fail('READ_ORDER', 409);
        run.readCount++;
        if (run.readCount === training.sectionCount) run.stage = 'ACK';
      } else if (action === 'ACK') {
        if (input.accepted !== true) fail('INVALID_INPUT');
        if (['QUIZ', 'SUGGESTIONS', 'COMPLETED'].includes(run.stage)) return { state };
        if (run.stage !== 'ACK' || run.readCount !== training.sectionCount) fail('STAGE_CONFLICT', 409);
        run.stage = 'QUIZ'; run.acknowledgedAt = timestamp;
      } else if (action === 'QUIZ') {
        if (!['QUIZ', 'SUGGESTIONS'].includes(run.stage)) fail('STAGE_CONFLICT', 409);
        const answers = input.answers, snapshot = await getVersion(tx, training), questions = selectedQuestions(snapshot);
        if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== 5 || questions.some(q => !Object.hasOwn(answers, q.id) || !q.options.some(o => o.id === answers[q.id]))) fail('INVALID_ANSWERS');
        if (run.stage === 'SUGGESTIONS') {
          if (questions.some(q => run.answers[q.id] !== answers[q.id])) fail('STAGE_CONFLICT', 409);
          return { state };
        }
        run.answers = Object.fromEntries(questions.map(q => [q.id, answers[q.id]])); run.stage = 'SUGGESTIONS';
      } else if (action === 'SUBMIT') {
        if (run.stage !== 'SUGGESTIONS' || run.readCount !== training.sectionCount || !run.acknowledgedAt) fail('STAGE_CONFLICT', 409);
        if (state.attempts.length >= 2) fail('ATTEMPT_LIMIT', 409);
        const snapshot = await getVersion(tx, training), questions = selectedQuestions(snapshot);
        if (!run.answers || questions.some(q => !q.options.some(o => o.id === run.answers[q.id]))) fail('INVALID_ANSWERS');
        const points = questions.reduce((sum, q) => sum + (run.answers[q.id] === q.correctOptionId ? q.points : 0), 0);
        state.attempts.push({ runId: run.id, beginRequestId: run.beginRequestId, requestId: input.requestId, trainingVersion: run.trainingVersion,
          answers: copy(run.answers), score: points, maxScore: training.maxScore, suggestion: input.suggestion ?? '', acknowledgedAt: run.acknowledgedAt, completedAt: timestamp });
        state.bestScore = Math.max(state.bestScore, points); state.ackPoints = 1;
        run.stage = 'COMPLETED'; run.completedAt = timestamp;
        const score = await updateScore(tx, state, timestamp);
        saveState(tx, state, timestamp); tx.set(C.score, uid, score); return { state, score };
      } else fail('INVALID_INPUT');
      saveState(tx, state, timestamp); return { state };
    });
  }
  return Object.freeze({ execute });
}
