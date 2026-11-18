import test from 'node:test';import assert from 'node:assert/strict';
import {communicationMemory} from './helpers/communication-history-memory.js';
import {createCommunicationService} from '../worker-communication/service.js';
import {createCommunicationHistory} from '../worker-communication/history-service.js';
import {isCurrentMessage} from '../communication/domain.js';
const time=1794740400000,admin={uid:'ff-admin',sourceUid:'admin',email:'wx2064@gmail.com',emailVerified:true},person={uid:'ff-one',sourceUid:'one',email:'one@example.test',emailVerified:true};
function fixture(){
 const store=communicationMemory(),queue=[];let n=0;
 store.data.set('users/admin',{uid:'admin',email:admin.email,active:true,access:true});
 store.data.set('users/one',{uid:'one',email:person.email,displayName:'Pessoa Um',institutionalGroup:'team',active:true,access:true});
 store.data.set('users/two',{uid:'two',email:'two@example.test',displayName:'Pessoa Dois',institutionalGroup:'resident',active:true,access:true});
 const history=createCommunicationHistory({store,drive:{write:async()=>({saved:true})},pushQueue:{send:async v=>queue.push(v)},now:()=>time});
 const source={catalog:async()=>({items:[{kind:'SURVEY',id:'climate',cycle:'2026',title:'Clima'}]}),eligibility:async({recipients})=>({eligibleUids:recipients.filter(r=>r.institutionalGroup==='team').map(r=>r.uid),excluded:recipients.filter(r=>r.institutionalGroup!=='team').map(r=>({uid:r.uid,reason:'SURVEY_FORBIDDEN'}))}),completion:async()=>({completed:true})};
 const service=createCommunicationService({store,history,activitySource:source,now:()=>time,uuid:()=>`preview-${++n}`,pushQueue:{send:async v=>queue.push(v)}});
 const call=(action,input={},a=admin)=>service.execute(action,input,a);
 return {store,call,queue};
}
test('new message history fixes original audience and records read only after authenticated explicit open',async()=>{
 const f=fixture();const {message}=await f.call('CREATE_EVENT',{id:'event-one',title:'Completa',description:'Mensagem integral',audience:'institutional-team'});
 assert.equal((await f.call('SENT_DETAIL',{id:message.id})).recipients[0].displayName,'Pessoa Um');
 assert.equal((await f.call('INBOX',{},person)).items.length,1);assert.equal((await f.store.get('communicationMessageRecipients',message.id)).items[0].readAt,null);
 f.store.data.get('users/one').institutionalGroup='resident';assert.equal((await f.call('INBOX',{},person)).items.length,1);
 const receipt=await f.call('MESSAGE_READ',{id:message.id},person);assert.equal(receipt.readAt,time);
 await assert.rejects(f.call('SENT_DETAIL',{id:message.id},person),{code:'COMM_FORBIDDEN'});
});
test('activity preview, publication, own pending and confirmed completion use real FF history/index integration',async()=>{
 const f=fixture(),activity={kind:'SURVEY',id:'climate',title:'Clima',cycle:'2026'};
 const preview=await f.call('PREVIEW_ACTIVITY',{activity,audience:'ALL'});assert.equal(preview.recipients.length,1);assert.equal(preview.excluded.length,2);
 const input={id:'activity-one',previewId:preview.previewId,title:'Pesquisa obrigatória',description:'Responda ao ciclo',confirmed:true};
 const published=await f.call('CREATE_ACTIVITY',input);assert.equal(published.message.hasActivity,true);
 assert.equal((await f.call('CREATE_ACTIVITY',input)).alreadySent,true);
 const [pending]=(await f.call('PENDING_ACTIVITIES',{},person)).items;
 const updated={id:pending.id,expectedDueAt:pending.dueAt,deadlineHours:6};
 await assert.rejects(f.call('UPDATE_ACTIVITY_DEADLINE',updated,person),{code:'COMM_FORBIDDEN'});
 const next=await f.call('UPDATE_ACTIVITY_DEADLINE',updated);
 assert.equal(next.dueAt,time+6*3600000);
 assert.equal((await f.call('PENDING_ACTIVITIES',{},person)).items[0].dueAt,next.dueAt);
 assert.equal((await f.call('VERIFY_ACTIVITY',{id:'activity-one'},person)).completed,true);
 assert.equal((await f.call('PENDING_ACTIVITIES',{},person)).items.length,0);
 const detail=await f.call('SENT_DETAIL',{id:'activity-one'});assert.equal(detail.recipients[0].sourceCompletedAt,null);assert.equal(detail.recipients[0].completedAt,time);
});
test('mandatory activity remains active until completion/cancellation rather than ordinary notice expiry',()=>{
 assert.equal(isCurrentMessage({status:'published',publishAt:time,expiresAt:time+100,hasActivity:true,activity:{kind:'SURVEY'}},time+366*86400000),true);
 assert.equal(isCurrentMessage({status:'cancelled',publishAt:time,hasActivity:true,activity:{kind:'SURVEY'}},time+200),false);
});
