const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/evaluation-data.js'), 'utf8').replaceAll('export ', '').replaceAll("import('./firebase.js')", 'Promise.resolve({db: fakeDb})').replaceAll("import('./firebase-auth.js')", 'Promise.resolve({auth: fakeAuth})').replaceAll("import('firebase/firestore')", 'Promise.resolve(fakeSdk)');
function setup({admin = false, revoked = false, accessGroups = ['GENERAL'], claims = {}, activities = [], groupReadDenied = false} = {}) {
  const listeners = [], events = [], errors = [];
  const sdk = {doc: (_db, name, id) => ({name, id}), collection: (_db, name) => ({name}), where: (...args) => ({where: args}), query: (...args) => args, orderBy: (...args) => ({orderBy: args}), limit: count => ({limit: count}), documentId: () => '__name__', startAfter: cursor => ({startAfter: cursor}),
    getDocFromServer: async ref => ref?.name === 'documentAccessEmails'
      ? (groupReadDenied ? Promise.reject(new Error('permission-denied')) : {exists: () => accessGroups.length > 0, data: () => ({email: 'fixture@example.invalid', active: accessGroups.length > 0, groups: accessGroups})})
      : ({exists: () => true, data: () => ({active: !revoked, access: true, role: admin ? 'administrador_app' : 'anestesiologista', permissions: {}})}),
    getDocsFromServer: async query => {
      const collection = query.find(item => item?.name)?.name;
      const filters = query.filter(item => item?.where).map(item => item.where);
      const docs = collection === 'evaluationActivities' ? activities.filter(item => filters.every(([field, operator, value]) => operator === 'array-contains' ? item[field]?.includes(value) : operator === '==' ? item[field] === value : true)) : [];
      return {docs: docs.map(item => ({id: item.id, data: () => item}))};
    },
    onSnapshot: (query, options, next, error) => { const item = {query, options, next, error, stops: 0}; listeners.push(item); return () => item.stops++; }};
  const fakeAuth = {currentUser: {uid: 'fixture-user', getIdTokenResult: async () => ({claims: {email: 'fixture@example.invalid', email_verified: true, firebase: {sign_in_provider: 'google.com'}, ...claims}})}};
  const context = vm.createContext({fakeDb: {}, fakeSdk: sdk, fakeAuth, URL, console, crypto: {randomUUID: () => 'fixture-request'}, navigator: {onLine: true}});
  vm.runInContext(source, context);
  const watch = options => context.watchEvaluation({actorUid: 'fixture-user', category: 'PERFORMANCE', onData: data => events.push(data), onError: error => errors.push(error), ...options});
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return {context, listeners, events, errors, watch, tick};
}
test('cleanup imediato impede listeners após a carga assíncrona', async () => { const h = setup(); h.watch()(); await h.tick(); assert.equal(h.listeners.length, 0); });
test('consulta de terceiros exige admin; revogação bloqueia antes de observar', async () => { for (const [configuration, options] of [[{}, {subjectUid: 'other'}], [{revoked: true}, {}]]) { const h = setup(configuration); h.watch(options); await h.tick(); assert.equal(h.listeners.length, 0); assert.equal(h.errors.length, 1); } });
test('listeners privados usam UID/categoria e máximo agregado sem scores', async () => {
  const h = setup(); const stop = h.watch(); await h.tick(); assert.equal(h.listeners.length, 6);
  const ledger = h.listeners.find(item => item.query?.[0]?.name === 'evaluationLedger');
  assert.ok(ledger.query.some(item => item.where?.join('|') === 'uid|==|fixture-user')); assert.ok(ledger.query.some(item => item.where?.join('|') === 'category|==|PERFORMANCE'));
  assert.equal(h.listeners.some(item => item.query?.[0]?.name === 'scores'), false);
  stop(); assert.ok(h.listeners.every(item => item.stops === 1)); stop(); assert.ok(h.listeners.every(item => item.stops === 1));
});
test('cache/parcial/pending não pode ser anunciado como confirmação', async () => {
  const h = setup(); const stop = h.watch(); await h.tick();
  for (const listener of h.listeners) listener.next(Array.isArray(listener.query) ? {docs: [], metadata: {fromCache: false, hasPendingWrites: false}} : {id: listener.query.id, exists: () => true, data: () => ({status: 'CONFIRMED'}), metadata: {fromCache: false, hasPendingWrites: false}});
  assert.equal(h.events.at(-1).fromCache, false); assert.equal(h.events.at(-1).complete, true);
  h.listeners[0].next({exists: () => false, metadata: {fromCache: true, hasPendingWrites: true}}); assert.equal(h.events.at(-1).fromCache, true); assert.equal(h.events.at(-1).pendingWrites, true);
  const count = h.events.length; stop(); h.listeners[0].next({exists: () => false}); assert.equal(h.events.length, count);
});
test('erro fecha todos os watchers e callbacks tardios não alteram dados', async () => { const h = setup(); h.watch(); await h.tick(); h.listeners[1].error(new Error('perm revogada')); assert.ok(h.listeners.every(item => item.stops === 1)); h.listeners[2].next({docs: []}); assert.equal(h.events.length, 0); assert.equal(h.errors.length, 1); });
test('governança não consulta participações nem ledger performance', async () => { const h = setup(); const stop = h.watch({category: 'GOVERNANCE'}); await h.tick(); assert.ok(h.listeners.some(item => item.query?.[0]?.name === 'evaluationGovernanceRevisions')); assert.equal(h.listeners.some(item => item.query?.[0]?.name === 'evaluationParticipations'), false); stop(); });
test('pedidos rejeitam identidade/nota forjada, categoria inválida e URLs com credenciais', () => {
  const h = setup(), validate = h.context.validateEvaluationRequest;
  assert.throws(() => validate('AWARD', {points: 100})); assert.throws(() => validate('RECONCILE_LINKS', {uid: 'other'}));
  const correction = {awardId: 'fixture-award', category: 'PERFORMANCE', expectedAwardVersion: 1, correctedPoints: 0, reason: 'Correção administrativa fictícia'};
  assert.equal(validate('CORRECT_SCORE', correction), correction); assert.throws(() => validate('CORRECT_SCORE', {...correction, category: 'GLOBAL'})); assert.throws(() => validate('CORRECT_SCORE', {...correction, uid: 'other'}));
  const review = {activityId: 'form-fixture', areaId: 'area-fixture', assignmentId: 'assignment-fixture', previousVersion: 1, newVersion: 2, summary: 'Alteração fictícia de conteúdo', components: ['MATERIAL'], materialEvidence: ['https://drive.google.com/file/d/fixture123456/view'], questionEvidence: []};
  assert.equal(validate('REQUEST_GOVERNANCE', review), review); assert.throws(() => validate('REQUEST_GOVERNANCE', {...review, materialEvidence: ['https://secret:secret@example.invalid/']})); assert.throws(() => validate('REQUEST_GOVERNANCE', {...review, components: ['MATERIAL', 'MATERIAL']}));
});

