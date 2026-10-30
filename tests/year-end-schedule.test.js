import test from 'node:test';
import assert from 'node:assert/strict';
import {validateYearEndChoices,canUseYearEndSchedule,sortYearEndRegistrations,YEAR_END_PROJECT,YEAR_END_SHIFTS,YEAR_END_GROUPS} from '../src/year-end-schedule.js';

test('each category accepts exactly one choice; all four cross-category combinations remain valid',()=>{
  for(const plantao of ['natal','reveillon'])for(const grupo of ['natal','reveillon'])assert.deepEqual(validateYearEndChoices({plantao,grupo}),{plantao,grupo});
  for(const input of [null,[],{}, {plantao:['natal','reveillon'],grupo:'natal'},{plantao:'natal',grupo:['natal','reveillon']},{plantao:'natal',grupo:'all'},{plantao:'natal',grupo:'natal',position:1}])assert.throws(()=>validateYearEndChoices(input));
});
test('the approved FE project and exact dates preserve the midday handover and new year',()=>{
  assert.equal(YEAR_END_PROJECT,'outros-48120');
  assert.deepEqual(YEAR_END_SHIFTS.map(s=>s.dates),['24 e 25/12/2026','31/12/2026 e 01/01/2027']);
  assert.equal(YEAR_END_GROUPS[0].detail,'Até 13h30 do dia 29/12');
  assert.equal(YEAR_END_GROUPS[1].dates,'29/12/2026, após 13h30');
  assert.equal(YEAR_END_GROUPS[1].detail,'E nos dias 02 e 03/01/2027');
});
test('team eligibility requires the server-approved matching profile and verified account',()=>{
  const session={status:'signed-in',user:{uid:'one',email:'one@example.invalid',emailVerified:true},profile:{uid:'one',email:'one@example.invalid',active:true,access:true}};
  assert.equal(canUseYearEndSchedule(session),true);
  for(const change of [s=>s.status='auth-limited',s=>s.profile.active=false,s=>s.profile.access=false,s=>s.profile.uid='other',s=>s.user.emailVerified=false,s=>s.profile.email='other@example.invalid']){const altered=structuredClone(session);change(altered);assert.equal(canUseYearEndSchedule(altered),false);}
});
test('the ranking uses numerical confirmation order without mutating the input',()=>{
  const rows=[{position:10},{position:2},{position:1}];assert.deepEqual(sortYearEndRegistrations(rows).map(r=>r.position),[1,2,10]);assert.equal(rows[0].position,10);
});
