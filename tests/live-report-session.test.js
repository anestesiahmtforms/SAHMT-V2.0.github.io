import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveReportSession, confirmedLiveReportRecords} from '../src/live-report-session.js';
const scope = (period = '2026-10-01', extra = {}) => ({key: `user:events:${period}:read:200`, uid: 'user', module: 'events', period, permissionKey: 'read', ...extra});
const event = (data, extra = {}) => ({data, fromCache: false, hasPendingWrites: false, complete: true, ...extra});
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject};};
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness(options = {}) {
  const subscriptions=[],unsubscribed=[],data=[],states=[],order=[];
  const session = createLiveReportSession({subscribe:(value,hooks)=>{const id=subscriptions.length;subscriptions.push({scope:value,hooks});order.push(`start:${id}`);return()=>{unsubscribed.push(id);order.push(`stop:${id}`);};},onData:(value,currentScope)=>data.push({value,scope:currentScope}),onState:state=>states.push(state),...options});
  return {session,subscriptions,unsubscribed,data,states,order,next:(value,id=subscriptions.length-1,key='report')=>subscriptions[id].hooks.next(key,value),error:(error,id=subscriptions.length-1)=>subscriptions[id].hooks.error(error)};
}

test('same key deduplicates listeners and hands warm ownership to current open scope', () => {
  const h=harness();h.session.start(scope(undefined,{phase:'warm'}));h.next(event([{id:'a'}]));h.session.start(scope(undefined,{phase:'open'}));
  assert.equal(h.subscriptions.length,1);assert.equal(h.session.activeKey(),scope().key);assert.equal(h.session.snapshot().scope.phase,'open');assert.equal(h.data.at(-1).scope.phase,'open');
  h.next(event([{id:'edited'}]));assert.equal(h.data.at(-1).scope.phase,'open');assert.equal(h.data.at(-1).value[0].id,'edited');
});

test('callbacks guard updated warm scope instead of closed original warm owner', () => {
  let warm=true,opened=false;const h=harness({isCurrent:value=>value.phase==='warm'?warm:opened});
  h.session.start(scope(undefined,{phase:'warm'}));opened=true;h.session.start(scope(undefined,{phase:'open'}));warm=false;
  h.next(event([{id:'a'}]));assert.equal(h.session.snapshot().state,'server');assert.equal(h.data[0].scope.phase,'open');assert.equal(h.unsubscribed.length,0);
});

test('period changes unsubscribe before replacement and discard late next/error', () => {
  const h=harness();h.session.start(scope('A'));h.next(event(['A']));h.session.start(scope('B'));
  assert.deepEqual(h.order,['start:0','stop:0','start:1']);assert.equal(h.session.snapshot().data,null);h.next(event(['late-A']),0);h.error(new Error('old'),0);assert.equal(h.session.snapshot().state,'awaiting');
  h.next(event(['B']),1);assert.deepEqual(h.data.map(x=>x.value),[['A'],['B']]);assert.deepEqual(h.unsubscribed,[0]);
});

for(const [name,extra]of[['uid',{uid:'other'}],['module',{module:'labels'}],['permissions',{permissionKey:'revoked'}]])test(`same accidental key cannot reuse scope after ${name} change`,()=>{
  const h=harness();h.session.start(scope());h.next(event(['private']));h.session.start(scope(undefined,extra));assert.equal(h.subscriptions.length,2);assert.deepEqual(h.unsubscribed,[0]);assert.equal(h.session.snapshot().data,null);h.next(event(['old']),0);assert.equal(h.data.length,1);
});

test('close clears memory, stops exactly once and late callbacks cannot reopen', () => {
  const h=harness();h.session.start(scope());h.next(event(['record']));h.session.close('route');h.session.close('session');h.next(event(['late']));h.error(new Error('late'));assert.deepEqual(h.unsubscribed,[0]);assert.equal(h.session.snapshot().data,null);assert.equal(h.session.snapshot().state,'closed');assert.equal(h.session.activeKey(),null);assert.equal(h.data.length,1);
});

