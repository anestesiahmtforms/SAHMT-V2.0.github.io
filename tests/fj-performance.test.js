import test from 'node:test';
import assert from 'node:assert/strict';
import {fjEventPoints,reconcileFjPerformance} from '../worker-operational-domain/fj-performance.js';

test('FJ scores only active delays and absences',()=>{
  for (let n=0;n<=6;n++) assert.equal(fjEventPoints({active:true,eventType:'ATRASO',delayMultiple:n}),n ? -n/2 : 0);
  assert.equal(fjEventPoints({active:true,eventType:'Ausência'}),-5);
  assert.equal(fjEventPoints({active:true,eventType:'Falta'}),-5);
  assert.equal(fjEventPoints({active:true,eventType:'Saúde'}),0);
  assert.equal(fjEventPoints({active:false,eventType:'Ausência'}),0);
  assert.equal(fjEventPoints({active:true,status:'CANCELLED',eventType:'Falta'}),0);
  assert.throws(()=>fjEventPoints({active:true,eventType:'ATRASO',delayMultiple:null}),{code:'DOMAIN_FJ_DELAY_INVALID'});
});

test('FJ reconciles retries, edits, reassignments and cancellations without double counting',async()=>{
  const documents = new Map([
    ['contacts/AA',{sigla:'AA',email:'first@example.test'}],
    ['contacts/BB',{sigla:'BB',email:'second@example.test'}]
  ]);
  const tx = {
    async get(collection,id){const data=documents.get(collection+'/'+id);return data?{data}:null;},
    async findFjUsers(email){const id=email.split('@')[0];return [{id,data:{uid:id}}];},
    setFjPerformance(collection,id,data){documents.set(collection+'/'+id,data);}
  };
  const store = {transaction:fn=>fn(tx)};
  const event = {active:true,date:'2026-11-13',memberSigla:'AA',eventType:'ATRASO',delayMultiple:1};
  const reconcile = async patch => {
    documents.set('events/event',{...event,...patch});
    await reconcileFjPerformance(store,'event');
  };
  const total = uid => documents.get('fjPerformanceSummaries/'+uid).total;
  await reconcile({});
  await reconcile({});
  assert.equal(total('first'),-0.5);
  await reconcile({delayMultiple:3});
  assert.equal(total('first'),-1.5);
  await reconcile({memberSigla:'BB',eventType:'Ausência'});
  assert.equal(total('first'),0);
  assert.equal(total('second'),-5);
  await reconcile({active:false});
  assert.equal(total('second'),0);
  assert.equal(documents.get('fjPerformanceLedger/event').points,0);
});
