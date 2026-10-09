import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessManagementReadBudget, firestoreQuotaDayStart, describeManagementReadObservation, sourceUsageReviewUpperReads, sourceUsageReviewObservationSha256} from '../scripts/lib/management-read-budget.js';
const nowMs = Date.parse('2026-10-08T23:20:00.000Z');
const day = firestoreQuotaDayStart(nowMs);
const observation = {project: 'sahmt-17a16', metric: 'firestore.googleapis.com/document/read_ops_count', quotaDayStart: day, reads: 4109, verifiedAt: '2026-10-08T23:19:00.000Z', latestPoint: '2026-10-08T23:17:00.000Z', complete: true, fresh: true};
const policy = {schemaVersion: 1, projectId: 'sahmt-17a16', dailyReadLimit: 35000, quotaTimeZone: 'America/Los_Angeles', renewalClearsPause: false, pausedRequiresReview: false, authorizedPurpose: 'MANAGEMENT_BACKUP_ONLY', humanDecisionAt: '2026-10-08T23:10:00.000Z', appTrafficReserve: 5000, metricLagReserve: 2000, maximumCaptureReserve: 6000, reservationQuotaDayStart: day, reservedReads: 200};
const input = changes => ({projectId: 'sahmt-17a16', nowMs, observation, policy, maximumReads: 100, legacyReservedReads: 8000, ...changes});

function bindHumanReview(observation, policy, {evidenceId = policy.manualReviewEvidence,
  captureMessageId = 'synthetic-human-capture', decisionMessageId = 'synthetic-human-decision'} = {}) {
  const reviewed = {...structuredClone(observation), evidenceId, totalUsageKnown:false, measuredTotalReads:null};
  reviewed.captureProvenance = {schemaVersion:1, source:'HUMAN_USER_MESSAGE_ATTACHMENT',
    humanMessageId:captureMessageId, evidenceId, evidenceSha256:reviewed.evidenceSha256, capturedAt:reviewed.capturedAt};
  const approved = {...structuredClone(policy), manualReviewEvidence:evidenceId, manualReviewSha256:reviewed.evidenceSha256};
  approved.manualReviewAuthorization = {
    schemaVersion:1, authorized:true, authorizationSource:'EXPLICIT_HUMAN_FA_BACKUP_REVIEW',
    authorizationId:'synthetic-authorization-' + evidenceId, humanDecisionMessageId:decisionMessageId,
    projectId:'sahmt-17a16', authorizedPurpose:'MANAGEMENT_BACKUP_ONLY', dailyReadLimit:45000,
    quotaDayStart:reviewed.quotaDayStart, approvedAt:approved.humanDecisionAt,
    reviewedAt:reviewed.reviewedAt, capturedAt:reviewed.capturedAt, evidenceId,
    evidenceSha256:reviewed.evidenceSha256, observationSha256:sourceUsageReviewObservationSha256(reviewed),
    captureHumanMessageId:captureMessageId, captureSource:'HUMAN_USER_MESSAGE_ATTACHMENT'
  };
  return {observation:reviewed, policy:approved};
}

