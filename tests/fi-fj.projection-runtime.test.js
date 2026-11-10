import test from 'node:test';
import assert from 'node:assert/strict';
import {projectionHeaders, verifyProjectionRequest, applyEventProjection, drainEventProjections} from '../worker-operational-domain/projection-runtime.js';
import {createOperationalDomainWorker} from '../worker-operational-domain/worker.js';
const secret = 'synthetic'.repeat(8), now = 1800000000000;
const event = {eventId: 'event', version: 2, date: '2026-11-06', active: true, scheduleSigla: 'AA', memberSigla: 'BB', actorUid: 'member'};
const body = JSON.stringify(event);

function trackReads(store){const calls=[],get=store.get.bind(store),list=store.listPending.bind(store);store.get=async(c,id)=>{calls.push(c+'/'+id);return get(c,id);};store.listPending=async()=>{calls.push('queue');return list();};return calls;}
test('disabled FI/FJ projection folders stop before queue or source reads and preserve pending entries',async()=>{
 for(const station of ['FI','FJ'])for(const disabled of [['operacao'],['operacao/eventos'],['operacao/escala']]){
  const store=memoryStore();store.documents.set('runtimePolicy/folders',{schemaVersion:1,revision:1,disabled});
  store.documents.set('eventProjectionOutbox/event-2',{status:'PENDING'});const calls=trackReads(store);
  const result=await drainEventProjections({station,store,secret,fetchImpl:()=>assert.fail('disabled queue must not deliver')});
  assert.equal(result.paused,true);assert.deepEqual(calls,['runtimePolicy/folders']);
  assert.deepEqual(store.documents.get('eventProjectionOutbox/event-2'),{status:'PENDING'});
 }
});
test('disabled target rejects a direct projection before receipt and schedule reads',async()=>{
 const store=memoryStore();store.documents.set('runtimePolicy/folders',{schemaVersion:1,revision:2,disabled:['operacao/escala']});const calls=trackReads(store);
 await assert.rejects(applyEventProjection(event,store),{code:'DOMAIN_FOLDER_DISABLED'});
 assert.deepEqual(calls,['runtimePolicy/folders']);assert.equal(store.documents.has('eventProjections/event'),false);
});
test('malformed operational policy fails closed before queue reads; unrelated siblings remain usable',async()=>{
 for(const policy of [{},{schemaVersion:1,revision:0,disabled:[]},{schemaVersion:1,revision:1,disabled:['operacao//bad']}]){
  const store=memoryStore();store.documents.set('runtimePolicy/folders',policy);const calls=trackReads(store);
  await assert.rejects(drainEventProjections({station:'FJ',store}),{code:'DOMAIN_FOLDER_POLICY_INVALID'});assert.deepEqual(calls,['runtimePolicy/folders']);
 }
 const store=memoryStore();store.documents.set('runtimePolicy/folders',{schemaVersion:1,revision:1,disabled:['operacao/pessoas','operacao/eventos-privados']});
 assert.equal((await applyEventProjection(event,store)).status,'APPLIED');
});
test('scheduled worker observes policy before queues and target pause leaves source outbox untouched',async()=>{
 const store=memoryStore();store.documents.set('runtimePolicy/folders',{schemaVersion:1,revision:1,disabled:['operacao']});const calls=trackReads(store),tasks=[];
 const worker=createOperationalDomainWorker({createService:()=>({accessToken:async()=>'synthetic'}),createStore:()=>store});
 await worker.scheduled({}, {MODULE_STATION:'FI',MODULE_PROJECT_ID:'sahmt-operacional-fi',MODULE_CUTOVER_ACTIVE:'true',MODULE_SERVICE_ACCOUNT_JSON:'{}',EVENT_PROJECTION_SHARED_SECRET:secret},{waitUntil:promise=>tasks.push(promise)});
 await Promise.all(tasks);assert.deepEqual(calls,['runtimePolicy/folders']);
 store.documents.delete('runtimePolicy/folders');store.documents.set('events/event',{...event,updatedByUid:'member'});store.documents.set('eventProjectionOutbox/event-2',{status:'PENDING'});
 const result=await drainEventProjections({station:'FI',store,secret,fetchImpl:async()=>Response.json({code:'DOMAIN_FOLDER_DISABLED'},{status:403})});
 assert.equal(result.paused,true);assert.deepEqual(store.documents.get('eventProjectionOutbox/event-2'),{status:'PENDING'});
});
test('policy changes between queue discovery and processing stop before event reads',async()=>{
 const store=memoryStore();store.listPending=async()=>{store.documents.set('runtimePolicy/folders',{schemaVersion:1,revision:1,disabled:['operacao/eventos']});return [{id:'event-2',data:{eventId:'event',version:2}}];};const calls=trackReads(store);
 const result=await drainEventProjections({station:'FI',store,secret});assert.equal(result.paused,true);
 assert.deepEqual(calls,['runtimePolicy/folders','queue','runtimePolicy/folders']);
});
test('FJ consumes its own event outbox without a cross-project request or shared secret', async () => {
  const store = memoryStore();
  store.documents.set('events/event', {...event, updatedByUid:'member'});
  store.documents.set('eventProjectionOutbox/event-2', {status:'PENDING'});
  store.listPending = async () => [{id:'event-2', collection:'eventProjectionOutbox', data:{eventId:'event', version:2, status:'PENDING'}}];
  const result = await drainEventProjections({station:'FJ', store, fetchImpl:async () => {throw Error('UNEXPECTED_REMOTE_PROJECTION');}});
  assert.equal(result.completed, 1);
  assert.equal(store.documents.get('eventProjectionOutbox/event-2').status, 'DONE');
  assert.deepEqual(store.documents.get('scheduleDays/' + event.date).highlights.events, ['EVENTO:AA:BB:event']);
  assert.deepEqual(store.documents.get('scheduleDays/' + event.date).highlights.releaseTimes, {AA:now});
});
function memoryStore() {
  const documents = new Map([['scheduleDays/' + event.date, {id: event.date, version: 1, highlights: {events: [], siglas: ['AA'], releaseTimes: {AA: now}}}]]);
  return {documents, get: async (collection, id) => documents.has(collection + '/' + id) ? {data: documents.get(collection + '/' + id)} : null,
    listPending: async () => [{id: 'event-2', data: {eventId: 'event', version: 2, status: 'PENDING'}}],
    async transaction(callback) {
      return callback({get: this.get, setProjection: (id, value) => documents.set('eventProjections/' + id, value),
        patchSchedule: (id, value) => {const old = documents.get('scheduleDays/' + id); documents.set('scheduleDays/' + id,
          {...old, version: value.version, highlights: {...old.highlights, events: value.events}});},
        completeOutbox: (id, version) => documents.set('eventProjectionOutbox/' + id, {status: 'DONE', processedVersion: version}),
        deferOutbox: id => documents.set('eventProjectionOutbox/' + id, {...documents.get('eventProjectionOutbox/' + id), lastAttemptAt: now})});
    }};
}

