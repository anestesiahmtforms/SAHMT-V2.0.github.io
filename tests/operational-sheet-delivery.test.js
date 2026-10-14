import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';

const source=readFileSync(new URL('../src/operational-sheet-delivery.js',import.meta.url),'utf8')
  .replaceAll('export async function','async function')
  .replace('import.meta.env?.VITE_OPERATIONAL_SHEETS_ENDPOINT','configuredEndpoint')
  .replace("await import('./firebase-auth.js')",'({auth: testAuth})');
function setup({offline=false,storageFailure=false,enabled=true}={}) {
  const calls=[],auth={currentUser:{uid:'synthetic-user',getIdToken:async()=> 'synthetic-token'}};
  const c=vm.createContext({Map,Set,Promise,URL,Error,JSON,IDBKeyRange,AbortController,setTimeout,clearTimeout,
    indexedDB:storageFailure?{open:()=>{throw Error('STORAGE_DENIED');}}:new IDBFactory(),
    navigator:{onLine:!offline},testAuth:auth,
    configuredEndpoint:enabled?'https://worker.example/v1/operational-sheets/notify':'',
    fetch:async(url,options)=>{calls.push({url,options});return Response.json({code:'CONTROLE_REGISTRO_RECEBIDO'});}});
  vm.runInContext(source,c);
  return {c,calls,auth};
}
test('unconfirmed or failed primary writes never trigger a Firestore read',async()=>{
  const {c,calls}=setup();
  await c.prepareOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');
  assert.equal(calls.length,0);
  await c.confirmOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');
  assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(calls[0].options.body),{collection:'events',id:'synthetic-event'});
});
test('offline confirmation is delivered upon reconnection without periodic polling',async()=>{
  const {c,calls}=setup({offline:true});
  await c.confirmOperationalSheetDelivery('checklists','synthetic-check','synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');assert.equal(calls.length,0);
  c.navigator.onLine=true;await c.flushOperationalSheetDelivery('synthetic-user');
  assert.equal(calls.length,1);
});
test('delivery failure is retained and retried only on a later explicit flush',async()=>{
  const {c,calls}=setup();let attempts=0;
  c.fetch=async()=>{attempts++;return Response.json({code:'CONTROLE_ENVIO_INDISPONIVEL'},{status:503});};
  await c.confirmOperationalSheetDelivery('labels','synthetic-label','synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');assert.equal(attempts,1);
  c.fetch=async()=>{calls.push(1);return Response.json({code:'CONTROLE_REGISTRO_JA_RECEBIDO'});};
  await c.flushOperationalSheetDelivery('synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');assert.equal(calls.length,1);
});
test('storage failure cannot prevent primary write preparation or confirmed delivery',async()=>{
  const {c,calls}=setup({storageFailure:true});
  await c.prepareOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  await c.confirmOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');assert.equal(calls.length,1);
});
test('logout or account switch during token retrieval cannot send previous-user metadata',async()=>{
  const {c,calls,auth}=setup();
  await c.confirmOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  auth.currentUser.getIdToken=async()=>{auth.currentUser={uid:'another-user'};return 'synthetic-token';};
  await c.flushOperationalSheetDelivery('synthetic-user');
  await c.flushOperationalSheetDelivery('another-user');assert.equal(calls.length,0);
});
test('queue persists only resource metadata and does not downgrade confirmed items',async()=>{
  const {c}=setup();
  await c.confirmOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  await c.prepareOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  const records=await c.pending('synthetic-user');assert.equal(records.length,1);
  assert.deepEqual(Object.keys(records[0]).sort(),['collection','id','key','state','uid']);
});
test('newly confirmed item joins an existing flush without duplicate attempts',async()=>{
  const {c,calls}=setup();
  c.fetch=async(_url,options)=>{
    calls.push(JSON.parse(options.body).id);
    if(calls.length===1){
      await c.confirmOperationalSheetDelivery('events','synthetic-second','synthetic-user');
      void c.flushOperationalSheetDelivery('synthetic-user');
    }
    return Response.json({code:'CONTROLE_REGISTRO_RECEBIDO'});
  };
  await c.confirmOperationalSheetDelivery('events','synthetic-first','synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');
  assert.deepEqual(calls,['synthetic-first','synthetic-second']);
});
test('disabled integration and unsupported mutations never call relay',async()=>{
  const {c,calls}=setup({enabled:false});
  await c.confirmOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');assert.equal(calls.length,0);
  const other=setup();
  await other.c.confirmOperationalSheetDelivery('eventEdits','synthetic-event','synthetic-user');
  await other.c.flushOperationalSheetDelivery('synthetic-user');assert.equal(other.calls.length,0);
});
test('authenticated tombstone response settles delivery without resurrecting deleted records',async()=>{
  const {c,calls}=setup();
  c.fetch=async()=>{calls.push(1);return Response.json({code:'CONTROLE_REGISTRO_REMOVIDO'},{status:409});};
  await c.confirmOperationalSheetDelivery('events','synthetic-event','synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');
  await c.flushOperationalSheetDelivery('synthetic-user');assert.equal(calls.length,1);
});