test('reserva a margem de app, atraso e trabalho anterior sem alterar entrada', () => {
  const before = JSON.stringify(input()), result = assessManagementReadBudget(input());
  assert.equal(result.estimatedWithMargin, 19409); assert.equal(result.reservedReads, 300); assert.equal(result.exactGlobalCutoff, false); assert.equal(JSON.stringify(input()), before);
});
test('renovação diária não limpa a pausa nem reutiliza decisão do dia anterior', () => {
  assert.throws(() => assessManagementReadBudget(input({policy: {...policy, pausedRequiresReview: true}})), /PAUSED/);
  assert.throws(() => assessManagementReadBudget(input({nowMs: Date.parse('2026-10-09T07:01:00Z')})), /CURRENT_DAY/);
  assert.throws(() => assessManagementReadBudget(input({policy: {...policy, reservationQuotaDayStart: '2026-10-07T07:00:00Z'}})), /DAY_REVIEW/);
});
test('fresh declarado não valida ponto antigo, captura incompleta ou relógio futuro', () => {
  for (const change of [{fresh: false}, {complete: false}, {latestPoint: '2026-10-08T21:14:00Z'}, {verifiedAt: '2026-10-08T23:21:00Z'}, {reads: -1}, {metric: 'firestore.googleapis.com/document/read_count'}]) {
    assert.throws(() => assessManagementReadBudget(input({observation: {...observation, ...change}})), /STALE_OR_INCOMPLETE/);
  }
});
test('falha fechada no limite, reserva excedida, projeto trocado ou finalidade indevida', () => {
  assert.throws(() => assessManagementReadBudget(input({observation: {...observation, reads: 19700}})), /DAILY_LIMIT/);
  assert.throws(() => assessManagementReadBudget(input({maximumReads: 5801})), /CAPTURE_RESERVE_LIMIT/);
  assert.throws(() => assessManagementReadBudget(input({projectId: 'sahmt-gestao-5ae66'})), /INVALID_MANAGEMENT_READ_POLICY/);
  assert.throws(() => assessManagementReadBudget(input({policy: {...policy, authorizedPurpose: 'TRAINING_RELEASE'}})), /NOT_AUTHORIZED/);
});
test('dia da cota usa Los Angeles inclusive transições de horário de verão', () => {
  assert.equal(firestoreQuotaDayStart(Date.parse('2026-03-08T20:00:00Z')), '2026-03-08T08:00:00.000Z');
  assert.equal(firestoreQuotaDayStart(Date.parse('2026-11-01T20:00:00Z')), '2026-11-01T07:00:00.000Z');
  assert.equal(day, '2026-10-08T07:00:00.000Z');
});
test("45 mil autorizado somente em FA preserva margem, pausa e teto FB", () => {
 const raised={...policy,dailyReadLimit:45000,limitApprovalEvidence:"USER_FA_DAILY_LIMIT_45000_2026_10_08"};
 const result=assessManagementReadBudget(input({policy:raised,observation:{...observation,reads:25000}}));
 assert.equal(result.estimatedWithMargin,40300);assert.equal(result.remainingAfterMargin,4700);
 assert.throws(()=>assessManagementReadBudget(input({policy:{...raised,pausedRequiresReview:true}})),/PAUSED/);
 assert.throws(()=>assessManagementReadBudget(input({policy:{...raised,limitApprovalEvidence:null}})),/INCREASE_NOT_AUTHORIZED/);
 assert.throws(()=>assessManagementReadBudget(input({policy:raised,observation:{...observation,reads:29700}})),/DAILY_LIMIT/);
 assert.throws(()=>assessManagementReadBudget(input({projectId:"sahmt-gestao-5ae66",policy:{...raised,projectId:"sahmt-gestao-5ae66"}})),/INVALID_MANAGEMENT_READ_POLICY/);
});

