import test from 'node:test';
import assert from 'node:assert/strict';
import {checklistScoringDayExemption,planChecklistDailyPerformance,planChecklistDailyAbsence} from '../fg-performance/daily-transfer.js';

const signer = {uid:'signer',email:'signer@example.test',active:true,access:true};
const scheduled = {uid:'scheduled',email:'scheduled@example.test',active:true,access:true};
const assignment = {schemaVersion:1,identityStatus:'LINKED',uid:signer.uid,email:signer.email,memberCategories:['EFETIVO']};
const input = () => ({day:'2026-11-06',signatureId:'accepted-signature',signer,scheduled,assignment});
const closing=()=>({day:'2026-11-06',closedThroughDay:'2026-11-06',eligibleFromDay:'2026-11-06',scheduled});

test('weekends and national holidays prohibit both transfers and absence debits with a scheduled person',()=>{
  for(const [day,exemption] of [['2026-11-07','WEEKEND'],['2026-11-08','WEEKEND'],['2026-11-20','NATIONAL_HOLIDAY'],
    ['2026-04-03','NATIONAL_HOLIDAY'],['2027-03-26','NATIONAL_HOLIDAY'],['2026-12-25','NATIONAL_HOLIDAY']]){
    assert.equal(checklistScoringDayExemption(day),exemption);
    const acknowledged=planChecklistDailyPerformance({...input(),day,assignment:null});
    assert.equal(acknowledged.receipt.outcome,'NON_SCORING_DAY');
    assert.deepEqual(acknowledged.entries,[]);
    assert.deepEqual(planChecklistDailyAbsence({...closing(),day,closedThroughDay:day,eligibleFromDay:day}).entries,[]);
  }
});
test('Carnaval and Corpus Christi are optional observances in the federal calendar',()=>{
  for(const day of ['2026-02-17','2026-06-04','2026-11-06']){
    assert.equal(checklistScoringDayExemption(day),null);
    assert.equal(planChecklistDailyPerformance({...input(),day}).entries.length,2);
  }
});

test('no acknowledgement creates only the scheduled users single daily debit',()=>{
  const plan=planChecklistDailyAbsence(closing());
  assert.equal(plan.receipt.outcome,'NO_ACKNOWLEDGEMENT');assert.deepEqual(plan.entries.map(e=>[e.id,e.uid,e.points]),[['2026-11-06_debit','scheduled',-1]]);
  assert.equal(planChecklistDailyAbsence({...closing(),previous:plan.receipt}).changed,false);
});
test('absence cannot penalize an open day, a historical day before FG, or an unresolved scheduled identity',()=>{
  assert.throws(()=>planChecklistDailyAbsence({...closing(),closedThroughDay:'2026-11-05'}),/FG_DAY_NOT_CLOSED/);
  assert.throws(()=>planChecklistDailyAbsence({...closing(),eligibleFromDay:'2026-11-07'}),/FG_DAY_OUTSIDE_RELEASE/);
  assert.throws(()=>planChecklistDailyAbsence({...closing(),scheduled:null}),/FG_SCHEDULED_USER_REQUIRED/);
  assert.equal(planChecklistDailyAbsence({...closing(),acknowledgementPresent:true}).changed,false);
});
test('an acknowledged day, including a zero-point receipt, never receives an absence debit',()=>{
  for(const args of [input(),{...input(),scheduled:signer},{...input(),assignment:{...assignment,memberCategories:['RESIDENTE_1']}}]){
    const acknowledged=planChecklistDailyPerformance(args);
    assert.equal(planChecklistDailyAbsence({...closing(),previous:acknowledged.receipt}).changed,false);
  }
});

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
