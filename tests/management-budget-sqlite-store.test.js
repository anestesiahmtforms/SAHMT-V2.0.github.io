import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createManagementSqliteStore} from '../scripts/lib/management-budget-sqlite-store.js';
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66';
function fixture(options={}) {
  const db=new DatabaseSync(':memory:');let calls=0;
  const storage={sql:{exec(sql,...bindings){calls++;return db.prepare(sql).all(...bindings);}},
    transactionSync(work){db.exec('BEGIN');try{const value=work();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const store=createManagementSqliteStore({storage,maxStateBytes:10240,...options});
  return {db,storage,store,calls:()=>calls,close:()=>db.close()};
}
const seed=value=>({state:{schemaVersion:1,value},result:{ok:true,value}});
test('SQLite namespaces FA/FB separados e dados duráveis entre instâncias do adapter',async()=>{
  const f=fixture();try{
    await f.store.transact(FA,()=>seed(1));await f.store.transact(FB,()=>seed(2));
    const restarted=createManagementSqliteStore({storage:f.storage,maxStateBytes:10240});
    assert.equal((await restarted.transact(FA,s=>({state:s,result:{value:s.value}}))).value,1);
    assert.equal((await restarted.transact(FB,s=>({state:s,result:{value:s.value}}))).value,2);
  }finally{f.close();}
});
test('concorrência conserva todos os incrementos sob transação SQL real',async()=>{
  const f=fixture();try{
    await f.store.transact(FA,()=>seed(0));
    await Promise.all(Array.from({length:40},()=>f.store.transact(FA,s=>seed(s.value+1))));
    assert.equal((await f.store.transact(FA,s=>({state:s,result:s.value}))),40);
  }finally{f.close();}
});
test('snapshot transform é isolado; exceção produz rollback integral',async()=>{
  const f=fixture();try{
    await f.store.transact(FA,()=>seed(7));
    await assert.rejects(f.store.transact(FA,s=>{s.value=100;throw Error('private-never-exposed');}),{code:'BUDGET_SQLITE_UNAVAILABLE'});
    assert.equal(await f.store.transact(FA,s=>({state:s,result:s.value})),7);
  }finally{f.close();}
});
test('resultado e estado não mantêm referências mutáveis do caller',async()=>{
  const f=fixture();try{
    const original={schemaVersion:1,nested:{n:1}}, result={n:2};
    const returned=await f.store.transact(FA,()=>({state:original,result}));
    original.nested.n=900;result.n=900;returned.n=900;
    assert.equal(await f.store.transact(FA,s=>({state:s,result:s.nested.n})),1);
  }finally{f.close();}
});
test('transform async é negado sem modificar estado',async()=>{
  const f=fixture();try{
    await f.store.transact(FA,()=>seed(1));
    await assert.rejects(f.store.transact(FA,async()=>seed(9)),{code:'BUDGET_TRANSFORM_INVALID'});
    assert.equal(await f.store.transact(FA,s=>({state:s,result:s.value})),1);
  }finally{f.close();}
});
test('dados não JSON e estado grande são negados com rollback',async t=>{
  for(const value of [undefined,NaN,new Map(),()=>1,'x'.repeat(12000)]) await t.test(typeof value,async()=>{
    const f=fixture();try{
      await f.store.transact(FA,()=>seed(1));await assert.rejects(f.store.transact(FA,()=>seed(value)));
      assert.equal(await f.store.transact(FA,s=>({state:s,result:s.value})),1);
    }finally{f.close();}
  });
});
test('estado corrompido persistido não é tratado como estado inicial',async()=>{
  const f=fixture();try{
    await f.store.transact(FA,()=>seed(1));
    f.db.prepare('UPDATE sahmt_management_read_budget SET payload = ? WHERE project_id = ?').run('{',FA);
    let transformed=false;await assert.rejects(f.store.transact(FA,()=>{transformed=true;return seed(99);}),{code:'BUDGET_STATE_INVALID'});
    assert.equal(transformed,false);
  }finally{f.close();}
});
test('projeto desconhecido e cancelamento prévio não fazem SQL',async()=>{
  const f=fixture();try{
    const controller=new AbortController();controller.abort();
    await assert.rejects(f.store.transact('other',()=>seed(1)),{code:'BUDGET_STORAGE_REQUEST_INVALID'});
    await assert.rejects(f.store.transact(FA,()=>seed(1),{signal:controller.signal}),{code:'BUDGET_STORAGE_CANCELLED'});
    assert.equal(f.calls(),0);
  }finally{f.close();}
});
test('cancelamento durante transform impede commit e preserva state anterior',async()=>{
  const f=fixture();try{
    await f.store.transact(FA,()=>seed(1));const controller=new AbortController();
    await assert.rejects(f.store.transact(FA,()=>{controller.abort();return seed(9);},{signal:controller.signal}),{code:'BUDGET_STORAGE_CANCELLED'});
    assert.equal(await f.store.transact(FA,s=>({state:s,result:s.value})),1);
  }finally{f.close();}
});
test('deadline antes do commit faz rollback; deadline depois retém débito sem recibo',async()=>{
  let time=0;const f=fixture({now:()=>time});try{
    await f.store.transact(FA,()=>seed(1));
    await assert.rejects(f.store.transact(FA,()=>{time=11;return seed(9);},{deadlineMs:10}),{code:'BUDGET_STORAGE_DEADLINE_EXCEEDED'});
    time=0;assert.equal(await f.store.transact(FA,s=>({state:s,result:s.value})),1);
    const native=f.storage.transactionSync;
    f.storage.transactionSync=work=>{const value=native(work);time=11;return value;};
    await assert.rejects(f.store.transact(FA,()=>seed(8),{deadlineMs:10}),{code:'BUDGET_STORAGE_DEADLINE_EXCEEDED'});
    time=0;f.storage.transactionSync=native;
    assert.equal(await f.store.transact(FA,s=>({state:s,result:s.value})),8);
  }finally{f.close();}
});

test('JSON não descarta silenciosamente holes, propriedades de array ou symbols',async t=>{
  const sparse=[];sparse.length=2;const extra=[];extra.a=1;const symbol={};symbol[Symbol("hidden")]=1;
  for(const value of [sparse,extra,symbol]) await t.test("invalid",async()=>{
    const f=fixture();try{await f.store.transact(FA,()=>seed(1));await assert.rejects(f.store.transact(FA,()=>seed(value)),{code:"BUDGET_STATE_INVALID"});}
    finally{f.close();}
  });
});
test('status sem alteração não regrava a linha SQLite',async()=>{
  const f=fixture();try{
    let writes=0;const native=f.storage.sql.exec;f.storage.sql.exec=(sql,...args)=>{if(sql.startsWith("INSERT"))writes++;return native(sql,...args);};
    await f.store.transact(FA,()=>seed(1));assert.equal(writes,1);
    await f.store.transact(FA,s=>({state:s,result:{ok:true}}));assert.equal(writes,1);
  }finally{f.close();}
});

test('payload persistido null/primitive/array nunca reinicializa um orçamento',async t=>{
  for(const payload of ["null","[]","1","true",'"text"']) await t.test(payload,async()=>{
    const f=fixture();try{
      await f.store.transact(FA,()=>seed(1));f.db.prepare("UPDATE sahmt_management_read_budget SET payload = ? WHERE project_id = ?").run(payload,FA);
      let called=false;await assert.rejects(f.store.transact(FA,()=>{called=true;return seed(0);}),{code:"BUDGET_STATE_INVALID"});assert.equal(called,false);
      assert.equal(f.db.prepare("SELECT payload FROM sahmt_management_read_budget WHERE project_id = ?").get(FA).payload,payload);
    }finally{f.close();}
  });
});
