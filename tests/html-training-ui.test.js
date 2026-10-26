import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';

let model;
try { model = await import('../src/html-training-model.js'); } catch {}
test('reader isolates untrusted HTML behind a restrictive CSP and preserves its body only in srcdoc', () => {
  assert.ok(model, 'training security model must exist');
  const html = model.readerDocument('<script>parent.pwned=1</script><img src="https://invalid.test/a">', 'uid-x', '25/10/2026');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /uid-x/);
});
test('bounded cache keeps content per account/version and never stores question keys', () => {
  assert.ok(model, 'training security model must exist');
  const values = new Map();
  const storage = { getItem:k => values.get(k), setItem:(k,v) => values.set(k,v), removeItem:k=>values.delete(k) };
  const cache = model.createContentCache(storage);
  cache.put('u1','t',1,{sections:[{id:'s',title:'Seção',html:'<p>Texto</p>'}],bank:[{correctOptionId:'secret'}]});
  assert.equal(cache.get('u2','t',1), null);
  assert.equal(cache.get('u1','t',2), null);
  assert.equal(cache.get('u1','t',1).sections[0].title, 'Seção');
  assert.ok(![...values.values()].join('').includes('secret'));
  for (let i=0;i<15;i++) cache.put('u1',String(i),1,{sections:[{html:'x'}]});
  assert.ok(JSON.parse([...values.values()][0]).length <= 8);
});
test('management affordance is tied to training manager UID or institutional admin', () => {
  assert.ok(model, 'training security model must exist');
  assert.equal(model.canManageTraining({managerUid:'m'},{uid:'m'},{}),true);
  assert.equal(model.canManageTraining({managerUid:'m'},{uid:'other'},{role:'manager'}),false);
  assert.equal(model.canManageTraining({}, {uid:'a'}, {role:'administrador_app'}),true);
});

test('illustrated content persists across cache instances without entering localStorage or crossing accounts',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const first=model.createContentCache(storage,{indexedDB});
 const content={sections:[{id:'s',title:'Figura',html:'<p>'+'x'.repeat(2300000)+'</p>'}],bank:[{correctOptionId:'never-cache'}],revision:3};
 await first.put('illustrated-user','training-large',3,content);
 const second=model.createContentCache(storage,{indexedDB});
 assert.equal((await second.read('illustrated-user','training-large',3)).sections[0].html,content.sections[0].html);
 assert.equal(await second.read('another-user','training-large',3),null);
 assert.equal(await second.read('illustrated-user','training-large',4),null);
 assert.equal(JSON.stringify([...values.values()]).includes('never-cache'),false);
});
