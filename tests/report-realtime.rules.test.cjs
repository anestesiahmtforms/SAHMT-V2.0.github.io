const {before, beforeEach, afterEach, after, test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const {performance} = require('node:perf_hooks');
const sdk = require('firebase/firestore');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('listeners reais exigem emulador local explícito', {skip: 'Execute com firebase emulators:exec --project demo-sahmt-v2 --only firestore.'}, () => {});
} else {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(?:127\.0\.0\.1|localhost):(?:8080|8081)$/);
  const emulatorPort = Number(process.env.FIRESTORE_EMULATOR_HOST.split(':').at(-1));
  const projectId = 'demo-sahmt-v2', day = '2026-10-01', month = '2026-10';
  const measures = {projectId, emulator: `127.0.0.1:${emulatorPort}`, fixtureOnly: true, sdk: 'firebase/firestore', startedAt: new Date().toISOString(), timings: [], listenerMetrics: [], indexAudit: []};
  let environment, checklist, responsibility, checklistDates;
  const fixtureDatabases = new Set();
  // Rules test contexts expose Compat clients; network/terminate APIs require their full modular delegate.
  const fixtureDb = value => {const db = value._delegate || value; fixtureDatabases.add(db); return db;};
  sdk.setLogLevel('silent');
  const profile = (uid, permissions, overrides = {}) => ({uid, email: `${uid}@example.invalid`, displayName: uid, sigla: '', phone: '',
    active: true, access: true, role: 'anestesiologista', permissions, createdAt: 'fixture', updatedAt: 'fixture', ...overrides});
  const ids = (report) => Array.from(report.records || [], (record) => record.id);
  const confirmed = (report) => report.confirmed === true || report.serverConfirmed === true;
  const elapsed = (scenario, start) => measures.timings.push({scenario, elapsedMs: Number((performance.now() - start).toFixed(2))});
  const mutation = (callback) => environment.withSecurityRulesDisabled((context) => callback(fixtureDb(context.firestore())));
  const seed = (collection, id, value) => mutation((db) => sdk.setDoc(sdk.doc(db, collection, id), value));
  const removeFixture = (collection, id) => mutation((db) => sdk.deleteDoc(sdk.doc(db, collection, id)));
  const adminDb = () => fixtureDb(environment.authenticatedContext('fixture-admin', {email_verified: true}).firestore());
  const memberDb = () => fixtureDb(environment.authenticatedContext('fixture-member', {email_verified: true}).firestore());
  const unrelatedDb = () => fixtureDb(environment.authenticatedContext('fixture-unrelated').firestore());



  before(async () => {
    environment = await initializeTestEnvironment({projectId, firestore: {host: '127.0.0.1', port: emulatorPort,
      rules: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8')}});
    [checklist, responsibility, checklistDates] = await Promise.all([
      import(pathToFileURL(path.join(__dirname, '../src/checklist-report-listener.js')).href),
      import(pathToFileURL(path.join(__dirname, '../src/checklist-responsibility-listener.js')).href),
      import(pathToFileURL(path.join(__dirname, '../src/checklist-date.js')).href)
    ]);
  });
  beforeEach(async () => {
    // The emulator may briefly fail a reset while a cancelled watch stream drains.
    // Retry only that explicit internal 500; authorization and report failures still fail immediately.
    for (let attempt = 0; ; attempt++) {
      try {await environment.clearFirestore(); break;} catch (error) {
        if (attempt >= 2 || !/\"code\":500/.test(String(error.message))) throw error;
        measures.fixtureResetRetries = (measures.fixtureResetRetries || 0) + 1;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    await mutation(async (db) => {
      const batch = sdk.writeBatch(db);
      for (const value of [profile('fixture-admin', {admin: true}, {role: 'administrador_app', sigla: 'AD'}),
        profile('fixture-member', {eventsRead: true, eventsWrite: true, labelsRead: true, labelsWrite: true, checklistRead: true, checklistWrite: true, scheduleRead: true}, {sigla: 'AB'}),
        profile('fixture-unrelated', {}, {sigla: 'ZZ'})]) batch.set(sdk.doc(db, 'users', value.uid), value);
      batch.set(sdk.doc(db, 'eventCatalogs', 'operational'), {id: 'operational', payers: ['Membro'], creditors: ['Equipe'],
        createdByUid: 'fixture-admin', updatedByUid: 'fixture-admin', createdAt: new Date(), updatedAt: new Date(), version: 1});
      await batch.commit();
    });
  });
  // Explicitly terminate full-SDK fixture clients after unsubscribe, including clients that disabled their network.
  afterEach(async () => {
    await Promise.all([...fixtureDatabases].map(db => sdk.terminate(db)));
    fixtureDatabases.clear();
  });
  after(async () => {
    assert.ok(measures.listenerMetrics.every(metric => metric.subscriptions === metric.unsubscribes), 'Cada listener de fixture deve ser encerrado antes de concluir a suíte.');
    if (environment) await environment.cleanup();
    measures.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.join(__dirname, '../.local-preview'), {recursive: true});
    fs.writeFileSync(path.join(__dirname, '../.local-preview/realtime-emulator-measures.json'), JSON.stringify(measures, null, 2));
  });

  // Only the Firebase instance imports are injected. Query factories, reducers and onSnapshot use the real JS full SDK.
  function runtime(file, db, realSdk) {
    const original = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    const source = original.split('\n').filter((line) => !line.startsWith('import ')).join('\n').replaceAll('export ', '')
      .replaceAll("import('./firebase.js')", 'Promise.resolve({db: emulatorDb})')
      .replaceAll("import('firebase/firestore')", 'Promise.resolve(fullSdk)');
    const context = vm.createContext({emulatorDb: db, fullSdk: realSdk, console});
    vm.runInContext(source, context, {filename: file});
    return context;
  }
  function observer(t, scenario) {
    const reports = [], errors = [], waiters = [];
    const metrics = {scenario, subscriptions: 0, callbacks: 0, documentDeliveries: 0, unsubscribes: 0};
    measures.listenerMetrics.push(metrics);
    const realSdk = {...sdk, onSnapshot(reference, options, next, error) {
      metrics.subscriptions++;
      const release = sdk.onSnapshot(reference, options, (snapshot) => {
        metrics.callbacks++; metrics.documentDeliveries += snapshot.docs?.length ?? (snapshot.exists() ? 1 : 0); next(snapshot);
      }, error);
      let stopped = false;
      return () => {if (!stopped) {stopped = true; metrics.unsubscribes++; release();}};
    }};
    let stop = () => {};
    const settle = () => {
      for (const item of [...waiters]) {
        if (errors.length) {clearTimeout(item.timer); waiters.splice(waiters.indexOf(item), 1); item.reject(errors[0]);}
        else if (reports.length && item.predicate(reports.at(-1))) {clearTimeout(item.timer); waiters.splice(waiters.indexOf(item), 1); item.resolve(reports.at(-1));}
      }
    };
    const result = {sdk: realSdk, reports, errors, metrics,
      next(value) {reports.push(value); settle();}, error(error) {errors.push(error); settle();},
      stop() {stop();}, setStop(value) {stop = value;}, last() {return reports.at(-1);},
      wait(predicate, description = scenario) {
        if (errors.length) return Promise.reject(errors[0]);
        if (reports.length && predicate(reports.at(-1))) return Promise.resolve(reports.at(-1));
        return new Promise((resolve, reject) => {
          const item = {predicate, resolve, reject, timer: setTimeout(() => {waiters.splice(waiters.indexOf(item), 1); reject(new Error(`Timeout: ${description}; callbacks=${metrics.callbacks}`));}, 15000)};
          waiters.push(item);
        });
      }
    };
    t.after(() => {stop(); for (const item of waiters.splice(0)) {clearTimeout(item.timer); item.reject(new Error('Observação encerrada'));}});
    return result;
  }
  async function eventWatch(t, db, options, scenario) {
    const h = observer(t, scenario), code = runtime('report-live-data.js', db, h.sdk), start = performance.now();
    h.setStop(await code.watchEventRecords({from: day, to: day, uid: 'fixture-member', sigla: 'AB', ...options}, h.next, h.error));
    await h.wait(confirmed); elapsed(`${scenario}:first-server-snapshot`, start); return h;
  }
  async function labelWatch(t, db, options, scenario) {
    const h = observer(t, scenario), code = runtime('label-report-reader.js', db, h.sdk), start = performance.now();
    h.setStop(await code.watchLabelRecords({from: day, to: day, uid: 'fixture-member', sigla: 'AB', ...options}, h.next, h.error));
    await h.wait(confirmed); elapsed(`${scenario}:first-server-snapshot`, start); return h;
  }
  function event(id, overrides = {}) {
    return {id, clientMutationId: id, date: day, memberSigla: 'AB', scheduleSigla: 'AB', memberStatus: 'AB — Atrasado',
      eventType: 'ATRASO', description: '', delayMultiple: 2, substitute: '', shift: '', payer: 'Membro', creditor: 'Equipe', amountToPay: 200,
      status: 'OPEN', active: true, createdByUid: 'fixture-member', updatedByUid: 'fixture-member', createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), version: 1, ...overrides};
  }
  function label(id, overrides = {}) {
    return {id, clientMutationId: id, date: day, patientName: 'PACIENTE FICTÍCIO DO EMULADOR', procedureCode: '123', encounterCode: '456',
      type: 'Convênio', amount: null, insurance: 'FICTÍCIO', creditor: 'Caixa', staffSiglas: [], consultation: false, status: 'CONFIRMED',
      active: true, createdByUid: 'fixture-member', updatedByUid: 'fixture-member', createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), version: 1, ...overrides};
  }
  async function editEvent(db, value) {
    const changed = {memberStatus: 'AB — Atrasado corrigido'}, fields = ['date', 'memberSigla', 'scheduleSigla', 'memberStatus', 'eventType', 'description', 'delayMultiple', 'substitute', 'shift', 'payer', 'creditor', 'amountToPay', 'status'];
    const batch = sdk.writeBatch(db);
    batch.update(sdk.doc(db, 'events', value.id), {...changed, updatedByUid: 'fixture-admin', updatedByName: 'fixture-admin', updatedAt: sdk.serverTimestamp(), version: 2});
    batch.set(sdk.doc(db, 'events', value.id, 'history', '2'), {id: '2', eventId: value.id, version: 2, requestId: `${value.id}-edit`, actorUid: 'fixture-admin', actorName: 'fixture-admin',
      changedFields: Object.keys(changed), before: Object.fromEntries(fields.map((field) => [field, value[field] ?? null])),
      after: Object.fromEntries(fields.map((field) => [field, changed[field] ?? value[field] ?? null])), createdAt: sdk.serverTimestamp()});
    await assertSucceeds(batch.commit());
  }

  test('Eventos e Etiquetas propagam inclusão, edição e remoção entre duas sessões autorizadas', {timeout: 60000}, async (t) => {
    const member = memberDb(), admin = adminDb();
    const eventsA = await eventWatch(t, admin, {uid: 'fixture-admin', isAdmin: true}, 'events-admin');
    const eventsB = await eventWatch(t, member, {}, 'events-member');
    const labelsA = await labelWatch(t, admin, {uid: 'fixture-admin', canManage: true}, 'labels-admin');
    const labelsB = await labelWatch(t, member, {}, 'labels-member');
    let start = performance.now(); await assertSucceeds(sdk.setDoc(sdk.doc(member, 'events', 'event-live'), event('event-live')));
    await Promise.all([eventsA.wait((r) => confirmed(r) && ids(r).includes('event-live')), eventsB.wait((r) => confirmed(r) && ids(r).includes('event-live'))]); elapsed('events:insert-two-sessions', start);
    const storedEvent = (await sdk.getDoc(sdk.doc(member, 'events', 'event-live'))).data(); start = performance.now(); await editEvent(admin, storedEvent);
    await Promise.all([eventsA.wait((r) => confirmed(r) && r.records.some((x) => x.version === 2)), eventsB.wait((r) => confirmed(r) && r.records.some((x) => x.version === 2))]); elapsed('events:edit-two-sessions', start);
    start = performance.now(); await assertSucceeds(sdk.setDoc(sdk.doc(member, 'labels', 'label-live'), label('label-live')));
    await Promise.all([labelsA.wait((r) => confirmed(r) && ids(r).includes('label-live')), labelsB.wait((r) => confirmed(r) && ids(r).includes('label-live'))]); elapsed('labels:insert-two-sessions', start);
    start = performance.now(); await assertSucceeds(sdk.updateDoc(sdk.doc(member, 'labels', 'label-live'), {encounterCode: '789', updatedByUid: 'fixture-member', updatedAt: sdk.serverTimestamp(), version: 2}));
    await Promise.all([labelsA.wait((r) => confirmed(r) && r.records.some((x) => x.version === 2)), labelsB.wait((r) => confirmed(r) && r.records.some((x) => x.version === 2))]); elapsed('labels:edit-two-sessions', start);
    await assertFails(sdk.deleteDoc(sdk.doc(admin, 'events', 'event-live'))); await assertFails(sdk.deleteDoc(sdk.doc(admin, 'labels', 'label-live')));
    start = performance.now(); await removeFixture('events', 'event-live'); await removeFixture('labels', 'label-live');
    await Promise.all([eventsA.wait((r) => confirmed(r) && ids(r).length === 0), eventsB.wait((r) => confirmed(r) && ids(r).length === 0),
      labelsA.wait((r) => confirmed(r) && ids(r).length === 0), labelsB.wait((r) => confirmed(r) && ids(r).length === 0)]); elapsed('fixture-delete:two-sessions', start);
  });

  test('Rules recusam consultas amplas de comum/sem permissão e listeners respeitam autoria ou sigla', {timeout: 45000}, async (t) => {
    const member = memberDb(), unrelated = unrelatedDb();
    const actualProfile = (await sdk.getDoc(sdk.doc(member, 'users', 'fixture-member'))).data();
    assert.equal(actualProfile.sigla, 'AB'); assert.equal(actualProfile.permissions.labelsRead, true);
    assert.equal(actualProfile.active, true); assert.equal(actualProfile.access, true);
    const probe = async (name, extra) => {
      try {
        const result = await sdk.getDocs(sdk.query(sdk.collection(member, 'labels'), sdk.where('active', '==', true),
          sdk.where('date', '==', day), ...extra, sdk.orderBy('date', 'desc'), sdk.limit(3)));
        measures.labelRuleProbes ||= []; measures.labelRuleProbes.push({name, allowed: true, count: result.size});
        return true;
      } catch (error) {
        measures.labelRuleProbes ||= []; measures.labelRuleProbes.push({name, allowed: false, code: error.code, message: error.message});
        return false;
      }
    };
    assert.equal(await probe('empty-collection-own', [sdk.where('createdByUid', '==', 'fixture-member')]), true);
    assert.equal(await probe('empty-collection-staff', [sdk.where('staffSiglas', 'array-contains', 'AB')]), true);
    for (const db of [member, unrelated]) for (const collection of ['events', 'labels']) {
      await assertFails(sdk.getDocs(sdk.query(sdk.collection(db, collection), sdk.where('active', '==', true), sdk.where('date', '==', day), sdk.orderBy('date', 'desc'), sdk.limit(101))));
    }
    await seed('events', 'visible-by-sigla', event('visible-by-sigla', {createdByUid: 'fixture-admin', updatedByUid: 'fixture-admin'}));
    await seed('events', 'hidden-other', event('hidden-other', {createdByUid: 'fixture-admin', updatedByUid: 'fixture-admin', memberSigla: 'ZZ', scheduleSigla: 'ZZ'}));
    await seed('labels', 'visible-by-staff', label('visible-by-staff', {createdByUid: 'fixture-admin', updatedByUid: 'fixture-admin', creditor: 'Plantão', staffSiglas: ['AB']}));
    await seed('labels', 'hidden-other', label('hidden-other', {createdByUid: 'fixture-admin', updatedByUid: 'fixture-admin'}));
    assert.equal(await probe('populated-collection-own', [sdk.where('createdByUid', '==', 'fixture-member')]), true);
    assert.equal(await probe('populated-collection-staff', [sdk.where('staffSiglas', 'array-contains', 'AB')]), true);
    await assertFails(sdk.getDoc(sdk.doc(member, 'labels', 'hidden-other')));
    await assertFails(sdk.getDoc(sdk.doc(unrelated, 'labels', 'visible-by-staff')));
    // A malformed map/string must not acquire membership access when the redundant query type guard is removed.
    for (const [id, staffSiglas] of [['invalid-map', {AB: true}], ['invalid-string', 'AB'], ['invalid-null', null]]) {
      await seed('labels', id, label(id, {createdByUid: 'fixture-admin', updatedByUid: 'fixture-admin', staffSiglas}));
      await assertFails(sdk.getDoc(sdk.doc(member, 'labels', id)));
    }
    const storedLabel = (await sdk.getDoc(sdk.doc(member, 'labels', 'visible-by-staff'))).data();
    const editStaffLabel = (beforeValue = storedLabel.encounterCode, editor = member, uid = 'fixture-member') => {
      const batch = sdk.writeBatch(editor);
      batch.update(sdk.doc(editor, 'labels', storedLabel.id), {encounterCode: '789', updatedByUid: uid, updatedAt: sdk.serverTimestamp(), version: 2});
      batch.set(sdk.doc(editor, 'labels', storedLabel.id, 'history', '2'), {id: '2', labelId: storedLabel.id, version: 2, actorUid: uid, changedFields: ['encounterCode'],
        before: {encounterCode: beforeValue}, after: {encounterCode: '789'}, createdAt: sdk.serverTimestamp()});
      return batch.commit();
    };
    await assertFails(editStaffLabel('FORJADO'));
    await assertFails(editStaffLabel(storedLabel.encounterCode, unrelated, 'fixture-unrelated'));
    await assertSucceeds(editStaffLabel());
    await assertSucceeds(sdk.getDoc(sdk.doc(member, 'labels', storedLabel.id, 'history', '2')));
    await assertFails(sdk.getDoc(sdk.doc(unrelated, 'labels', storedLabel.id, 'history', '2')));
    await assertFails(sdk.updateDoc(sdk.doc(member, 'labels', storedLabel.id, 'history', '2'), {before: {encounterCode: 'FAKE'}}));
    await assertFails(sdk.updateDoc(sdk.doc(member, 'labels', 'hidden-other'), {encounterCode: 'INDEVIDO', updatedByUid: 'fixture-member', updatedAt: sdk.serverTimestamp(), version: 2}));
    const events = await eventWatch(t, member, {}, 'events-authorized-sigla'), labels = await labelWatch(t, member, {}, 'labels-authorized-staff');
    assert.deepEqual(ids(events.last()), ['visible-by-sigla']); assert.deepEqual(ids(labels.last()), ['visible-by-staff']);
    const error = await new Promise((resolve, reject) => {
      let release; const timer = setTimeout(() => {release?.(); reject(new Error('Listener não recusou consulta indevida'));}, 10000);
      release = sdk.onSnapshot(sdk.query(sdk.collection(unrelated, 'events'), sdk.where('active', '==', true), sdk.orderBy('date', 'desc'), sdk.limit(101)),
        {includeMetadataChanges: true}, () => {}, (failure) => {clearTimeout(timer); release(); resolve(failure);});
    }); assert.equal(error.code, 'permission-denied');
  });

  test('janela mensal real mantém limites, isolamento por data e movimento do prefixo', {timeout: 45000}, async (t) => {
    const db = adminDb();
    for (const [id, date] of [['b', '2026-10-20'], ['c', '2026-10-10'], ['d', '2026-10-01'], ['outside', '2026-09-30']]) await seed('events', id, event(id, {date}));
    const events = await eventWatch(t, db, {uid: 'fixture-admin', isAdmin: true, from: '2026-10-01', to: '2026-10-31', pageSize: 2}, 'events-month-prefix');
    assert.deepEqual(ids(events.last()), ['b', 'c']); assert.equal(events.last().hasMore, true);
    let start = performance.now(); await seed('events', 'a', event('a', {date: '2026-10-30'})); await events.wait((r) => confirmed(r) && ids(r).join(',') === 'a,b'); elapsed('events:prefix-front-insert', start);
    const nextLimit = events.last().nextCursor.nextLimit; events.stop();
    const more = await eventWatch(t, db, {uid: 'fixture-admin', isAdmin: true, from: '2026-10-01', to: '2026-10-31', pageSize: 2, loadedLimit: nextLimit}, 'events-month-expanded');
    assert.deepEqual(ids(more.last()), ['a', 'b', 'c', 'd']); assert.equal(more.last().hasMore, false); assert.ok(!ids(more.last()).includes('outside'));
    const daily = await eventWatch(t, db, {uid: 'fixture-admin', isAdmin: true}, 'events-day-isolated'); assert.deepEqual(ids(daily.last()), ['d']);
    const count = events.reports.length; await seed('events', 'another', event('another', {date: '2026-10-31'})); await more.wait((r) => confirmed(r) && ids(r)[0] === 'another');
    assert.equal(events.reports.length, count); assert.equal(events.metrics.unsubscribes, events.metrics.subscriptions);
    for (const [id, date] of [['label-b', '2026-10-20'], ['label-c', '2026-10-10'], ['label-d', '2026-10-01'], ['label-outside', '2026-09-30']]) await seed('labels', id, label(id, {date}));
    const labels = await labelWatch(t, db, {uid: 'fixture-admin', canManage: true, from: '2026-10-01', to: '2026-10-31', pageSize: 2}, 'labels-month-prefix');
    assert.deepEqual(ids(labels.last()), ['label-b', 'label-c']); assert.equal(labels.last().hasMore, true);
    const labelInsert = performance.now(); await seed('labels', 'label-a', label('label-a', {date: '2026-10-30'}));
    await labels.wait(r => confirmed(r) && ids(r).join(',') === 'label-a,label-b'); elapsed('labels:prefix-front-insert', labelInsert);
    const labelLimit = labels.last().nextCursor.nextLimit; labels.stop();
    const labelMore = await labelWatch(t, db, {uid: 'fixture-admin', canManage: true, from: '2026-10-01', to: '2026-10-31', pageSize: 2, loadedLimit: labelLimit}, 'labels-month-expanded');
    assert.deepEqual(ids(labelMore.last()), ['label-a', 'label-b', 'label-c', 'label-d']); assert.equal(labelMore.last().hasMore, false);
    const moveTime = performance.now(); await seed('labels', 'label-b', label('label-b', {date: '2026-11-01'}));
    await labelMore.wait(r => confirmed(r) && !ids(r).includes('label-b')); elapsed('labels:filter-date-exit', moveTime);
    await seed('labels', 'label-outside', label('label-outside', {date: '2026-10-21'}));
    await labelMore.wait(r => confirmed(r) && ids(r).includes('label-outside'));
    const eventExit = performance.now(); await seed('events', 'another', event('another', {date: '2026-11-01'}));
    await more.wait(r => confirmed(r) && !ids(r).includes('another')); elapsed('events:filter-date-exit', eventExit);
  });

  test('Checklist real acompanha dois históricos, exclusão revela antecessor e mês não invade outro período', {timeout: 45000}, async (t) => {
    const db = memberDb(), stations = [{id: 'S1', active: true}, {id: 'S2', active: true}];
    const record = (id, stationId, date, condition) => ({id, stationId, date, condition, occurrence: condition === 'NAO' ? 'FALHA FICTÍCIA' : '', createdAt: new Date(`${date}T12:00:00Z`)});
    for (const [id, stationId, date, condition] of [['old-1', 'S1', '2026-09-28', 'SIM'], ['prior-1', 'S1', '2026-09-30', 'NAO'], ['prior-2', 'S2', '2026-09-30', 'NAO']]) await seed('checklists', id, record(id, stationId, date, condition));
    const h = observer(t, 'checklist-day-two-histories'); const start = performance.now();
    h.setStop(checklist.createChecklistReportListener({uid: 'fixture-member', day, stationIds: ['S1', 'S2']}, h.next, h.error, {sdk: h.sdk, db}));
    await h.wait((r) => r.confirmed); elapsed('checklist:first-all-sources-server', start); assert.equal(h.metrics.subscriptions, 3);
    const resolved = () => checklistDates.resolveChecklistDayRecord(stations[0], h.last().records.find((x) => x.stationId === 'S1'), h.last().priorRecords.find((x) => x.stationId === 'S1'), day, day);
    assert.equal(resolved().id, 'prior-1'); let time = performance.now(); await seed('checklists', 'current-1', record('current-1', 'S1', day, 'SIM'));
    await h.wait((r) => r.confirmed && ids(r).includes('current-1')); elapsed('checklist:current-insert', time); assert.equal(resolved().id, 'current-1'); assert.equal(h.metrics.subscriptions, 3);
    await assertFails(sdk.deleteDoc(sdk.doc(db, 'checklists', 'current-1'))); time = performance.now(); await removeFixture('checklists', 'current-1');
    await h.wait((r) => r.confirmed && ids(r).length === 0); elapsed('checklist:current-delete-fallback', time); assert.equal(resolved().id, 'prior-1');
    await removeFixture('checklists', 'prior-1'); await h.wait((r) => r.confirmed && r.priorRecords.some((x) => x.id === 'old-1')); assert.equal(resolved(), null);
    await seed('checklists', 'october', record('october', 'S1', '2026-10-02', 'SIM')); await seed('checklists', 'november', record('november', 'S2', '2026-11-01', 'SIM'));
    const monthly = observer(t, 'checklist-month-isolated'); monthly.setStop(checklist.createChecklistReportListener({uid: 'fixture-member', month, stationIds: ['S1', 'S2']}, monthly.next, monthly.error, {sdk: monthly.sdk, db}));
    await monthly.wait((r) => r.confirmed); assert.deepEqual(ids(monthly.last()), ['october']); assert.equal(h.last().records.length, 0);
    const arsenalIds = ['S1', 'S2', ...Array.from({length: 26}, (_, index) => `empty-${index}`)];
    const full = observer(t, 'checklist-day-28-histories');
    full.setStop(checklist.createChecklistReportListener({uid: 'fixture-member', day, stationIds: arsenalIds}, full.next, full.error, {sdk: full.sdk, db}));
    await full.wait(r => r.confirmed); assert.equal(full.metrics.subscriptions, 29);
    const beforeQueries = performance.now();
    await Promise.all([sdk.getDocs(sdk.query(sdk.collection(db, 'checklists'), sdk.where('date', '==', day), sdk.orderBy('createdAt', 'desc'), sdk.limit(1000))),
      ...arsenalIds.map(stationId => sdk.getDocs(sdk.query(sdk.collection(db, 'checklists'), sdk.where('stationId', '==', stationId), sdk.where('date', '<', day),
        sdk.orderBy('date', 'desc'), sdk.orderBy('createdAt', 'desc'), sdk.limit(1))))]);
    elapsed('checklist:legacy-29-query-refresh', beforeQueries);
    const subscriptionsBeforeUpdate = full.metrics.subscriptions, callbacksBeforeUpdate = full.metrics.callbacks;
    const liveChange = performance.now(); await seed('checklists', 'benchmark-response', record('benchmark-response', 'S2', day, 'SIM'));
    await full.wait(r => r.confirmed && ids(r).includes('benchmark-response')); elapsed('checklist:live-28-histories-single-response', liveChange);
    assert.equal(full.metrics.subscriptions, subscriptionsBeforeUpdate);
    measures.checklistReloadComparison = {stationCount: 28, legacyQueriesPerRefresh: 29, liveEstablishedSubscriptions: 29,
      liveNewSubscriptionsOnResponse: full.metrics.subscriptions - subscriptionsBeforeUpdate, historicalQueriesRepeatedOnResponse: 0,
      liveCallbacksOnResponse: full.metrics.callbacks - callbacksBeforeUpdate, fixtureOnly: true,
      note: 'Contagem de consultas/subscriptions no emulador; não é medição da cobrança em produção.'};
  });

  test('responsabilidade administrativa usa queries reais limitadas e preserva filtros/contatos inativos', {timeout: 45000}, async (t) => {
    await seed('scheduleDays', day, {id: day, date: day, positions: ['AD', 'CR', 'LH']});
    for (const [sigla, name, active] of [['AD', 'Ana Fictícia', true], ['CR', 'Caio Fictício', true], ['LH', 'Lia Fictícia', true], ['ZZ', 'Ana Fictícia', false]]) await seed('contacts', sigla, {sigla, name, active});
    await seed('vacations', 'inactive', {id: 'inactive', active: false, start: day, end: day, siglas: ['AD']});
    await seed('vacations', 'future', {id: 'future', active: true, start: '2026-10-02', end: '2026-10-03', siglas: ['AD']});
    const h = observer(t, 'checklist-responsibility-admin'), start = performance.now();
    h.setStop(responsibility.createChecklistResponsibilityListener({uid: 'fixture-admin', day, isAdmin: true}, h.next, h.error, {sdk: h.sdk, db: adminDb()}));
    await h.wait((r) => r.confirmed); elapsed('responsibility:first-four-sources-server', start); assert.equal(h.metrics.subscriptions, 4); assert.equal(h.last().responsible.sigla, 'AD');
    await seed('vacations', 'active', {id: 'active', active: true, start: day, end: day, siglas: ['AD']}); await h.wait((r) => r.confirmed && r.responsible.sigla === 'CR');
    await seed('events', 'replacement', event('replacement', {eventType: 'Pessoal', memberStatus: 'CR', substitute: 'Lia Fictícia'})); await h.wait((r) => r.confirmed && r.responsible.sigla === 'LH');
    await removeFixture('events', 'replacement'); await h.wait((r) => r.confirmed && r.responsible.sigla === 'CR');
    await seed('events', 'ambiguous', event('ambiguous', {eventType: 'Pessoal', memberStatus: 'Ana Fictícia', substitute: 'Caio Fictício'}));
    await h.wait((r) => !r.confirmed && r.responsible?.name === null); assert.match(h.last().reason, /sem membro identificável/);
    assert.throws(() => responsibility.createChecklistResponsibilityListener({uid: 'fixture-member', day, isAdmin: false}, () => {}, () => {}, {sdk, db: memberDb()}), /exclusiva/);
  });

  test('SDK real sinaliza cache, escrita pendente offline e confirmação após reconexão sem duplicação', {timeout: 45000}, async (t) => {
    const member = memberDb(), admin = adminDb();
    const local = await labelWatch(t, member, {sigla: ''}, 'labels-offline-member'); const remote = await labelWatch(t, admin, {uid: 'fixture-admin', canManage: true}, 'labels-offline-admin');
    let pendingWrite;
    try {
      await sdk.disableNetwork(member); await local.wait((r) => r.fromCache && !r.serverConfirmed);
      const start = performance.now(); pendingWrite = sdk.setDoc(sdk.doc(member, 'labels', 'offline-label'), label('offline-label'));
      pendingWrite.catch(() => {}); await local.wait((r) => ids(r).includes('offline-label') && r.hasPendingWrites && !r.serverConfirmed); elapsed('labels:offline-local-pending', start);
      assert.equal(ids(remote.last()).includes('offline-label'), false);
      const resume = performance.now(); await sdk.enableNetwork(member); await assertSucceeds(pendingWrite);
      await Promise.all([local.wait((r) => confirmed(r) && ids(r).includes('offline-label')), remote.wait((r) => confirmed(r) && ids(r).includes('offline-label'))]); elapsed('labels:reconnect-two-sessions-confirmed', resume);
      assert.equal(ids(local.last()).filter((id) => id === 'offline-label').length, 1); assert.equal(local.last().hasPendingWrites, false);
    } finally {await sdk.enableNetwork(member); if (pendingWrite) await pendingWrite;}
  });

  test('auditoria dos índices declarados cobre exatamente as novas consultas de período/autorização', () => {
    const indexes = JSON.parse(fs.readFileSync(path.join(__dirname, '../firestore.indexes.json'), 'utf8')).indexes;
    for (const [collection, fields] of [['events', 'active,date'], ['events', 'active,createdByUid,date'], ['events', 'active,memberSigla,date'], ['events', 'active,scheduleSigla,date'],
      ['labels', 'active,date'], ['labels', 'active,createdByUid,date'], ['labels', 'active,staffSiglas,date'], ['checklists', 'date,createdAt'], ['checklists', 'stationId,date,createdAt'], ['vacations', 'active,start,end']]) {
      const matches = indexes.filter((index) => index.collectionGroup === collection && index.fields.map((field) => field.fieldPath).join(',') === fields);
      assert.ok(matches.length, `Índice ausente: ${collection} ${fields}`); measures.indexAudit.push({collection, fields, present: true});
    }
    measures.indexAudit.push({collection: 'contacts', fields: 'sigla ASC', present: true, singleField: true}, {collection: 'stations', fields: 'order ASC', present: true, singleField: true});
    measures.indexAuditNote = 'O emulador não comprova exigência/disponibilidade de índices compostos em produção; auditoria somente do manifesto local.';
  });
}
