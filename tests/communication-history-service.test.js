import test from 'node:test';import assert from 'node:assert/strict';
let api={};try{api=await import('../worker-communication/history-service.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const now=1794740400000;
function fixture(){
 const data=new Map(),queue=[],writes=[];let clock=now,lock=Promise.resolve(),fail=false;
 const get=async(c,k)=>structuredClone(data.get(c+'/'+k)||null);
 const store={get,transaction(work){const run=lock.then(async()=>{const changes=new Map();const result=await work({get,set:(c,k,v)=>changes.set(c+'/'+k,structuredClone(v)),create:(c,k,v)=>{assert.equal(data.has(c+'/'+k),false);changes.set(c+'/'+k,structuredClone(v));},delete:(c,k)=>changes.set(c+'/'+k,null)});for(const [k,v]of changes)v===null?data.delete(k):data.set(k,v);return result;});lock=run.catch(()=>{});return run;}};
 const drive={async write(rows){writes.push(rows);if(fail){fail=false;throw Error('Drive unavailable');}return {saved:true};}};
 const message={id:'event-1',title:'Teste',message:'Completa',createdBy:{email:'admin@example.test'},publishAt:now,expiresAt:now+86400000,status:'published',audienceType:'GROUP',audienceValue:'institutional-team'};
 const recipients=[{uid:'one',email:'one@example.test',displayName:'Um',institutionalGroup:'team'},{uid:'two',email:'two@example.test',displayName:'Dois',institutionalGroup:'team'}];
 return {data,store,queue,writes,message,recipients,setClock:v=>clock=v,fail:()=>{fail=true;},create:()=>api.createCommunicationHistory({store,drive,pushQueue:{send:async item=>queue.push(item)},now:()=>clock,year:2026,uuid:()=>crypto.randomUUID()})};
}
async function seed(f,h){await f.store.transaction(async tx=>{const binding=await h.reserve(tx,f.message,f.recipients);tx.set('communicationMessages',f.message.id,{...f.message,history:binding});});}
test('history reserves stable recipient snapshot and first-read receipt cannot be forged or moved',async()=>{
 assert.equal(typeof api.createCommunicationHistory,'function');const f=fixture(),h=f.create();await seed(f,h);
 await assert.rejects(h.markRead({id:'event-1'},'outsider'),{code:'COMM_FORBIDDEN'});
 const first=await h.markRead({id:'event-1'},'one');f.setClock(now+500);const again=await h.markRead({id:'event-1'},'one');assert.equal(first.readAt,now);assert.equal(again.readAt,now);
 const recipients=await f.store.get('communicationMessageRecipients','event-1');assert.equal(recipients.items[0].institutionalGroup,'team');assert.equal(recipients.items[1].readAt,null);
});
test('failed archive sync retries identical rows without duplicating published/read events',async()=>{
 assert.equal(typeof api.createCommunicationHistory,'function');const f=fixture(),h=f.create();await seed(f,h);await h.markRead({id:'event-1'},'one');f.fail();
 await assert.rejects(h.consume({messageId:'event-1'}));await h.consume({messageId:'event-1'});await h.consume({messageId:'event-1'});
 assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.deepEqual(await f.store.get('communicationHistoryPending','event-1'),{messageId:'event-1',events:[],lease:null,done:true});
 const details=await h.detail({id:'event-1'});assert.equal(details.recipients.length,2);assert.equal(details.recipients[0].readAt,now);assert.equal(details.syncPending,false);
});
test('history completion updates only own selected recipient and records authoritative evidence once',async()=>{
 assert.equal(typeof api.createCommunicationHistory,'function');const f=fixture(),h=f.create();await seed(f,h);
 await h.markCompletion({id:'event-1'},'one',{completedAt:now-100,score:8});await h.markCompletion({id:'event-1'},'one',{completedAt:now-100,score:8});
 const detail=await h.detail({id:'event-1'});assert.equal(detail.recipients[0].completedAt,now-100);assert.equal(detail.recipients[1].completedAt,null);assert.equal(detail.recipients[1].score,null);
 assert.equal((await f.store.get('communicationHistoryPending','event-1')).events.filter(e=>e.type==='COMPLETED').length,1);
});
test('an administrator can shorten and extend an active deadline and Drive records both changes',async()=>{
 const f=fixture(),h=f.create(),hour=3600000,actor={uid:'ff-admin',sourceUid:'admin',email:'admin@example.test'};
 const original=now+120*hour,shortened=now+12*hour,extended=now+160*hour;
 Object.assign(f.message,{hasActivity:true,dueAt:original});
 await seed(f,h);
 assert.equal((await h.updateDeadline('event-1',actor,original,shortened)).dueAt,shortened);
 await assert.rejects(h.updateDeadline('event-1',actor,original,extended),{code:'COMM_ACTIVITY_DEADLINE_CHANGED'});
 assert.equal((await h.updateDeadline('event-1',actor,shortened,extended)).dueAt,extended);
 assert.equal((await h.detail({id:'event-1'})).recipients[0].status,'PENDING');
 await h.consume({messageId:'event-1'});
 const events=f.writes[0].filter(row=>row.values[0][3]==='DEADLINE_CHANGED').map(row=>JSON.parse(row.values[0][5]));
 assert.deepEqual(events,[
  {previousDueAt:original,dueAt:shortened,actorEmail:actor.email},
  {previousDueAt:shortened,dueAt:extended,actorEmail:actor.email}
 ]);
});
