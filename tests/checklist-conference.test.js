import test from 'node:test';
import assert from 'node:assert/strict';
import {checklistConferenceDisplay,createChecklistConferenceListener} from '../src/checklist-conference-listener.js';

const day='2026-10-13',uid='synthetic-preceptor';
const request={day,signerUid:uid,signerName:'Preceptor de teste',recordKind:'ACKNOWLEDGEMENT',declaration:true,rotationSigla:'AA',status:'PENDING_VALIDATION'};
const signature={id:'signed',date:day,signerUid:uid,signerName:'Preceptor de teste',responsibleUid:uid,declaration:true,signedAt:new Date('2026-10-13T12:00:00Z')};
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
  const own=(data,pending=false)=>watched[0].next({id:`${day}_${uid}`,exists:()=>Boolean(data),data:()=>data,metadata:{...meta,hasPendingWrites:pending}});
  const daily=records=>watched[1].next({docs:records.map(data=>({id:data.id,data:()=>data,metadata:meta})),metadata:meta});
  return {watched,values,errors,stops,stop,own,daily};
}
test('listener waits for server metadata, ignores uncommitted writes and refreshes validated history',()=>{
  const h=harness();h.daily([]);h.own(null);assert.equal(h.values.at(-1).ready,true);assert.equal(h.values.at(-1).confirmation,null);
  h.own(request,true);assert.equal(h.values.at(-1).confirmation,null);assert.equal(h.values.at(-1).hasPendingWrites,true);
  h.own(request);assert.equal(h.values.at(-1).confirmation.kind,'scheduled');
  h.daily([{...signature,responsibleUid:'other'}]);assert.equal(h.values.at(-1).confirmation.kind,'alternate');
  assert.equal(h.values.at(-1).confirmation.validated,true);h.stop();assert.equal(h.stops.length,2);
});
test('queries are limited to one day and one private owner document; stale snapshots are discarded',()=>{
  const h=harness();assert.equal(h.watched.length,2);
  assert.deepEqual(h.watched[0].reference,{collection:'checklistSignatureRequests',id:`${day}_${uid}`});
  assert.deepEqual(h.watched[1].reference.parts,[{collection:'checklistSignatures'},{where:['date','==',day]},{limit:101}]);
  h.stop();h.daily([signature]);assert.equal(h.values.length,0);
});
test('read failure fails closed rather than presenting an empty day as unconfirmed',()=>{
  const h=harness();h.own(null);h.watched[1].error(Error('permission-denied'));
  assert.ok(h.values.at(-1).error);assert.equal(h.values.at(-1).fromCache,true);h.stop();
});