const manualNow=Date.parse("2026-10-09T01:04:10Z"), manualDay=firestoreQuotaDayStart(manualNow);
const legacyObservation={observationSource:"USER_CURRENT_USAGE_DASHBOARD_REVIEW",project:"sahmt-17a16",quotaDayStart:manualDay,capturedAt:"2026-10-09T01:01:02.000Z",reviewedAt:"2026-10-09T01:04:05.000Z",periodStart:"2026-10-08T01:01:02.000Z",periodKind:"LAST_24_HOURS",reads:5000,displayedEstimate:"4.1k",evidenceSha256:"a".repeat(64),exactGlobalCutoff:false};
const legacyPolicy={...policy,dailyReadLimit:45000,limitApprovalEvidence:"USER_FA_DAILY_LIMIT_45000_2026_10_08",manualReviewEvidence:"USER_PROVIDED_FA_USAGE_CAPTURE_2026_10_08_220102",manualReviewSha256:"a".repeat(64),humanDecisionAt:"2026-10-09T01:04:05Z"};
const {observation:manualObservation,policy:manualPolicy}=bindHumanReview(legacyObservation,legacyPolicy);
const manualInput=changes=>input({nowMs:manualNow,policy:manualPolicy,observation:manualObservation,...changes});
test("conferência humana atual só admite estimativa conservadora FA45k e guarda margens",()=>{const before=JSON.stringify(manualInput());const result=assessManagementReadBudget(manualInput());assert.equal(result.estimatedWithMargin,20300);assert.equal(result.remainingAfterMargin,24700);assert.equal(result.observationSource,"USER_CURRENT_USAGE_DASHBOARD_REVIEW");assert.equal(JSON.stringify(manualInput()),before);assert.throws(()=>assessManagementReadBudget(manualInput({policy:{...manualPolicy,pausedRequiresReview:true}})),/PAUSED/);assert.throws(()=>assessManagementReadBudget(manualInput({maximumReads:5801})),/CAPTURE_RESERVE/);});
test("conferência humana não inventa medição exata na prova",()=>{const result=describeManagementReadObservation(manualObservation);assert.equal(result.totalUsageKnown,false);assert.equal(result.measuredTotalReads,null);assert.equal(result.estimatedUpperReads,5000);assert.equal(result.evidenceSha256,manualObservation.evidenceSha256);assert.equal(result.capturedAt,manualObservation.capturedAt);});
test("conferência humana nega FB, teto35k, hashes, limites e fonte trocada",()=>{for(const change of [{projectId:"sahmt-gestao-5ae66",policy:{...manualPolicy,projectId:"sahmt-gestao-5ae66",dailyReadLimit:35000}},{policy:{...manualPolicy,dailyReadLimit:35000}},{policy:{...manualPolicy,manualReviewSha256:"b".repeat(64)}},{policy:{...manualPolicy,manualReviewEvidence:null}},{legacyReservedReads:32700}])assert.throws(()=>assessManagementReadBudget(manualInput(change)));});
test("conferência humana nega captura velha, futura, janela incompleta ou arredondamento diferente",()=>{for(const change of [{capturedAt:"2026-10-09T00:59:09Z",periodStart:"2026-10-08T00:59:09Z"},{capturedAt:"2026-10-09T01:05:00Z"},{capturedAt:"invalid"},{reviewedAt:"2026-10-09T01:05:00Z"},{periodStart:"2026-10-08T08:00:00Z"},{periodKind:"CURRENT_LOCAL_DAY"},{reads:4109},{displayedEstimate:"4.2k"},{evidenceSha256:"missing"},{exactGlobalCutoff:true}])assert.throws(()=>assessManagementReadBudget(manualInput({observation:{...manualObservation,...change}})),/MANUAL_SOURCE/);assert.throws(()=>assessManagementReadBudget(manualInput({nowMs:Date.parse("2026-10-09T01:06:02.001Z")})),/MANUAL_SOURCE/);});

function newDayInput(displayedEstimate = '12,7 mil') {
  const currentNow = Date.parse('2026-10-09T13:04:10.000Z'), currentDay = firestoreQuotaDayStart(currentNow);
  const currentObservation = {...legacyObservation, quotaDayStart:currentDay,
    capturedAt:'2026-10-09T13:01:02.000Z', reviewedAt:'2026-10-09T13:04:03.000Z',
    periodStart:'2026-10-08T13:01:02.000Z', evidenceSha256:'b'.repeat(64),
    displayedEstimate, reads:sourceUsageReviewUpperReads(displayedEstimate)};
  const currentPolicy = {...legacyPolicy, humanDecisionAt:'2026-10-09T13:04:05.000Z',
    reservationQuotaDayStart:currentDay};
  return input({nowMs:currentNow, ...bindHumanReview(currentObservation, currentPolicy, {
    evidenceId:'capture-opaque-new-review', captureMessageId:'human-message-new-capture',
    decisionMessageId:'human-message-new-authorization'})});
}

