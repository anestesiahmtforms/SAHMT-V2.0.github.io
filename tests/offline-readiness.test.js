import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOfflineReadiness, inspectDeviceStorage, operationalAssetsReady} from '../src/offline-readiness.js';
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
test('shell e manifest sozinhos não significam que os módulos estão disponíveis offline',async()=>{
 const previous=globalThis.caches;
 try{
  globalThis.caches={match:async path=>path.endsWith('assets-manifest.json')?{json:async()=>({'index.html':{isEntry:true,file:'assets/main.js'}})}:{}};
  assert.equal(await operationalAssetsReady('/SAHMT-V2.0.github.io/'),false);
 }finally{globalThis.caches=previous;}
});
test('prontidão verifica chunks e imports estáticos sem buscar PDF nem usar rede',async()=>{
 const previous=globalThis.caches,base='/SAHMT-V2.0.github.io/',calls=[];
 const manifest={'index.html':{isEntry:true,file:'assets/main.js',css:['assets/main.css'],imports:['_shared.js'],dynamicImports:['pdf']},
  '_shared.js':{file:'assets/shared.js'},'src/data.js':{file:'assets/data.js'},
  'src/checklist-report-listener.js':{file:'assets/checklist.js'},'src/label-report-reader.js':{file:'assets/labels.js'},pdf:{file:'assets/pdf.js'}};
 const paths=new Set(['','vendor/zxing.min.js','assets-manifest.json','assets/main.js','assets/main.css','assets/shared.js','assets/data.js','assets/checklist.js','assets/labels.js']);
 try{
  globalThis.caches={match:async path=>{calls.push(path);const key=path.slice(base.length);return !paths.has(key)?null:key==='assets-manifest.json'?{json:async()=>manifest}:{};}};
  assert.equal(await operationalAssetsReady(base),true);assert.ok(!calls.some(path=>path.endsWith('/pdf.js')));
  paths.delete('assets/checklist.js');assert.equal(await operationalAssetsReady(base),false);
  paths.add('assets/checklist.js');manifest['_shared.js'].imports=['missing'];assert.equal(await operationalAssetsReady(base),false);
 }finally{globalThis.caches=previous;}
});
test('falha no CacheStorage retorna preparação incompleta sem travar o painel',async()=>{
 const previous=globalThis.caches;
 try{globalThis.caches={match:async()=>{throw Error('STORAGE_DENIED');}};assert.equal(await operationalAssetsReady('/app/'),false);}
 finally{globalThis.caches=previous;}
});