for(const changed of['route','dialog','session','permission'])test(`external ${changed} invalidation disposes listeners and ignores new callbacks`,()=>{
  let current=true;const h=harness({isCurrent:()=>current});h.session.start(scope());current=false;h.next(event(['private']));assert.deepEqual(h.unsubscribed,[0]);assert.equal(h.data.length,0);assert.equal(h.session.activeKey(),null);assert.equal(h.session.snapshot().state,'closed');
});

test('staged multiquery data never confirms or renders a partial scope', () => {
  const h=harness();h.session.start(scope(undefined,{sourceKeys:['day','history']}));h.next(event(['today']),0,'day');assert.equal(h.session.snapshot().ready,false);assert.equal(h.session.snapshot().confirmed,false);assert.equal(h.data.length,0);
  h.next(event(['previous'],{fromCache:true}),0,'history');assert.equal(h.session.snapshot().state,'awaiting');assert.deepEqual(h.data[0].value,{day:['today'],history:['previous']});
  h.next(event(['previous']),0,'history');assert.equal(h.session.snapshot().state,'server');assert.equal(h.session.snapshot().confirmed,true);
});

test('incomplete aggregate and missing metadata cannot show green', () => {
  const h=harness();h.session.start(scope());h.subscriptions[0].hooks.next({data:['draft'],complete:false,fromCache:false,hasPendingWrites:false});assert.equal(h.data.length,0);assert.equal(h.session.snapshot().state,'awaiting');
  h.subscriptions[0].hooks.next({data:[],complete:true});assert.equal(h.session.snapshot().state,'awaiting');assert.equal(h.session.snapshot().confirmed,false);
  h.subscriptions[0].hooks.next(event([]));assert.equal(h.session.snapshot().state,'server');assert.deepEqual(h.data.at(-1).value,[]);
});

test('pending writes, offline and outbox state remain distinct from server acceptance', () => {
  const h=harness();h.session.start(scope());h.next(event(['local'],{hasPendingWrites:true}));assert.equal(h.session.snapshot().state,'pending');assert.equal(h.session.snapshot().confirmed,false);
  h.next(event(['accepted']));assert.equal(h.session.snapshot().state,'server');h.session.setLocalPending(true);assert.equal(h.session.snapshot().state,'pending');h.session.setOnline(false);assert.equal(h.session.snapshot().state,'offline');h.session.setOnline(true);assert.equal(h.session.snapshot().state,'pending');h.session.setLocalPending(false);assert.equal(h.session.snapshot().state,'server');assert.equal(h.subscriptions.length,1);
});

test('refresh on resume, online, manual retry or outbox keeps data stale until new server metadata', () => {
  for(const reason of['resume','online','retry','outbox']) {
    const h=harness();h.session.start(scope());h.next(event(['old']));h.session.setLocalPending(true);h.session.refresh(reason);
    assert.deepEqual(h.order,['start:0','stop:0','start:1']);assert.deepEqual(h.session.snapshot().data,['old']);assert.equal(h.session.snapshot().confirmed,false);assert.equal(h.session.snapshot().ready,false);assert.equal(h.session.snapshot().reason,reason);h.next(event(['late']),0);assert.deepEqual(h.session.snapshot().data,['old']);
    h.session.setLocalPending(false);assert.equal(h.session.snapshot().state,'awaiting');h.next(event(['new']),1);assert.equal(h.session.snapshot().state,'server');assert.deepEqual(h.session.snapshot().data,['new']);
  }
});

test('insertions, edits and deletions replace the authorized query result instead of merging duplicates', () => {
  const h=harness();h.session.start(scope());h.next(event([{id:'a',value:1}]));h.next(event([{id:'a',value:2},{id:'b',value:3}]));h.next(event([{id:'b',value:3}]));assert.deepEqual(h.session.snapshot().data,[{id:'b',value:3}]);assert.equal(h.data.length,3);assert.equal(h.subscriptions.length,1);
});

