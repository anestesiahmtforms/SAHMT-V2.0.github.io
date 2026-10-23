import test from 'node:test';
import assert from 'node:assert/strict';
import {checklistConferenceDisplay,createChecklistConferenceListener} from '../src/checklist-conference-listener.js';
import * as dates from '../src/checklist-date.js';

const day='2026-10-13',uid='synthetic-preceptor';
const request={day,signerUid:uid,signerName:'Preceptor de teste',recordKind:'ACKNOWLEDGEMENT',declaration:true,rotationSigla:'AA',status:'PENDING_VALIDATION'};
const signature={id:'signed',date:day,signerUid:uid,signerName:'Preceptor de teste',responsibleUid:uid,declaration:true,signedAt:new Date('2026-10-13T12:00:00Z')};
test('conference requires a current confirmed check for every active station',()=>{
  assert.equal(typeof dates.checklistConferenceReadiness,'function');
  const stations=[{id:'a',active:true},{id:'b',active:true},{id:'inactive',active:false},{id:'future',active:true,start:'2026-10-15'}];
  const a={stationId:'a',date:day,condition:'SIM'},b={stationId:'b',date:day,condition:'NAO'};
  assert.deepEqual(dates.checklistConferenceReadiness(day,stations,[a]),{ready:false,total:2,missing:1});
  assert.deepEqual(dates.checklistConferenceReadiness(day,stations,[a,b]),{ready:true,total:2,missing:0});
  for(const incomplete of [{...b,date:'2026-10-12'},{...b,inherited:true},{...b,pendingSync:true},
    {...b,hasPendingWrites:true},{...b,syncFailed:true},{...b,condition:''},{...b,active:false}]) {
    assert.equal(dates.checklistConferenceReadiness(day,stations,[a,incomplete]).ready,false);
  }
  assert.equal(dates.checklistConferenceReadiness(day,[{id:'inactive',active:false}],[]).ready,true);
});
test('own acknowledgement immediately shows green for scheduled member and yellow for replacement',()=>{
  assert.deepEqual(checklistConferenceDisplay({day,uid,ownSigla:'AA',request}),{kind:'scheduled',signerName:'Preceptor de teste',validated:false});
  assert.equal(checklistConferenceDisplay({day,uid,ownSigla:'BB',request}).kind,'alternate');
});
test('historical confirmation compares stored UIDs, not names or the current schedule',()=>{
  assert.equal(checklistConferenceDisplay({day,uid:'viewer',ownSigla:'BB',signatures:[signature]}).kind,'scheduled');
  assert.equal(checklistConferenceDisplay({day,uid,signatures:[{...signature,responsibleUid:'another-member'}]}).kind,'alternate');
  assert.equal(checklistConferenceDisplay({day:'2026-10-12',uid,signatures:[signature]}),null);
});
test('first persisted confirmation wins; later requests cannot replace its name or color',()=>{
  const value=checklistConferenceDisplay({day,uid,ownSigla:'BB',request,signatures:[
    {...signature,id:'later',signerName:'Outro membro',signerUid:'other',signedAt:new Date('2026-10-13T13:00:00Z')},signature]});
  assert.deepEqual(value,{kind:'scheduled',signerName:'Preceptor de teste',validated:true});
});
test('unverified rotation is not guessed and another users private request is ignored',()=>{
  assert.equal(checklistConferenceDisplay({day,uid,request}).kind,'recorded');
  assert.equal(checklistConferenceDisplay({day,uid:'other-user',request}),null);
});
function harness() {
  const watched=[],values=[],errors=[],stops=[];
  const sdk={doc:(_db,collection,id)=>({collection,id}),collection:(_db,name)=>({collection:name}),
    where:(...args)=>({where:args}),limit:n=>({limit:n}),query:(...parts)=>({parts}),
    onSnapshot:(reference,_options,next,error)=>{watched.push({reference,next,error});return()=>stops.push(reference);}};
  const stop=createChecklistConferenceListener({uid,day,ownSigla:'AA'},value=>values.push(value),e=>errors.push(e),{sdk,db:{}});
  const meta={fromCache:false,hasPendingWrites:false};
  const own=(data,pending=false)=>watched[0].next({id:day,exists:()=>Boolean(data),data:()=>data,metadata:{...meta,hasPendingWrites:pending}});
  const daily=records=>watched[1].next({docs:records.map(data=>({id:data.id,data:()=>data,metadata:meta})),metadata:meta});
  return {watched,values,errors,stops,stop,own,daily};
}
test('listener waits for server metadata, ignores uncommitted writes and refreshes shared validation',async()=>{
  const h=harness();h.daily([]);h.own(null);assert.equal(h.values.at(-1).ready,true);assert.equal(h.values.at(-1).confirmation,null);
  h.own(request,true);assert.equal(h.values.at(-1).confirmation,null);assert.equal(h.values.at(-1).hasPendingWrites,true);
  h.own(request);assert.equal(h.values.at(-1).confirmation.kind,'scheduled');
  await Promise.resolve();assert.equal(h.stops.length,1);
  h.own({...request,signerSigla:'BB',status:'VALIDATED'});assert.equal(h.values.at(-1).confirmation.kind,'alternate');
  assert.equal(h.values.at(-1).confirmation.validated,true);h.stop();assert.equal(h.stops.length,2);
});
test('queries are limited to one day and one shared document; stale snapshots are discarded',()=>{
  const h=harness();assert.equal(h.watched.length,2);
  assert.deepEqual(h.watched[0].reference,{collection:'checklistSignatureRequests',id:day});
  assert.deepEqual(h.watched[1].reference.parts,[{collection:'checklistSignatures'},{where:['date','==',day]},{limit:101}]);
  h.stop();h.daily([signature]);assert.equal(h.values.length,0);
});

test('all viewers see the same shared signer and color even before scoring validation',()=>{
  const shared={...request,id:day,signerSigla:'BB'};
  for(const viewer of [uid,'another-viewer','read-only-viewer']) {
    assert.deepEqual(checklistConferenceDisplay({day,uid:viewer,ownSigla:'AA',request:shared}),
      {signerName:request.signerName,kind:'alternate',validated:false});
  }
});

test('shared acknowledgement remains authoritative if an old private signature differs',()=>{
  const shared={...request,id:day,signerUid:'new-first',signerName:'First shared signer',signerSigla:'BB'};
  assert.deepEqual(checklistConferenceDisplay({day,uid:'viewer',request:shared,signatures:[signature]}),
    {signerName:'First shared signer',kind:'alternate',validated:false});
});
test('read failure fails closed rather than presenting an empty day as unconfirmed',()=>{
  const h=harness();h.own(null);h.watched[1].error(Error('permission-denied'));
  assert.ok(h.values.at(-1).error);assert.equal(h.values.at(-1).fromCache,true);h.stop();
});
