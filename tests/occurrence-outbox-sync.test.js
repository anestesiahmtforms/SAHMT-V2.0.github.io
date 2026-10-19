import test from 'node:test';
import assert from 'node:assert/strict';
import {syncOccurrenceOperation} from '../src/occurrence-outbox-sync.js';

const id='10000000-0000-4000-8000-000000000001';
const operation={requestId:id,resourceId:id,uid:'uid-a',type:'occurrences',payload:{formId:'F01',values:{occurrence:'sintética'},displayName:'Pessoa',anonymous:false,createdAtClient:100},attempts:0};

function harness({save,uid='uid-a',current=true,operationValue=operation,now=10_000}={}){
 const calls=[];
 const outbox={
  removeQueuedOperation:async(...args)=>{calls.push(['remove',...args]);return true;},
  updateQueuedOperation:async(...args)=>{calls.push(['update',...args]);return true;}
 };
 const repository={save:async value=>{calls.push(['save',value]);return save?save(value):{status:'saved',id};}};
 return {calls,run:()=>syncOccurrenceOperation({operation:operationValue,uid,repository,outbox,isCurrent:()=>current,now:()=>now})};
}

test('ack saved ou already-saved remove a fila somente usando o requestId original',async()=>{
 for(const status of ['saved','already-saved']){
  const h=harness({save:async input=>({status,id:input.recordId})});
  assert.equal(await h.run(),'synced');
  assert.deepEqual(h.calls[0],['save',{...operation.payload,uid:'uid-a',recordId:id}]);
  assert.deepEqual(h.calls[1],['remove','uid-a',id]);
  assert.equal(h.calls.length,2);
 }
});

test('falha transitória mantém pendente com backoff e não remove o envio',async()=>{
 const h=harness({save:async()=>{throw Error('OCCURRENCE_TRANSIENT_WRITE_FAILED');}});
 assert.equal(await h.run(),'queued');
 assert.equal(h.calls.length,2);
 assert.equal(h.calls[0][0],'save');assert.equal(h.calls[1][0],'update');
 assert.equal(h.calls[1][3].status,'queued');assert.equal(h.calls[1][3].attempts,1);
 assert.equal(h.calls[1][3].nextAttemptAt,12_000);assert.equal(h.calls[1][3].lastErrorCode,'unavailable');
});

test('limite temporário ao recarregar catálogo mantém item pendente',async()=>{
 const h=harness({save:async()=>{throw Error('OCCURRENCE_CATALOG_READ_UNAVAILABLE');}});
 assert.equal(await h.run(),'queued');
 assert.equal(h.calls[1][3].status,'queued');assert.equal(h.calls[1][3].lastErrorCode,'unavailable');
});

test('negação e reconciliação movem a operação para revisão sem retry automático',async()=>{
 for(const [message,expectedCode] of [['OCCURRENCE_PERMISSION_DENIED','permission-denied'],['OCCURRENCE_RECONCILIATION_REQUIRED','reconciliation-required']]){
  const h=harness({save:async()=>{throw Error(message);}});
  assert.equal(await h.run(),'needs-review');
  assert.equal(h.calls[1][3].status,'failed');assert.equal(h.calls[1][3].lastErrorCode,expectedCode);
 }
});

test('operação de outra identidade ou sessão trocada não é enviada nem alterada',async()=>{
 const other=harness({uid:'uid-b'});
 assert.equal(await other.run(),'deferred');assert.equal(other.calls.length,0);
 const stale=harness({current:false});
 assert.equal(await stale.run(),'deferred');assert.equal(stale.calls.length,0);
});

test('ID inconsistente é marcado para revisão antes de chamar o repositório',async()=>{
 const malformed={...operation,resourceId:'other-id'};
 const h=harness({operationValue:malformed});
 assert.equal(await h.run(),'needs-review');assert.equal(h.calls.length,1);
 assert.equal(h.calls[0][0],'update');assert.equal(h.calls[0][3].lastErrorCode,'invalid-outbox-operation');
});
