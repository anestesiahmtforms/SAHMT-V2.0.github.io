import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {checklistCacheId, checklistCachedCatalogMatches} from '../src/offline-report-cache.js';
import {stationIsInDateRange} from '../src/checklist-qr.js';
import {projectPendingSchedule} from '../src/offline-schedule-overlay.js';
import {resolveChecklistRotation} from '../src/checklist-rotation.js';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('relatório Checklist local emite a mesma estrutura por fonte do adaptador online', async () => {
  const stations = [{id: 'station', active: true}], records = [{id: 'answer', stationId: 'station', date: '2026-10-19', condition: 'SIM'}];
  const cached = {stations, checklists: {stationIds: ['station'], records}, scheduleDays: {id: '2026-10-19', positions: [{position: 1, sigla: 'AA'}, {position: 2, sigla: 'BB'}]}, vacations: [], eventMembers: [{id: 'BB', sigla: 'BB', name: 'Substituto sintético', active: true}]};
  const ctx = vm.createContext({session: {status: 'signed-in', user: {uid: 'fixture'}}, checklistCacheId, checklistCachedCatalogMatches, stationIsInDateRange, projectPendingSchedule, resolveChecklistRotation,
    listUnsettledOperations: async () => [{uid: 'fixture', requestId: 'local-event', type: 'events', status: 'awaiting-confirmation', payload: {collectionName: 'events', data: {date: '2026-10-19', scheduleSigla: 'AA', memberSigla: 'AA'}}}],
    readFreshSafeCache: async (_uid, kind) => kind in cached ? {data: cached[kind]} : null,
    readOperationalDraft: async () => null, checklistLocalIntent: null});
  vm.runInContext(source.slice(source.indexOf('async function emitCachedOfflineReport('), source.indexOf('async function subscribeLiveReport(')), ctx);
  const emitted = new Map();
  await ctx.emitCachedOfflineReport('checklist', {uid: 'fixture', day: '2026-10-19', mode: 'daily'}, {isCurrent: () => true, next: (key, event) => emitted.set(key, event)});
  assert.equal(emitted.get('catalog').data.records.length, 1);
  assert.equal(emitted.get('report').data.records?.length, 1);
  assert.equal(emitted.get('report').data.report, undefined);
  assert.equal(emitted.get('report').fromCache, true);
  assert.equal(ctx.checklistRotationLive.rotation.sigla, 'BB');
});

test('a missing local report never waits for remote continuity before the Firestore query can start',async()=>{
 const calls=[];
 const ctx=vm.createContext({session:{status:'signed-in',user:{uid:'fixture'}},checklistCacheId,checklistCachedCatalogMatches,stationIsInDateRange,
  readFreshSafeCache:async(uid,kind,id,options)=>{calls.push({kind,localOnly:options?.localOnly});return options?.localOnly?null:new Promise(()=>{});}});
 vm.runInContext(source.slice(source.indexOf('async function emitCachedOfflineReport('),source.indexOf('async function subscribeLiveReport(')),ctx);
 const work=ctx.emitCachedOfflineReport('checklist',{uid:'fixture',day:'2026-10-26',mode:'daily',localOnly:false},{isCurrent:()=>true,next(){}});
 const result=await Promise.race([work,new Promise(resolve=>setImmediate(()=>resolve('blocked-by-remote-cache')))]);
 assert.equal(result,false);assert.deepEqual(calls,[{kind:'stations',localOnly:true}]);
});
