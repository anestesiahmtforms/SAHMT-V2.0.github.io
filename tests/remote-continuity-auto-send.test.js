import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmRemoteContinuityOperations} from '../src/remote-continuity-auto-send.js';
const operation={uid:'member',type:'checklists',requestId:'same-id',payload:{data:{date:'2026-10-20'}},status:'awaiting-confirmation',nextAttemptAt:0};
const receipt={uid:'member',requestId:'same-id',localRequestId:'same-id',collection:'checklists',day:'2026-10-20',shared:true,state:'pending'};
function harness(extra={}){const confirmed=[];return {confirmed,run:()=>confirmRemoteContinuityOperations({uid:'member',listOperations:async()=>[operation],listReceipts:async()=>[receipt],authorize:()=>true,isCurrent:()=>true,confirm:async(uid,id)=>{confirmed.push(id);return true;},...extra})};}
test('envia automaticamente somente operação com recibo remoto e permissão atual',async()=>{const h=harness();assert.equal(await h.run(),1);assert.deepEqual(h.confirmed,['same-id']);});
test('não confirma fila apenas local, conflito, revogação ou troca de conta',async()=>{
 for(const extra of [{listReceipts:async()=>[]},{listOperations:async()=>[{...operation,status:'conflict'}]},{authorize:()=>false},{isCurrent:()=>false},{listOperations:async()=>[{...operation,nextAttemptAt:Date.now()+60000}]}]){
  const h=harness(extra);assert.equal(await h.run(),0);assert.equal(h.confirmed.length,0);
 }
});
test('recibo de outra data não autoriza uma operação diferente com o mesmo ID',async()=>{
 const h=harness({listReceipts:async()=>[{...receipt,day:'2026-10-19'}]});assert.equal(await h.run(),0);
});
