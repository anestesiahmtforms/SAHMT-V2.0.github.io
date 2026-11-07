import test from 'node:test';
import assert from 'node:assert/strict';
import {planChecklistDailyPerformance} from '../fg-performance/daily-transfer.js';

const signer = {uid:'signer',email:'signer@example.test',active:true,access:true};
const scheduled = {uid:'scheduled',email:'scheduled@example.test',active:true,access:true};
const assignment = {schemaVersion:1,identityStatus:'LINKED',uid:signer.uid,email:signer.email,memberCategories:['EFETIVO']};
const input = () => ({day:'2026-11-07',signatureId:'accepted-signature',signer,scheduled,assignment});

test('a team member acknowledging another scheduled user receives +1 and transfers -1 atomically',()=>{
  const plan = planChecklistDailyPerformance(input());
  assert.deepEqual(plan.entries.map(entry=>[entry.uid,entry.points]),[['signer',1],['scheduled',-1]]);
  assert.equal(plan.receipt.outcome,'TRANSFER');
  assert.equal(plan.entries.reduce((sum,entry)=>sum+entry.points,0),0);
});

test('the scheduled user acknowledgement closes the day without awarding anyone points',()=>{
  const plan = planChecklistDailyPerformance({...input(),scheduled:signer});
  assert.equal(plan.receipt.outcome,'SCHEDULED_USER_ACKNOWLEDGEMENT');
  assert.deepEqual(plan.entries,[]);
  const replay = planChecklistDailyPerformance({...input(),scheduled:signer,previous:plan.receipt});
  assert.equal(replay.changed,false);
  assert.deepEqual(replay.entries,[]);
});

test('retries do not award twice and another acknowledgement cannot replace the accepted daily receipt',()=>{
  const first = planChecklistDailyPerformance(input());
  assert.equal(planChecklistDailyPerformance({...input(),previous:first.receipt}).changed,false);
  assert.throws(()=>planChecklistDailyPerformance({...input(),signatureId:'different-signature',previous:first.receipt}),/FG_DAILY_PERFORMANCE_ALREADY_SETTLED/);
});

test('administrator role and team presentation do not replace institutional membership',()=>{
  for(const categories of [[],['ADMINISTRADOR'],['SUBSTITUTO'],['RESIDENTE_1']]){
    const plan = planChecklistDailyPerformance({...input(),signer:{...signer,role:'administrador_app',accountMode:'team'},assignment:{...assignment,memberCategories:categories}});
    assert.equal(plan.receipt.outcome,'AUTHOR_OUTSIDE_TEAM');
    assert.deepEqual(plan.entries,[]);
  }
});

test('identity mismatches, inactive profiles and an unresolved scheduled user cannot create points',()=>{
  assert.throws(()=>planChecklistDailyPerformance({...input(),scheduled:null}),/FG_SCHEDULED_USER_REQUIRED/);
  assert.throws(()=>planChecklistDailyPerformance({...input(),signer:{...signer,active:false}}),/FG_SIGNER_INVALID/);
  assert.throws(()=>planChecklistDailyPerformance({...input(),assignment:{...assignment,uid:'other'}}),/FG_TEAM_IDENTITY_UNVERIFIED/);
  assert.throws(()=>planChecklistDailyPerformance({...input(),day:'2026-02-30'}),/FG_PERFORMANCE_DAY_INVALID/);
});