test('terminal error retains stale data, stops listeners and manual retry recovers', () => {
  const h=harness();h.session.start(scope());h.next(event(['old']));const failure=new Error('network');h.error(failure);assert.equal(h.session.snapshot().state,'error');assert.equal(h.session.snapshot().error,failure);assert.deepEqual(h.unsubscribed,[0]);h.next(event(['late']));assert.deepEqual(h.session.snapshot().data,['old']);h.session.refresh('retry');h.next(event(['new']),1);assert.equal(h.session.snapshot().state,'server');assert.deepEqual(h.unsubscribed,[0]);
});

test('late asynchronous subscription setup is immediately disposed after scope changes', async () => {
  const old=deferred(),stopped=[];let count=0;const h=harness({subscribe:()=>count++===0?old.promise:()=>stopped.push('current')});h.session.start(scope('A'));h.session.start(scope('B'));old.resolve(()=>stopped.push('old'));await settle();assert.deepEqual(stopped,['old']);h.session.close();assert.deepEqual(stopped,['old','current']);
});

test('asynchronous setup rejection from old generation cannot fail the current report', async () => {
  const old=deferred();let count=0;const h=harness({subscribe:()=>count++===0?old.promise:()=>{}});h.session.start(scope('A'));h.session.start(scope('B'));old.reject(new Error('late'));await settle();assert.equal(h.session.snapshot().state,'awaiting');assert.equal(h.session.snapshot().error,null);
});

test('synchronous snapshots and errors during subscription setup retain correct disposal', () => {
  let stops=0;const h=harness({subscribe:(_scope,hooks)=>{hooks.next(event(['data']));hooks.error(new Error('failed'));return()=>stops++;}});h.session.start(scope());assert.equal(h.session.snapshot().state,'error');assert.equal(stops,1);h.session.close();assert.equal(stops,1);
});

test('subscription throw is surfaced as retryable state without unhandled rejection', () => {
  const h=harness({subscribe:()=>{throw new Error('setup');}});assert.doesNotThrow(()=>h.session.start(scope()));assert.equal(h.session.snapshot().state,'error');assert.equal(h.session.snapshot().confirmed,false);
});

test('unauthorized or missing uid/key closes existing memory and avoids new subscription', () => {
  for(const invalid of[null,{},scope(undefined,{uid:''}),scope(undefined,{key:''}),scope(undefined,{authorized:false})]){const h=harness();h.session.start(scope());h.next(event(['private']));assert.equal(h.session.start(invalid),false);assert.equal(h.subscriptions.length,1);assert.deepEqual(h.unsubscribed,[0]);assert.equal(h.session.snapshot().data,null);}
});

test('confirmed records exclude pending SDK writes, outbox drafts, failures and conflicts', () => {
  const accepted={id:'accepted'};assert.deepEqual(confirmedLiveReportRecords([accepted,{id:'a',pendingSync:true},{id:'b',pendingFirestore:true},{id:'c',syncFailed:true},{id:'d',syncConflict:true},{id:'e',hasPendingWrites:true},{id:'f',metadata:{hasPendingWrites:true}}]),[accepted]);
});

test('snapshot access clears private memory immediately after scope revocation without a new event', () => {
  let current=true;const h=harness({isCurrent:()=>current});h.session.start(scope());h.next(event(['private']));current=false;assert.equal(h.session.snapshot().data,null);assert.equal(h.session.snapshot().state,'closed');assert.deepEqual(h.unsubscribed,[0]);
});

test('cleanup exception cannot prevent closing ownership before a new period', () => {
  const starts=[];const h=harness({subscribe:value=>{starts.push(value.period);return()=>{throw new Error('adapter cleanup');};}});h.session.start(scope('A'));assert.doesNotThrow(()=>h.session.start(scope('B')));assert.deepEqual(starts,['A','B']);assert.equal(h.session.snapshot().scope.period,'B');assert.doesNotThrow(()=>h.session.close());assert.equal(h.session.snapshot().data,null);
});

test('late outbox count for old scope cannot mark the new period pending', () => {
  const h=harness();h.session.start(scope('A'));const oldKey=h.session.activeKey();h.session.start(scope('B'));h.next(event(['B']));h.session.setLocalPending(true,oldKey);assert.equal(h.session.snapshot().state,'server');h.session.setLocalPending(true,h.session.activeKey());assert.equal(h.session.snapshot().state,'pending');
});
