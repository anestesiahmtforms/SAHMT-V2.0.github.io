import test from 'node:test';
import assert from 'node:assert/strict';
import {sahmtPerformanceMarkup, mountSahmtPerformance} from '../src/sahmt-performance-ui.js';

const ready = {status:'READY',uid:'u1',canManage:false,batchId:'2026-11-07',cutoff:'2026-11-07T05:00:00Z',updatedAt:'2026-11-07T05:12:00Z',stale:false,summary:{total:-12.5,percentage:-25,byCategory:{OPERATIONS:-20,MANAGEMENT:7.5,RECORDS:0,SURVEYS:0,NOTIFICATIONS:0,CONTINUING_EDUCATION:0}}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function surface(){
 const listeners=new Map(),message={textContent:''};
 return {innerHTML:'',addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),replaceChildren(){this.innerHTML='';},querySelector:()=>message,
  click(dataset){listeners.get('click')?.({target:{closest:()=>({dataset})}});},
  submit(values,correction=false){const form={dataset:correction?{spCorrectionForm:''}:{spManualForm:''},elements:Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value}]))};listeners.get('submit')?.({preventDefault(){},target:{closest:()=>form}});},
  input(values){const form={elements:Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value}]))};listeners.get('input')?.({target:{closest:()=>form}});},
 };
}
test('negative totals and percentages remain signed, unavailable reference is explained, and admin form requires capability',()=>{
 const html=sahmtPerformanceMarkup(ready);
 assert.match(html,/-12,5/);assert.match(html,/-25\s*%/);assert.match(html,/02h00/);assert.match(html,/Brasília/);
 assert.equal((html.match(/data-sp-category=/g)||[]).length,6);
 assert.doesNotMatch(html,/<h1|<h2|data-sp-manual-form/);
 assert.match(sahmtPerformanceMarkup({...ready,summary:{...ready.summary,percentage:null}}),/referência positiva/);
 assert.match(sahmtPerformanceMarkup({...ready,canManage:true},{manualOpen:true}),/data-sp-manual-form/);
});
test('preparing and malformed snapshots never fabricate zero balances',()=>{
 for(const snapshot of [null,{status:'PREPARING'},{...ready,summary:{total:null}}]){
  const html=sahmtPerformanceMarkup(snapshot);assert.doesNotMatch(html,/data-sp-total|data-sp-category=/);assert.match(html,/Carregando|preparação/);
 }
});
test('training activities remain reachable from the consolidated panel for authorized profiles',async()=>{
 const root=surface();let opened=0;
 const request=async action=>action==='GET_SAHMT_PERFORMANCE'?ready:{batchId:ready.batchId,rows:[],nextCursor:null};
 mountSahmtPerformance(root,{request,onOpenTraining:()=>opened++});
 await tick();root.click({spCategory:'OPERATIONS'});await tick();
 assert.doesNotMatch(root.innerHTML,/data-sp-open-training/);
 root.click({spCategory:'MANAGEMENT'});await tick();
 assert.match(root.innerHTML,/data-sp-open-training/);
 root.click({spOpenTraining:''});assert.equal(opened,1);
 assert.doesNotMatch(sahmtPerformanceMarkup(ready,{category:'MANAGEMENT'}),/data-sp-open-training/);
});
test('history labels are escaped and stale completed batches remain visible',()=>{
 const html=sahmtPerformanceMarkup({...ready,canManage:true,stale:true},{category:'OPERATIONS',history:{rows:[{id:'x',source:'FG',points:-2,createdAt:'2026-11-06T12:00:00Z',label:'<img src=x onerror=alert(1)>'}],nextCursor:'next'}});
 assert.match(html,/desatualizada/);assert.match(html,/-12,5/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/Carregar mais/);
});
test('cleanup and session changes prevent late summary responses from restoring private data',async()=>{
 let release;const root=surface();const cleanup=mountSahmtPerformance(root,{request:()=>new Promise(resolve=>{release=resolve;})});
 assert.equal(typeof cleanup,'function');cleanup();release(ready);await tick();assert.equal(root.innerHTML,'');
 let current=true,releaseSecond;const other=surface();mountSahmtPerformance(other,{isCurrent:()=>current,request:()=>new Promise(resolve=>{releaseSecond=resolve;})});current=false;const before=other.innerHTML;releaseSecond(ready);await tick();assert.equal(other.innerHTML,before);
});
test('history paginates by cursor and a different returned batch cannot be mixed into the total',async()=>{
 const calls=[],root=surface();
 mountSahmtPerformance(root,{request:async(action,input)=>{calls.push({action,input});if(action==='GET_SAHMT_PERFORMANCE')return ready;return calls.length===2?{batchId:ready.batchId,rows:[{id:'first',source:'FG',points:-20,label:'Primeiro lançamento',createdAt:ready.cutoff}],nextCursor:'opaque'}:{batchId:'other',rows:[{id:'wrong',label:'Não deve aparecer',points:1000}],nextCursor:null};}});
 await tick();root.click({spCategory:'OPERATIONS'});await tick();assert.match(root.innerHTML,/Primeiro lançamento/);root.click({spMore:''});await tick();
 assert.deepEqual(calls[2],{action:'LIST_SAHMT_HISTORY',input:{category:'OPERATIONS',batchId:'2026-11-07',cursor:'opaque'}});assert.doesNotMatch(root.innerHTML,/Não deve aparecer/);assert.match(root.innerHTML,/apuração mudou/);
});
test('manual save retries reuse request identity and do not refresh confirmed totals or history',async()=>{
 const calls=[],root=surface();let attempts=0;
 mountSahmtPerformance(root,{request:async(action,input)=>{calls.push({action,input});if(action==='GET_SAHMT_PERFORMANCE')return {...ready,canManage:true};if(action==='LIST_SAHMT_PEOPLE')return {people:[{uid:'u1',displayName:'Ana'}]};if(++attempts===1)throw Error('NETWORK');return {status:'PENDING'};}});
 await tick();root.click({spManual:''});await tick();const values={uid:'u1',category:'NOTIFICATIONS',kind:'PRAISE',points:'2.5',reason:'Participou da reunião do serviço'};
 root.submit(values);await tick();assert.match(root.innerHTML,/Participou da reunião/);root.submit(values);await tick();
 const saves=calls.filter(c=>c.action==='ADD_SAHMT_MANUAL');assert.equal(saves.length,2);assert.equal(saves[0].input.requestId,saves[1].input.requestId);assert.match(saves[0].input.requestId,/^[\da-f-]{36}$/i);assert.equal(saves[0].input.points,2.5);
 assert.equal(calls.filter(c=>c.action==='GET_SAHMT_PERFORMANCE').length,1);assert.match(root.innerHTML,/próxima apuração/);assert.match(root.innerHTML,/-12,5/);
});
test('manual validation blocks invalid points, short reasons and unauthorized categories before writes',async()=>{
 const writes=[],root=surface();mountSahmtPerformance(root,{request:async(action,input)=>{if(action==='GET_SAHMT_PERFORMANCE')return {...ready,canManage:true};if(action==='LIST_SAHMT_PEOPLE')return {people:[{uid:'u1',displayName:'Ana'}]};writes.push(input);}});await tick();root.click({spManual:''});await tick();
 for(const change of [{points:''},{points:'Infinity'},{points:'1000001'},{points:'1.234'},{reason:'curta'},{category:'OPERATIONS'},{kind:'UNKNOWN'},{uid:'outsider'}]){root.submit({uid:'u1',category:'NOTIFICATIONS',kind:'PRAISE',points:'2',reason:'Justificativa válida',...change});await tick();}
 assert.equal(writes.length,0);
});
test('explicit batch refresh replaces summary and clears history without polling',async()=>{
 let summaries=0;const root=surface();mountSahmtPerformance(root,{request:async(action)=>{
  if(action==='GET_SAHMT_PERFORMANCE'){summaries++;return summaries===1?ready:{...ready,batchId:'next',summary:{...ready.summary,total:15}};}
  return {batchId:ready.batchId,rows:[{id:'x',label:'Lote antigo',points:1}],nextCursor:null};
 }});await tick();root.click({spCategory:'OPERATIONS'});await tick();assert.match(root.innerHTML,/Lote antigo/);root.click({spRefresh:''});await tick();assert.match(root.innerHTML,/data-sp-total>15</);assert.doesNotMatch(root.innerHTML,/Lote antigo/);assert.equal(summaries,2);
});
test('an older summary request cannot overwrite a newer explicitly requested batch',async()=>{
 const root=surface(),releases=[];mountSahmtPerformance(root,{request:()=>new Promise(resolve=>releases.push(resolve))});
 releases[0](ready);await tick();root.click({spRefresh:''});root.click({spRefresh:''});
 releases[2]({...ready,batchId:'newer',summary:{...ready.summary,total:21}});await tick();
 releases[1]({...ready,batchId:'older',summary:{...ready.summary,total:3}});await tick();assert.match(root.innerHTML,/data-sp-total>21</);
});
test('manual success received after session invalidation cannot publish a confirmation',async()=>{
 let current=true,resolveSave;const root=surface();mountSahmtPerformance(root,{isCurrent:()=>current,request:async action=>{
  if(action==='GET_SAHMT_PERFORMANCE')return {...ready,canManage:true};if(action==='LIST_SAHMT_PEOPLE')return {people:[{uid:'u1',displayName:'Ana'}]};return new Promise(resolve=>{resolveSave=resolve;});
 }});await tick();root.click({spManual:''});await tick();root.submit({uid:'u1',category:'CONTINUING_EDUCATION',kind:'IGNORED',points:'3',reason:'Educação continuada confirmada'});current=false;const before=root.innerHTML;resolveSave({status:'PENDING'});await tick();assert.equal(root.innerHTML,before);assert.doesNotMatch(root.innerHTML,/Lançamento registrado/);
});
test('authorized administrators can prepare manual entries before the first complete batch',async()=>{
 const root=surface();mountSahmtPerformance(root,{request:async action=>action==='GET_SAHMT_PERFORMANCE'?{status:'PREPARING',uid:'u1',canManage:true}:{people:[{uid:'u1',displayName:'Ana'}]}});await tick();assert.match(root.innerHTML,/data-sp-manual/);root.click({spManual:''});await tick();assert.match(root.innerHTML,/data-sp-manual-form/);assert.doesNotMatch(root.innerHTML,/data-sp-total/);
});
test('admin corrections use audited current version and preserve original confirmed totals and UUID on retry',async()=>{
 const root=surface(),calls=[];let attempts=0;mountSahmtPerformance(root,{request:async(action,input)=>{
  calls.push({action,input});if(action==='GET_SAHMT_PERFORMANCE')return {...ready,canManage:true};if(action==='LIST_SAHMT_PEOPLE')return {people:[{uid:'u1',displayName:'Ana'}]};if(action==='LIST_SAHMT_MANUAL')return {rows:[{id:'original',uid:'u1',category:'NOTIFICATIONS',kind:'PRAISE',points:2,currentPoints:3,currentVersion:2,version:0,reason:'<b>Justificativa original</b>',createdAt:ready.cutoff,actorUid:'admin',correctsId:null},{id:'correction',uid:'u1',category:'NOTIFICATIONS',kind:'PRAISE',points:1,reason:'Correção anterior',version:1,createdAt:ready.cutoff,actorUid:'admin',correctsId:'original'}]};if(++attempts===1)throw Error('NETWORK');return {status:'PENDING'};
 }});await tick();root.click({spManual:''});await tick();root.input({uid:'u1',category:'NOTIFICATIONS',kind:'PRAISE',points:'',reason:''});root.click({spManualHistory:''});await tick();assert.match(root.innerHTML,/&lt;b&gt;Justificativa original/);assert.equal((root.innerHTML.match(/data-sp-correct=/g)||[]).length,1);
 root.click({spCorrect:'original'});assert.match(root.innerHTML,/value="3"/);root.submit({points:'4.25',reason:'Correção de valor com justificativa'},true);await tick();assert.match(root.innerHTML,/Correção de valor com justificativa/);root.submit({points:'4.25',reason:'Correção de valor com justificativa'},true);await tick();
 const saves=calls.filter(call=>call.action==='CORRECT_SAHMT_MANUAL');assert.equal(saves.length,2);assert.equal(saves[0].input.entryId,'original');assert.equal(saves[0].input.expectedVersion,2);assert.equal(saves[0].input.points,4.25);assert.equal(saves[0].input.requestId,saves[1].input.requestId);assert.match(root.innerHTML,/-12,5/);assert.match(root.innerHTML,/próxima apuração/);assert.equal(calls.filter(call=>call.action==='GET_SAHMT_PERFORMANCE').length,1);assert.equal(calls.filter(call=>call.action==='LIST_SAHMT_MANUAL').length,2);
});
