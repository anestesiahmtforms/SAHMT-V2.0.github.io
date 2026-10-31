import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTargetedAppUpdates, deviceUpdateState, devicePlatform, installationId, recoveryUrl, updateRequest, newAppUpdateId, appDisplayMode, deviceInstallationLabel} from '../src/app-updates-targeted.js';
import {requestUpdatesForUsers} from '../src/app-updates-targeted-batch.js';
import {addAppUpdateRules} from '../scripts/lib/app-update-rules.js';
import {APP_VERSION,deviceVersionLabel} from '../src/app-version.js';
const request = (id = 'request-1234567890123456') => ({id,target:'FA',minimumRelease:200});
const session = (uid = 'member', r = null, extra = {}) => ({status:'signed-in',user:{uid},profile:{uid,appUpdateRequest:r},offline:false,...extra});
function fixture(release = 100, deviceId = 'device-a', storage = new Map()) {
  const records = [], gates = [], repairs = [];
  const options = {target:'FA',release,deviceId,platform:'Android',storage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    record:async value=>records.push(value),enforce:value=>gates.push(value),repair:value=>{repairs.push(value);return false;},now:()=>10000};
  return {records,gates,repairs,options,controller:createTargetedAppUpdates(options)};
}
const flush = () => new Promise(resolve=>setImmediate(resolve));
test('only selected accounts and the matching app are blocked at their first confirmed opening',async()=>{
  const f=fixture(); f.controller.setSession(session('member',request(),{offline:true})); assert.equal(f.controller.blocked,false);
  f.controller.setSession(session('member',request())); assert.equal(f.controller.blocked,true);
  assert.equal(f.gates.at(-1).automatic,true); assert.equal(f.gates.at(-1).retry(),false);
  await flush(); assert.equal(f.records[0].confirmedRequestId,''); assert.equal(f.repairs.length,1);
  for(const r of [null,{...request(),target:'FB'}]) {const other=fixture(); other.controller.setSession(session('other',r));assert.equal(other.controller.blocked,false);}
});
test('a second device remains pending when the first device loads the requested version',async()=>{
  const a=fixture(200,'device-a'),b=fixture(100,'device-b');
  a.controller.setSession(session('member',request())); b.controller.setSession(session('member',request()));await flush();
  assert.equal(deviceUpdateState(a.records[0],request()),'Confirmado');
  assert.equal(a.records[0].appVersion,APP_VERSION);assert.equal(APP_VERSION,'V2.1');
  assert.equal(deviceVersionLabel({appVersion:'V2.10'}),'V2.10');assert.equal(deviceVersionLabel({}), 'Versão não informada');
  assert.equal(deviceUpdateState(b.records[0],request()),'Pendente');
  assert.equal(b.controller.blocked,true);assert.equal(a.controller.blocked,false);
  assert.equal(deviceUpdateState(a.records[0],request('new-request-123456789')),'Pendente');
});
test('a new request never reloads a form in the current session; reopening enforces it without a loop',async()=>{
  const storage=new Map(),f=fixture(100,'same',storage);
  f.controller.setSession(session());f.controller.setSession(session('member',request()));
  assert.equal(f.controller.blocked,false);assert.equal(f.repairs.length,0);
  const second=fixture(100,'same',storage);second.controller.setSession(session('member',request()));assert.equal(second.gates.at(-1).automatic,true);
  const third=fixture(100,'same',storage);third.controller.setSession(session('member',request()));assert.equal(third.gates.at(-1).automatic,false);assert.equal(third.controller.blocked,true);
  third.controller.setSession(session('member',null));assert.equal(third.controller.blocked,false);
  await flush();
});
test('account changes invalidate late device writes and retries remain possible after write failure',async()=>{
  const f=fixture(200);f.controller.setSession(session('a',request()));f.controller.setSession({status:'signed-out'});await flush();assert.equal(f.records.length,0);
  let attempts=0;
  const c=createTargetedAppUpdates({...f.options,record:async()=>{if(++attempts===1)throw Error('offline');}});
  c.setSession(session('b',request()));await flush();c.setSession(session('b',request()));await flush();assert.equal(attempts,2);
});
test('restricted storage keeps the mandatory manual gate without automatic reload loops',()=>{
  for(const storage of [null,{getItem(){throw Error('denied');}},{getItem(){return null;},setItem(){throw Error('quota');}}]){
    const f=fixture();const c=createTargetedAppUpdates({...f.options,storage});c.setSession(session('member',request()));assert.equal(c.blocked,true);assert.equal(f.gates.at(-1).automatic,false);
  }
});
test('device identity persists separately from authentication; iPhone, iPad and Android are identified',()=>{
  const store=new Map(),storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
  assert.equal(installationId(storage),installationId(storage));
  assert.notEqual(installationId(storage),installationId(storage,undefined,'standalone'));
  assert.equal(appDisplayMode({standalone:true}), 'standalone');
  assert.equal(appDisplayMode({},()=>({matches:true})), 'standalone');
  assert.equal(appDisplayMode({},()=>({matches:false})), 'browser');
  assert.equal(deviceInstallationLabel({platform:'iOS',displayMode:'standalone'}),'App da Tela de Início');
  assert.equal(deviceInstallationLabel({platform:'Android',displayMode:'standalone'}),'App instalado');
  assert.equal(deviceInstallationLabel({platform:'iOS',displayMode:'browser'}),'Navegador');
  assert.equal(devicePlatform({userAgent:'iPhone'}),'iOS');assert.equal(devicePlatform({userAgent:'Macintosh',maxTouchPoints:5}),'iOS');assert.equal(devicePlatform({userAgent:'Android'}),'Android');
  assert.match(recoveryUrl('FB','https://example.invalid'),/target=FB/);
  assert.equal(updateRequest({...request(),minimumRelease:NaN},'FA'),null);
  const olderCrypto={getRandomValues:values=>crypto.getRandomValues(values)};
  assert.match(newAppUpdateId(olderCrypto),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.match(installationId(null,olderCrypto),/^[a-f0-9-]{36}$/);
});
test('all users includes every active page, deduplicates accounts and reports partial failure accurately',async()=>{
  const users=Array.from({length:405},(_,i)=>({uid:'u'+i,active:true,access:true}));
  users.push(users[0],{uid:'blocked',active:true,access:false});
  const batches=[];const result=await requestUpdatesForUsers({users,release:200,sendBatch:async uids=>batches.push(uids)});
  assert.deepEqual(batches.map(row=>row.length),[200,200,5]);assert.equal(result.sent,405);assert.ok(!batches.flat().includes('blocked'));
  let calls=0;await assert.rejects(requestUpdatesForUsers({users,release:200,sendBatch:async()=>{if(++calls===2)throw Error('network');}}),error=>error.sent===200&&error.total===405);
});
test('rule patch is idempotent and the profile editor preserves an existing requirement',async()=>{
  for(const [path,target] of [['firestore.rules','FA'],['firestore.independent-fb.rules','FB']]){const source=await readFile(path,'utf8');assert.equal(addAppUpdateRules(source,target),source);}
  const source=await readFile('src/data.js','utf8');assert.match(source,/record.appUpdateRequest = current.data\(\).appUpdateRequest/);
});
