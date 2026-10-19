import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOfflineReadiness, inspectDeviceStorage} from '../src/offline-readiness.js';
import {prepareOperationalData} from '../src/offline-preparation.js';
test('cache vazio não é declarado preparado e não gera consultas remotas', async () => {
  const result = await inspectOfflineReadiness({uid: 'fixture', day: '2026-10-19', assetsReady: true, readCache: async () => null});
  for (const module of Object.values(result.modules)) {assert.equal(module.formsReady, false); assert.equal(module.dailyReportReady, false);}
});
test('prontidão exige 28 arsenais distintos e separa formulários de histórico local', async () => {
  const fixtures = {stations: Array.from({length: 28}, (_, i) => ({id: String(i), active: i < 25})), labelStaff: ['AA'], eventMembers: [{sigla: 'AA'}], eventCatalogs: {payers: ['Exemplo'], creditors: ['Exemplo']}, scheduleDays: {positions: ['AA']}};
  const result = await inspectOfflineReadiness({uid: 'fixture', day: '2026-10-19', assetsReady: true, readCache: async (_uid, kind) => fixtures[kind] ? {data: fixtures[kind]} : null});
  for (const module of Object.values(result.modules)) {assert.equal(module.formsReady, true); assert.equal(module.dailyReportReady, false);}
  assert.equal(result.modules.labels.entryMode, 'manual');
});
test('preparação aproveita cópia existente e nunca consulta coleções sem permissão', async () => {
  const calls = [];
  const result = await prepareOperationalData({uid: 'fixture', day: '2026-10-19', allows: names => names.includes('labelsWrite'), readCache: async (_uid, kind) => kind === 'appConfig' ? {data: {}} : null, loaders: {labelStaff: async () => calls.push('labelStaff')}});
  assert.deepEqual(calls, ['labelStaff']); assert.equal(result.length, 2);
});
test('troca de usuário interrompe preparação sem iniciar os itens seguintes', async () => {
  let current = true, calls = 0;
  await prepareOperationalData({uid: 'fixture', day: '2026-10-19', allows: () => true, isCurrent: () => current, readCache: async () => null, loaders: {appFeatures: async () => {current = false; calls++;}}});
  assert.equal(calls, 1);
});

test('iPhone identifica Tela de Início e apresenta persistência e uso sem consultar servidores', async () => {
  let requested = 0;
  const result = await inspectDeviceStorage({navigator: {userAgent: 'iPhone', standalone: true, storage: {persisted: async () => false, persist: async () => {requested++; return true;}, estimate: async () => ({usage: 1024, quota: 4096})}}, requestPersistence: true});
  assert.equal(result.appleMobile, true); assert.equal(result.standalone, true); assert.equal(result.persistent, true); assert.equal(result.usageBytes, 1024); assert.equal(requested, 1);
});

test('Safari antigo e falha na API de armazenamento não impedem a interface offline', async () => {
  const result = await inspectDeviceStorage({navigator: {userAgent: 'iPad', storage: {persisted: async () => {throw new Error('unavailable');}}}});
  assert.equal(result.persistent, null); assert.equal(result.usageBytes, null); assert.equal(result.appleMobile, true);
});