test('captura humana nova de Oct9 usa evidência opaca e não reutiliza magicdate de Oct8', () => {
  const next = newDayInput(), before = JSON.stringify(next), result = assessManagementReadBudget(next);
  assert.equal(result.allowed, true);
  assert.equal(result.estimatedWithMargin, 28300);
  assert.equal(result.remainingAfterMargin, 16700);
  assert.equal(result.exactGlobalCutoff, false);
  assert.equal(next.policy.manualReviewEvidence, 'capture-opaque-new-review');
  assert.equal(JSON.stringify(next), before);
  const description = describeManagementReadObservation(next.observation);
  assert.equal(description.estimatedUpperReads, 13000);
  assert.equal(description.totalUsageKnown, false);
  assert.equal(description.measuredTotalReads, null);
  assert.equal(description.evidenceId, next.policy.manualReviewEvidence);
  assert.equal(description.captureSource, 'HUMAN_USER_MESSAGE_ATTACHMENT');
});

test('parser usa intervalo de arredondamento e teto superior em milhares para estimativas locais', () => {
  for (const [display, upper] of [
    ['4.1k',5000],['4,1 mil',5000],[' 4,1\u00a0mil ',5000],['4109',5000],
    ['3K',4000],['5.00k',6000],['0',1000],['999',1000],['1000',2000],
    ['12,7 mil',13000],['2.6m',2650000],['1 milhão',1500000],['100.99k',101000]
  ]) assert.equal(sourceUsageReviewUpperReads(display), upper, display);
  for (const display of [null,4109,'','-1k','+1k','NaN','Infinity','4e3','4.1','4,1','4,109',
    '1.000','45%','1.2k trailing','4.999k','1000000000k','secret@example.invalid'])
    assert.throws(() => sourceUsageReviewUpperReads(display), /MANUAL_SOURCE/);
});

test('prova nova continua com limites e reservas, negando consumo alto apesar de revisão humana', () => {
  assert.throws(() => assessManagementReadBudget(newDayInput('37,6 mil')), /DAILY_LIMIT_OR_MARGIN/);
  const next = newDayInput(); next.maximumReads = 5801;
  assert.throws(() => assessManagementReadBudget(next), /CAPTURE_RESERVE_LIMIT/);
  const paused = newDayInput(); paused.policy.pausedRequiresReview = true;
  assert.throws(() => assessManagementReadBudget(paused), /PAUSED_REQUIRES_REVIEW/);
});

for (const [label, change] of [
  ['capture ID', input => {input.observation.evidenceId='different-human-evidence';}],
  ['image hash', input => {input.observation.evidenceSha256='c'.repeat(64);}],
  ['display estimate', input => {input.observation.displayedEstimate='12,8 mil';}],
  ['upper read count', input => {input.observation.reads=12700;}],
  ['agent screenshot', input => {input.observation.captureProvenance.source='AGENT_IN_APP_BROWSER_CAPTURE';}],
  ['missing human capture message', input => {input.observation.captureProvenance.humanMessageId=null;}],
  ['capture timestamp changed', input => {input.observation.captureProvenance.capturedAt='2026-10-09T13:02:00.000Z';}],
  ['browser self approval', input => {input.policy.manualReviewAuthorization.authorizationSource='BROWSER_SELF_DECLARED';}],
  ['missing human decision message', input => {input.policy.manualReviewAuthorization.humanDecisionMessageId=null;}],
  ['authorization false', input => {input.policy.manualReviewAuthorization.authorized=false;}],
  ['wrong authorization project', input => {input.policy.manualReviewAuthorization.projectId='sahmt-gestao-5ae66';}],
  ['training authorization purpose', input => {input.policy.manualReviewAuthorization.authorizedPurpose='TRAINING_RELEASE';}],
  ['lower authorized limit', input => {input.policy.manualReviewAuthorization.dailyReadLimit=35000;}],
  ['approval timestamp fabricated', input => {input.policy.manualReviewAuthorization.approvedAt='2026-10-09T13:04:09.000Z';}],
  ['observation pin changed', input => {input.policy.manualReviewAuthorization.observationSha256='c'.repeat(64);}],
  ['exact total advertised', input => {input.observation.totalUsageKnown=true;}],
  ['fake measured total', input => {input.observation.measuredTotalReads=12700;}],
  ['missing authorization packet', input => {delete input.policy.manualReviewAuthorization;}]
]) test('revisão nova nega ' + label + ' sem mutar estado', () => {
  const next = newDayInput(); change(next); const before = JSON.stringify(next);
  assert.throws(() => assessManagementReadBudget(next), /MANUAL_SOURCE/);
  assert.equal(JSON.stringify(next), before);
});

