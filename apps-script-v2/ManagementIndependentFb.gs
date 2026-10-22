/* Independent Google Auth; data routing only. No broker, token exchange,
 * scheduled profile refresh, billing, user creation or source deletion. */
const SAHMT_INDEPENDENT_FB_RELEASE = 'fb-independent-20261022-v1';
let sahmtIndependentFbEvidence_ = null;
function managementIndependentFbEnabled_() {
  return sahmtV2Properties_().getProperty('SAHMT_V2_MANAGEMENT_FB_RELEASE') === SAHMT_INDEPENDENT_FB_RELEASE;
}
function managementIndependentFbEvidence_(allowMigration) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + SAHMT_EVALUATION_FB + '/databases/(default)/documents/evaluationRuntime/independentFbCutover';
  const response = firestoreRequest_(url, {method:'get'});
  const state = firestoreFieldsToJs_(response.fields || {});
  if (state.release !== SAHMT_INDEPENDENT_FB_RELEASE || !((allowMigration && state.status==='MIGRATING') || state.status==='ACTIVE') || state.sourceProjectId !== SAHMT_V2_CONFIG.projectId ||
      state.destinationProjectId !== SAHMT_EVALUATION_FB || state.authentication !== 'INDEPENDENT_GOOGLE' || state.brokerEnabled !== false ||
      state.qmentumProjectId !== SAHMT_V2_CONFIG.projectId || !/^[a-f0-9]{64}$/.test(state.sourceHash || '') ||
      !Number.isSafeInteger(state.verifiedDocuments) || state.verifiedDocuments < 1) throw Error('INDEPENDENT_FB_CUTOVER_NOT_VERIFIED');
  return state;
}
function managementIndependentFbAssert_() {
  if (!managementIndependentFbEnabled_()) throw Error('INDEPENDENT_FB_DISABLED');
  if (!sahmtIndependentFbEvidence_) sahmtIndependentFbEvidence_ = managementIndependentFbEvidence_();
  return sahmtIndependentFbEvidence_;
}
function ativarGestaoDesempenhoFbV1() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw Error('INDEPENDENT_FB_ACTIVATION_BUSY');
  try {
    // Existing explicit operator allowlist remains authoritative.
    evaluationAssertOperator_(false);
    const proof = managementIndependentFbEvidence_(true);
    sahmtV2Properties_().setProperty('SAHMT_V2_MANAGEMENT_FB_RELEASE', SAHMT_INDEPENDENT_FB_RELEASE);
    sahmtIndependentFbEvidence_ = proof.status==='ACTIVE'?proof:null;
    const code=proof.status==='ACTIVE'?'INDEPENDENT_FB_BACKEND_ACTIVE':'INDEPENDENT_FB_BACKEND_ARMED';
    console.log(JSON.stringify({code:code,verifiedDocuments:proof.verifiedDocuments,qmentumProject:'FA',brokerEnabled:false,sourceDeletes:0}));
    return {code:code};
  } finally { lock.releaseLock(); }
}
function conferirGestaoDesempenhoFbV1() {
  const active = managementIndependentFbEnabled_();
  if (active) managementIndependentFbAssert_();
  const report = {code:active?'INDEPENDENT_FB_BACKEND_ACTIVE':'INDEPENDENT_FB_BACKEND_PREPARED',evaluationProject:evaluationProject_(),qmentumProject:SAHMT_V2_CONFIG.projectId,brokerEnabled:false};
  console.log(JSON.stringify(report));return report;
}
// QMENTUM records remain in FA. Only the verified award reaches the FB ledger.
// The FB receipt makes a retry after a lost FA acknowledgement idempotent.
function qmDeliverFbParticipation_(id) {
  managementIndependentFbAssert_();
  const receiptId = 'fa-qmentum-' + sha256Hex_(id);
  const delivered = evaluationRunTransaction_(function(tx) {
    const event=evaluationGet_('qmentumScoreOutbox',id,tx),p=evaluationGet_('qmentumParticipations',id,tx);
    if (!event || !p || event.participationId!==id || !['PENDING','DELIVERED'].includes(event.status) ||
        !['CONFIRMED','APPROVED'].includes(p.status)) throw Error('QMENTUM_SCORE_SOURCE_INVALID');
    const review=p.modality==='SUGGESTION'?evaluationGet_('qmentumParticipationReviews',id,tx):null;
    qmParticipationIdentity_(p.actorUid,p.unitId,tx,false);
    if (review) qmParticipationIdentity_(review.actorUid,p.unitId,tx,true);
    const plan=qmParticipationPlan_(p,review),analysis=qmParticipationAnalysis_(p,tx),award=qmParticipationAward_(p,review,analysis,id);
    const fingerprint=sha256Hex_(evaluationDeliveryCanonical_(award));
    if (!plan.points || plan.status!==p.status || fingerprint!==event.fingerprint) throw Error('QMENTUM_SCORE_SOURCE_CONFLICT');
    const receipt=evaluationGet_('evaluationSourceReceipts',receiptId,tx);
    if (receipt) {
      if (receipt.fingerprint!==fingerprint) throw Error('QMENTUM_SCORE_SOURCE_CONFLICT');
      return {writes:[],result:{fingerprint:fingerprint,points:plan.points}};
    }
    const applied=evaluationApplyAwards_([award],{transaction:tx});
    if (applied.status==='NEEDS_REVIEW') throw Error('QMENTUM_SCORE_REVIEW_REQUIRED');
    applied.writes.push(evaluationWrite_('evaluationSourceReceipts',receiptId,{sourceProjectId:SAHMT_V2_CONFIG.projectId,sourceId:id,fingerprint:fingerprint,points:plan.points},null,['createdAt']));
    return {writes:applied.writes,result:{fingerprint:fingerprint,points:plan.points}};
  });
  evaluationPublishCategorySummary_('PERFORMANCE');
  return checklistSourceTransaction_(function(tx) {
    const event=evaluationGet_('qmentumScoreOutbox',id,tx),p=evaluationGet_('qmentumParticipations',id,tx);
    if (!event || !p || event.fingerprint!==delivered.fingerprint) throw Error('QMENTUM_SCORE_SOURCE_CONFLICT');
    if (event.status==='DELIVERED') return {writes:[],result:{code:'QMENTUM_SCORE_DELIVERED'}};
    return {writes:[evaluationWrite_('qmentumScoreOutbox',id,{status:'DELIVERED'},event,['deliveredAt']),
      evaluationWrite_('qmentumParticipations',id,{confirmedPoints:delivered.points,scoreStatus:'CONFIRMED'},p,['scoreConfirmedAt'])],result:{code:'QMENTUM_SCORE_DELIVERED'}};
  });
}
