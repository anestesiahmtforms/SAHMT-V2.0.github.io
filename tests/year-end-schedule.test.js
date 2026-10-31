import test from 'node:test';
import assert from 'node:assert/strict';
import {validateYearEndChoices,canUseYearEndSchedule,yearEndParticipation,sortYearEndRegistrations,YEAR_END_PROJECT,YEAR_END_SHIFTS,YEAR_END_GROUPS} from '../src/year-end-schedule.js';

test('each category accepts exactly one choice; all three shifts keep the two existing groups',()=>{
  for(const plantao of ['natal','reveillon','carnaval'])for(const grupo of ['natal','reveillon'])assert.deepEqual(validateYearEndChoices({plantao,grupo}),{plantao,grupo});
  assert.throws(()=>validateYearEndChoices({plantao:'carnaval',grupo:null}));
  assert.throws(()=>validateYearEndChoices({plantao:'carnaval',grupo:'carnaval'}));
  for(const input of [null,[],{}, {plantao:['natal','reveillon'],grupo:'natal'},{plantao:'natal',grupo:['natal','reveillon']},{plantao:'natal',grupo:'all'},{plantao:'natal',grupo:'natal',position:1}])assert.throws(()=>validateYearEndChoices(input));
});

test('only the canonical policy grants the four shift-only exemptions',()=>{
  for(const sigla of ['FR','AD','L2','LE','AB']){
    const policy={schemaVersion:1,cycle:'2026-2027',siglasByUid:{one:sigla}};
    const participation=yearEndParticipation(policy,'one');assert.equal(participation.requireGroup,sigla==='AB');
    if(sigla!=='AB')assert.deepEqual(validateYearEndChoices({plantao:'natal',grupo:null},participation),{plantao:'natal',grupo:null});
    else assert.throws(()=>validateYearEndChoices({plantao:'natal',grupo:null},participation));
  }
  for(const policy of [null,{schemaVersion:1,cycle:'2026-2027',siglasByUid:{}}])assert.throws(()=>yearEndParticipation(policy,'one'));
});
test('the approved FE project and exact dates preserve the midday handover and new year',()=>{
  assert.equal(YEAR_END_PROJECT,'outros-48120');
  assert.deepEqual(YEAR_END_SHIFTS.map(s=>s.dates),['24 e 25/12/2026','31/12/2026 e 01/01/2027','06, 07, 08 e 09/02/2027']);
  assert.deepEqual(YEAR_END_GROUPS.map(s=>s.id),['natal','reveillon']);
  assert.equal(YEAR_END_GROUPS[0].detail,'Até 13h30 do dia 29/12');
  assert.equal(YEAR_END_GROUPS[1].dates,'29/12/2026, após 13h30');
  assert.equal(YEAR_END_GROUPS[1].detail,'E nos dias 02 e 03/01/2027');
});
test('team eligibility requires the server-approved matching profile and verified account',()=>{
  const session={status:'signed-in',user:{uid:'one',email:'one@example.invalid',emailVerified:true},profile:{uid:'one',email:'one@example.invalid',active:true,access:true}};
  assert.equal(canUseYearEndSchedule(session),true);
  for(const category of ['RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO'])assert.equal(canUseYearEndSchedule({...session,profile:{...session.profile,memberCategories:[category,'ADMINISTRADOR']}}),false);
  for(const change of [s=>s.status='auth-limited',s=>s.profile.active=false,s=>s.profile.access=false,s=>s.profile.uid='other',s=>s.user.emailVerified=false,s=>s.profile.email='other@example.invalid']){const altered=structuredClone(session);change(altered);assert.equal(canUseYearEndSchedule(altered),false);}
});
test('the ranking uses numerical confirmation order without mutating the input',()=>{
  const rows=[{position:10},{position:2},{position:1}];assert.deepEqual(sortYearEndRegistrations(rows).map(r=>r.position),[1,2,10]);assert.equal(rows[0].position,10);
});