test('configuração aceita público por grupos conhecidos preservando UIDs legados', () => {
  const h = setup(), validate = h.context.validateEvaluationRequest;
  const base = {activityId: 'form-fixture', creditScopeId: 'matter-fixture', version: 1,
    modalities: {acknowledgement: true, suggestion: true, test: true}, acknowledgementItemId: 'ack',
    suggestionProblemItemId: 'problem', suggestionProposalItemId: 'proposal', suggestionBenefitItemId: 'benefit',
    validFrom: '2026-10-01', validUntil: '2026-12-31', eligibleUids: [], eligibleGroups: ['GENERAL'],
    managerAreaId: 'area-fixture', expectedVersion: 0};
  assert.equal(validate('CONFIGURE_ACTIVITY', base), base);
  assert.equal(validate('CONFIGURE_ACTIVITY', {...base, eligibleUids: ['legacy-user'], eligibleGroups: ['RESTRICTED']}).eligibleUids[0], 'legacy-user');
  assert.throws(() => validate('CONFIGURE_ACTIVITY', {...base, eligibleGroups: []}));
  assert.throws(() => validate('CONFIGURE_ACTIVITY', {...base, eligibleGroups: ['ALL']}));
  assert.throws(() => validate('CONFIGURE_ACTIVITY', {...base, eligibleGroups: ['GENERAL', 'GENERAL']}));
});
test('lista apenas atividades de grupos confirmados e compatibilidade de UID/gestor', async () => {
  const items = [
    {id: 'general', eligibleGroups: ['GENERAL'], eligibleUids: []},
    {id: 'restricted', eligibleGroups: ['RESTRICTED'], eligibleUids: []},
    {id: 'legacy', eligibleUids: ['fixture-user']},
    {id: 'managed', eligibleUids: [], managerUid: 'fixture-user'}
  ];
  const h = setup({activities: items});
  const result = await h.context.listEvaluationActivities('fixture-user');
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(item => item.id).sort())), ['general', 'legacy', 'managed']);
  const invalid = setup({activities: items, claims: {email_verified: false}});
  assert.deepEqual(JSON.parse(JSON.stringify((await invalid.context.listEvaluationActivities('fixture-user')).map(item => item.id).sort())), ['legacy', 'managed']);
  const denied = setup({activities: items, groupReadDenied: true});
  assert.deepEqual(JSON.parse(JSON.stringify((await denied.context.listEvaluationActivities('fixture-user')).map(item => item.id).sort())), ['legacy', 'managed']);
});

test('retry usa ID estável e mapa reordenado pelo Firestore sem resetar pedido concluído', async () => {
  const h = setup(), writes = [];
  const payload = {awardId: 'fixture-award', category: 'PERFORMANCE', expectedAwardVersion: 3, correctedPoints: 0, reason: 'Correção administrativa fictícia'};
  const stored = Object.fromEntries(Object.entries(payload).reverse());
  h.context.fakeSdk.runTransaction = async (_db, callback) => callback({
    get: async () => ({exists: () => true, data: () => ({actorUid: 'fixture-user', type: 'CORRECT_SCORE', status: 'PROCESSED', payload: stored})}),
    set: (...args) => writes.push(args)
  });
  const id = await h.context.submitEvaluationRequest('CORRECT_SCORE', payload, 'fixture-user', {requestId: 'fixture-id'});
  assert.equal(id, 'fixture-id'); assert.equal(writes.length, 0);
  await assert.rejects(() => h.context.submitEvaluationRequest('CORRECT_SCORE', {...payload, correctedPoints: 1}, 'fixture-user', {requestId: 'fixture-id'}), /outra solicitação/);
  assert.equal(writes.length, 0);
});

test('offline conserva rascunho sem criar pedido nem saldo', async () => {
  const h = setup(); h.context.navigator.onLine = false;
  await assert.rejects(() => h.context.submitEvaluationRequest('RECONCILE_LINKS', {}, 'fixture-user', {requestId: 'fixture-offline'}), /rascunho foi preservado/);
  assert.equal(h.listeners.length, 0);
});