test('recalcular hashes não transforma captura automática em captura fornecida por humano', () => {
  const next = newDayInput();
  next.observation.captureProvenance.source = 'AGENT_IN_APP_BROWSER_CAPTURE';
  next.policy.manualReviewAuthorization.captureSource = next.observation.captureProvenance.source;
  next.policy.manualReviewAuthorization.observationSha256 = sourceUsageReviewObservationSha256(next.observation);
  assert.throws(() => assessManagementReadBudget(next), /MANUAL_SOURCE/);
});

test('mesmo valores válidos não tornam um novo display aprovado pelo hash anterior', () => {
  const next = newDayInput();
  assert.equal(sourceUsageReviewUpperReads('12,8 mil'), next.observation.reads);
  next.observation.displayedEstimate = '12,8 mil';
  assert.notEqual(sourceUsageReviewObservationSha256(next.observation),
    next.policy.manualReviewAuthorization.observationSha256);
  assert.throws(() => assessManagementReadBudget(next), /MANUAL_SOURCE/);
});

test('revisão aceita fronteira de cinco minutos e nega um milissegundo depois', () => {
  const boundary = newDayInput(); boundary.nowMs = Date.parse(boundary.observation.capturedAt) + 300000;
  assert.equal(assessManagementReadBudget(boundary).allowed, true);
  boundary.nowMs++;
  assert.throws(() => assessManagementReadBudget(boundary), /MANUAL_SOURCE/);
});

test('revisão humana precisa anteceder aprovação e não pode estar no futuro', () => {
  for (const edit of [
    value => {value.observation.reviewedAt='2026-10-09T13:04:06.000Z';},
    value => {value.observation.reviewedAt='2026-10-09T13:01:01.000Z';},
    value => {value.policy.humanDecisionAt='2026-10-09T13:04:11.000Z';}
  ]) {
    const next = newDayInput(); edit(next);
    Object.assign(next, bindHumanReview(next.observation,next.policy,{captureMessageId:next.observation.captureProvenance.humanMessageId,decisionMessageId:next.policy.manualReviewAuthorization.humanDecisionMessageId}));
    assert.throws(() => assessManagementReadBudget(next), /MANUAL_SOURCE|CURRENT_DAY/);
  }
});

test('LAST24H que não cobre todo dia LA de 25 horas é negado', () => {
  const clock = Date.parse('2026-11-02T07:48:00.000Z'), day = firestoreQuotaDayStart(clock);
  const observation = {...legacyObservation, quotaDayStart:day,
    capturedAt:'2026-11-02T07:45:00.000Z', reviewedAt:'2026-11-02T07:46:00.000Z',
    periodStart:'2026-11-01T07:45:00.000Z'};
  const policy = {...legacyPolicy, reservationQuotaDayStart:day, humanDecisionAt:'2026-11-02T07:47:00.000Z'};
  const bound = bindHumanReview(observation,policy);
  assert.equal(day,'2026-11-01T07:00:00.000Z');
  assert.throws(() => assessManagementReadBudget(input({nowMs:clock,...bound})), /MANUAL_SOURCE/);
});

test('observação métrica existente não recebe requisito manual nem teto novo no FB', () => {
  const source = assessManagementReadBudget(input()); assert.equal(source.observationSource, 'CLOUD_MONITORING');
  const destination = input({projectId:'sahmt-gestao-5ae66',
    observation:{...observation,project:'sahmt-gestao-5ae66'},
    policy:{...policy,projectId:'sahmt-gestao-5ae66'}});
  assert.equal(assessManagementReadBudget(destination).allowed,true);
  assert.equal(destination.policy.dailyReadLimit,35000);
});
