import test from 'node:test';
import assert from 'node:assert/strict';
import {createObligationService} from '../worker-communication/obligation-service.js';

const NOW=Date.parse('2026-11-15T12:00:00Z');
const actor={uid:'ff-admin',sourceUid:'admin',email:'admin@example.invalid'};
const person={uid:'ff-person',sourceUid:'person',email:'person@example.invalid'};
const activity={kind:'TRAINING',id:'training',title:'Training',version:1,maxScore:5,minimumScore:4};
function memory(){
 const data=new Map();let lock=Promise.resolve();
 const get=async(c,k)=>structuredClone(data.get(c+'/'+k)||null);
 return {data,get,getMany:(c,ids)=>Promise.all(ids.map(k=>get(c,k))),transaction(fn){const job=lock.then(async()=>{const writes=[];const result=await fn({get,set:(c,k,v)=>writes.push([c+'/'+k,structuredClone(v)]),create:(c,k,v)=>{if(data.has(c+'/'+k))throw Error('EXISTS');writes.push([c+'/'+k,structuredClone(v)]);}});for(const [k,v]of writes)data.set(k,v);return result;});lock=job.catch(()=>{});return job;}};
}
function fixture(){
 const store=memory();let clock=NOW,n=0,directory=[{uid:'person',email:person.email,displayName:'Person',institutionalGroup:'team'}],excluded=[],completion={completed:false},lost=false;
 const calls={catalog:0,eligibility:0,completion:0,published:0,history:0,cancel:0};
 let cards=[{kind:'TRAINING',id:'training',title:'Training',version:1,maxScore:5},{kind:'SURVEY',id:'climate',title:'Climate',cycle:'2026'}];
 const source={async catalog({kind}){calls.catalog++;return {items:cards.filter(c=>c.kind===kind)};},async eligibility({recipients}){calls.eligibility++;return {eligibleUids:recipients.filter(r=>!excluded.includes(r.uid)).map(r=>r.uid),excluded:recipients.filter(r=>excluded.includes(r.uid)).map(r=>({uid:r.uid,reason:'FORBIDDEN'}))};},async completion(){calls.completion++;if(completion instanceof Error)throw completion;return completion;}};
 const history={async markCompletion({id},uid,evidence){calls.history++;return store.transaction(async tx=>{const snapshot=await tx.get('communicationMessageRecipients',id),item=snapshot.items.find(r=>r.uid===uid);if(item.status==='PENDING'){Object.assign(item,evidence,{status:'COMPLETED'});tx.set('communicationMessageRecipients',id,snapshot);}return {recipient:item};});},async cancel({id},by,reason){calls.cancel++;return store.transaction(async tx=>{const message=await tx.get('communicationMessages',id),snapshot=await tx.get('communicationMessageRecipients',id);message.status='cancelled';message.cancelReason=reason;for(const item of snapshot.items)if(item.status==='PENDING')item.status='CANCELLED';tx.set('communicationMessages',id,message);tx.set('communicationMessageRecipients',id,snapshot);return {message};});}};
 const saveActivity=async(input,by)=>{
  const result=await store.transaction(async tx=>{const old=await tx.get('communicationMessages',input.id);if(old)return {message:old,alreadySent:true};
   const message={...input,message:input.description,publishAt:clock,status:'published',hasActivity:true,createdBy:{sourceUid:by.sourceUid}};delete message.recipients;
   await service.reserveIndex(tx,message,input.recipients);
   tx.create('communicationMessages',message.id,message);tx.create('communicationMessageRecipients',message.id,{messageId:message.id,items:input.recipients.map(r=>({...r,status:'PENDING',readAt:null,completedAt:null,score:null})),version:1});calls.published++;return {message};
  });if(lost){lost=false;throw Error('RESPONSE_LOST');}return result;
 };
 const service=createObligationService({store,source,history,saveActivity,resolveRecipients:async()=>structuredClone(directory),now:()=>clock,uuid:()=>`preview-${++n}`});
 const execute=(action,input={},by=actor)=>service.execute(action,input,by);
 const preview=(value=activity)=>execute('PREVIEW_ACTIVITY',{activity:value,audience:'ALL'});
 const create=async()=>{const p=await preview();return execute('CREATE_ACTIVITY',{id:'activity-one',previewId:p.previewId,title:'Read training',description:'Please complete',confirmed:true});};
 return {store,source,history,calls,execute,preview,create,setTime:v=>clock=v,setDirectory:v=>directory=v,setExcluded:v=>excluded=v,setCompletion:v=>completion=v,setCards:v=>cards=v,loseResponse:()=>lost=true};
}
test('preview fixes authoritative metadata and audience; rejects client recipients and invalid minimum',async()=>{
 const h=fixture();const p=await h.preview({...activity,title:'Forged',maxScore:999});
 assert.deepEqual(p.activity,activity);assert.deepEqual(p.recipients.map(r=>r.uid),['person']);
 assert.equal((await h.store.get('communicationActivityPreviews',p.previewId)).sourceUid,actor.sourceUid);
 await assert.rejects(h.execute('PREVIEW_ACTIVITY',{activity,audience:'ALL',recipients:[{uid:'foreign'}]}),{code:'COMM_INVALID_INPUT'});
 await assert.rejects(h.preview({...activity,minimumScore:6,maxScore:999}),{code:'COMM_INVALID_ACTIVITY'});
});
test('preview ownership, expiry, version changes and changed audience fail before publication',async()=>{
 for(const mutation of ['owner','expiry','audience','version','eligibility']){
  const h=fixture(),p=await h.preview();
  if(mutation==='expiry')h.setTime(NOW+600000);
  if(mutation==='audience')h.setDirectory([{uid:'new-person',email:'new@example.invalid'}]);
  if(mutation==='version')h.setCards([{...activity,version:2}]);
  if(mutation==='eligibility')h.setExcluded(['person']);
  await assert.rejects(h.execute('CREATE_ACTIVITY',{id:'activity-one',previewId:p.previewId,title:'Title',description:'Description',confirmed:true},mutation==='owner'?person:actor));assert.equal(h.calls.published,0);
 }
});
test('lost publication response retries exactly once and cannot reuse preview with changed content',async()=>{
 const h=fixture(),p=await h.preview(),input={id:'activity-one',previewId:p.previewId,title:'Title',description:'Description',confirmed:true};
 h.loseResponse();await assert.rejects(h.execute('CREATE_ACTIVITY',input),/RESPONSE_LOST/);
 h.setTime(NOW+600001);assert.equal((await h.execute('CREATE_ACTIVITY',input)).alreadySent,true);assert.equal(h.calls.published,1);
 await assert.rejects(h.execute('CREATE_ACTIVITY',{...input,id:'activity-two'}),{code:'COMM_IDEMPOTENCY_CONFLICT'});
 await assert.rejects(h.execute('CREATE_ACTIVITY',{...input,description:'Changed'}),{code:'COMM_IDEMPOTENCY_CONFLICT'});
});
test('concurrent identical creation is idempotent; index uses one document and ignores repeat reservation',async()=>{
 const h=fixture(),p=await h.preview(),input={id:'activity-one',previewId:p.previewId,title:'Title',description:'Description',confirmed:true};
 await Promise.all([h.execute('CREATE_ACTIVITY',input),h.execute('CREATE_ACTIVITY',input)]);assert.equal(h.calls.published,1);
 assert.deepEqual((await h.store.get('communicationObligationIndex','current')).entries,[{uid:'person',ids:['activity-one']}]);
 assert.equal([...h.store.data.keys()].filter(k=>k.startsWith('communicationObligationIndex/')).length,1);
});
test('pending lists only fixed own pending snapshots and never asks source or marks reads',async()=>{
 const h=fixture();await h.create();const calls={...h.calls};
 const pending=await h.execute('PENDING_ACTIVITIES',{},person);assert.equal(pending.serverNow,NOW);assert.equal(pending.items[0].message,'Please complete');assert.equal(pending.items[0].status,'PENDING');assert.equal(JSON.stringify(pending).includes(actor.email),false);
 assert.deepEqual(h.calls,calls);assert.equal((await h.execute('PENDING_ACTIVITIES',{},actor)).items.length,0);
 assert.equal((await h.store.get('communicationMessageRecipients','activity-one')).items[0].readAt,null);
});
test('verification ignores supplied scores, rejects foreign recipient and persists source evidence idempotently',async()=>{
 const h=fixture();await h.create();h.setCompletion({completed:true,completedAt:NOW-100000,score:4});
 await assert.rejects(h.execute('VERIFY_ACTIVITY',{id:'activity-one',score:5},person),{code:'COMM_INVALID_INPUT'});
 await assert.rejects(h.execute('VERIFY_ACTIVITY',{id:'activity-one'},actor),{code:'COMM_FORBIDDEN'});
 const result=await h.execute('VERIFY_ACTIVITY',{id:'activity-one'},person);assert.equal(result.completed,true);
 const row=(await h.store.get('communicationMessageRecipients','activity-one')).items[0];assert.equal(row.completedAt,NOW-100000);assert.equal(row.sourceCompletedAt,NOW-100000);assert.equal(row.score,4);assert.equal(row.readAt,null);
 await h.execute('VERIFY_ACTIVITY',{id:'activity-one'},person);assert.equal(h.calls.completion,1);
 assert.deepEqual((await h.execute('PENDING_ACTIVITIES',{},person)).items,[]);
});
test('survey completion uses verification time without inventing original submission timestamp',async()=>{
 const h=fixture(),p=await h.preview({kind:'SURVEY',id:'climate',title:'Climate',cycle:'2026'});
 await h.execute('CREATE_ACTIVITY',{id:'activity-survey',previewId:p.previewId,title:'Survey',description:'Answer',confirmed:true});h.setCompletion({completed:true});
 await h.execute('VERIFY_ACTIVITY',{id:'activity-survey'},person);
 const row=(await h.store.get('communicationMessageRecipients','activity-survey')).items[0];assert.equal(row.completedAt,NOW);assert.equal(row.sourceCompletedAt,null);assert.equal(row.score,null);
});
test('source outage or unavailable attempt preserves obligation and cancellation removes it with reason',async()=>{
 const h=fixture();await h.create();h.setCompletion({completed:false,unavailable:true,reason:'ATTEMPT_LIMIT'});
 assert.deepEqual(await h.execute('VERIFY_ACTIVITY',{id:'activity-one'},person),{id:'activity-one',completed:false,unavailable:true,reason:'ATTEMPT_LIMIT',serverNow:NOW});assert.equal(h.calls.history,0);
 h.setCompletion(Error('SOURCE_DOWN'));await assert.rejects(h.execute('VERIFY_ACTIVITY',{id:'activity-one'},person),/SOURCE_DOWN/);assert.equal((await h.execute('PENDING_ACTIVITIES',{},person)).items.length,1);
 await h.execute('CANCEL_ACTIVITY',{id:'activity-one',reason:'Activity unavailable'});assert.equal((await h.store.get('communicationMessageRecipients','activity-one')).items[0].status,'CANCELLED');assert.deepEqual((await h.execute('PENDING_ACTIVITIES',{},person)).items,[]);
});
test('per-person twenty-obligation cap is enforced atomically without publication',async()=>{
 const h=fixture();h.store.data.set('communicationObligationIndex/current',{entries:[{uid:'person',ids:Array.from({length:20},(_,i)=>`existing-${i}`)}]});
 await assert.rejects(h.create(),{code:'COMM_OBLIGATION_LIMIT'});assert.equal(h.calls.published,0);assert.equal(await h.store.get('communicationMessages','activity-one'),null);
});
test('index byte cap rejects atomic reservation and existing entries remain unchanged',async()=>{
 const h=fixture(),entries=[];
 // Stay just below the storage cap, then add a full new audience.
 for(let n=0;n<78;n++)entries.push({uid:`member-${n}`,ids:Array.from({length:20},(_,i)=>`old-${n}-${i}-`+'x'.repeat(110))});
 const original={entries};assert.ok(Buffer.byteLength(JSON.stringify(original))<200*1024);
 h.store.data.set('communicationObligationIndex/current',structuredClone(original));
 h.setDirectory(Array.from({length:200},(_,i)=>({uid:`new-member-${i}-`+'y'.repeat(90),email:`new${i}@example.invalid`})));
 await assert.rejects(h.create(),{code:'COMM_OBLIGATION_INDEX_LIMIT'});
 assert.deepEqual(await h.store.get('communicationObligationIndex','current'),original);assert.equal(await h.store.get('communicationMessages','activity-one'),null);
});
test('completion persisted before index failure is recovered without another source lookup',async()=>{
 const h=fixture();await h.create();h.setCompletion({completed:true,completedAt:NOW-1,score:5});
 const transaction=h.store.transaction.bind(h.store);let interrupted=true;
 h.store.transaction=fn=>transaction(tx=>fn({...tx,set(c,k,v){if(c==='communicationObligationIndex'&&interrupted){interrupted=false;throw Error('INDEX_RESPONSE_LOST');}tx.set(c,k,v);}}));
 await assert.rejects(h.execute('VERIFY_ACTIVITY',{id:'activity-one'},person),/INDEX_RESPONSE_LOST/);
 assert.equal((await h.store.get('communicationMessageRecipients','activity-one')).items[0].status,'COMPLETED');
 assert.equal((await h.execute('VERIFY_ACTIVITY',{id:'activity-one'},person)).completed,true);assert.equal(h.calls.completion,1);
 assert.deepEqual((await h.execute('PENDING_ACTIVITIES',{},person)).items,[]);
});
test('cancellation racing source confirmation cannot be reported as completion',async()=>{
 const h=fixture();await h.create();
 h.source.completion=async()=>{await h.execute('CANCEL_ACTIVITY',{id:'activity-one',reason:'Unavailable'});return {completed:true,completedAt:NOW-1,score:5};};
 const result=await h.execute('VERIFY_ACTIVITY',{id:'activity-one'},person);assert.equal(result.completed,false);assert.equal(result.reason,'ACTIVITY_CANCELLED');
 assert.equal((await h.store.get('communicationMessageRecipients','activity-one')).items[0].status,'CANCELLED');
});
test('exclusions are displayed, only eligible members are fixed, and zero-eligible preview cannot publish',async()=>{
 const h=fixture();h.setDirectory([{uid:'person',email:person.email},{uid:'other',email:'other@example.invalid'}]);h.setExcluded(['other']);
 const p=await h.preview();assert.deepEqual(p.excluded,[{uid:'other',reason:'FORBIDDEN'}]);assert.deepEqual(p.recipients.map(r=>r.uid),['person']);
 await h.execute('CREATE_ACTIVITY',{id:'activity-one',previewId:p.previewId,title:'Title',description:'Description',confirmed:true});
 assert.deepEqual((await h.store.get('communicationMessageRecipients','activity-one')).items.map(r=>r.uid),['person']);
 const empty=fixture();empty.setExcluded(['person']);const denied=await empty.preview();
 await assert.rejects(empty.execute('CREATE_ACTIVITY',{id:'activity-none',previewId:denied.previewId,title:'Title',description:'Description',confirmed:true}),{code:'COMM_NO_ELIGIBLE_RECIPIENTS'});
});