test('signed internal requests reject changed bodies, signatures and expired timestamps', async () => {
  const headers = projectionHeaders(body, secret, {now: () => now});
  const request = extra => new Request('https://worker.test/internal/v1/event-projection', {method: 'POST', headers, body, ...extra});
  assert.deepEqual(await verifyProjectionRequest(request(), secret, {now: () => now}), event);
  await assert.rejects(verifyProjectionRequest(request({body: JSON.stringify({...event, memberSigla: 'ZZ'})}), secret, {now: () => now}), /DOMAIN_PROJECTION_SIGNATURE_INVALID/);
  await assert.rejects(verifyProjectionRequest(request(), secret, {now: () => now + 60001}), /DOMAIN_PROJECTION_SIGNATURE_INVALID/);
  await assert.rejects(verifyProjectionRequest(request(), 'another'.repeat(9), {now: () => now}), /DOMAIN_PROJECTION_SIGNATURE_INVALID/);
});

test('duplicate target deliveries use a receipt and preserve release state', async () => {
  const store = memoryStore();
  assert.equal((await applyEventProjection(event, store)).status, 'APPLIED');
  assert.equal((await applyEventProjection(event, store)).status, 'ALREADY_APPLIED');
  const schedule = store.documents.get('scheduleDays/' + event.date);
  assert.equal(schedule.version, 2); assert.deepEqual(schedule.highlights.events, ['EVENTO:AA:BB:event']);
  assert.deepEqual(schedule.highlights.siglas, ['AA']); assert.deepEqual(schedule.highlights.releaseTimes, {AA: now});
});

test('a failed FI delivery stays pending and a successful retry marks only the outbox done', async () => {
  const store = memoryStore();
  store.documents.set('events/event', {...event, updatedByUid: 'member'});
  store.documents.set('eventProjectionOutbox/event-2', {status: 'PENDING'});
  let failDelivery = true;
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://sahmt-fj-escala.sahmt-fj-563bc56a.workers.dev/internal/v1/event-projection');
    assert.equal(options.redirect, 'manual'); assert.equal(JSON.parse(options.body).eventId, 'event');
    return failDelivery ? Response.json({code: 'synthetic'}, {status: 503}) : Response.json({eventId: 'event', version: 2, status: 'APPLIED'});
  };
  assert.deepEqual(await drainEventProjections({station: 'FI', store, secret, fetchImpl}), {station: 'FI', completed: 0, failed: 1});
  assert.equal(store.documents.get('eventProjectionOutbox/event-2').status, 'PENDING');
  assert.equal(store.documents.get('eventProjectionOutbox/event-2').lastAttemptAt, now);
  failDelivery = false;
  assert.deepEqual(await drainEventProjections({station: 'FI', store, secret, fetchImpl}), {station: 'FI', completed: 1, failed: 0});
  assert.equal(store.documents.get('eventProjectionOutbox/event-2').status, 'DONE');
  assert.equal(store.documents.get('events/event').version, 2);
});

test('native sheet deletion projects removal from its immutable archive even when the tombstone omits event fields', async () => {
  const store=memoryStore();
  store.documents.set('events/event',{id:'event',active:false,sheetDeleted:true,sheetArchiveId:'archive',version:3});
  store.documents.set('operationalSheetArchives/archive',{sourceKey:'events/event',snapshotJson:JSON.stringify({
    name:'projects/sahmt-operacional-fi/databases/(default)/documents/events/event',
    fields:{date:{stringValue:event.date},scheduleSigla:{stringValue:'AA'},memberSigla:{stringValue:'BB'}}})});
  store.documents.set('eventProjectionOutbox/event-2',{status:'PENDING'});
  let delivered;
  const result=await drainEventProjections({station:'FI',store,secret,fetchImpl:async(_url,options)=>{
    delivered=JSON.parse(options.body);return Response.json({eventId:'event',version:3,status:'APPLIED'});
  }});
  assert.equal(result.completed,1);assert.equal(delivered.active,false);assert.equal(delivered.version,3);assert.equal(delivered.date,event.date);
  assert.equal(store.documents.get('eventProjectionOutbox/event-2').status,'DONE');
});
