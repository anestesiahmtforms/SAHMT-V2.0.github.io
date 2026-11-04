import test from 'node:test';
import assert from 'node:assert/strict';
import {validateYearEndChoices,canUseYearEndSchedule,yearEndParticipation,yearEndParticipants,yearEndPendingParticipants,confirmedYearEndRegistration,sortYearEndRegistrations,YEAR_END_PROJECT,YEAR_END_SHIFTS,YEAR_END_GROUPS} from '../src/year-end-schedule.js';

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
test('an explicit empty sigla requires both choices and preserves the UID binding',()=>{
  const policy={schemaVersion:1,cycle:'2026-2027',siglasByUid:{one:null}};
  const participation=yearEndParticipation(policy,'one');
  assert.deepEqual(participation,{sigla:null,requireGroup:true});
  const record={uid:'one',sigla:null,position:1,plantao:'natal',grupo:'reveillon'};
  assert.equal(confirmedYearEndRegistration(record,{uid:'one',...participation}),true);
  assert.equal(confirmedYearEndRegistration({...record,grupo:null},{uid:'one',...participation}),false);
  assert.throws(()=>yearEndParticipation(policy,'other'),{code:'YEAR_END_INELIGIBLE'});
});
test('the approved FE project and exact dates preserve the midday handover and new year',()=>{
  assert.equal(YEAR_END_PROJECT,'outros-48120');
  assert.deepEqual(YEAR_END_SHIFTS.map(s=>s.dates),['24 e 25/12/2026','31/12/2026 e 01/01/2027','06, 07, 08 e 09/02/2027']);
  assert.deepEqual(YEAR_END_GROUPS.map(s=>s.id),['natal','reveillon']);
  assert.equal(YEAR_END_GROUPS[0].detail,'Até 13h30 do dia 29/12');
  assert.equal(YEAR_END_GROUPS[1].dates,'29/12/2026, após 13h30');
  assert.equal(YEAR_END_GROUPS[1].detail,'30/12/2026 · E nos dias 02 e 03/01/2027');
});
test('team eligibility requires the server-approved matching profile and verified account',()=>{
  const session={status:'signed-in',user:{uid:'one',email:'one@example.invalid',emailVerified:true},profile:{uid:'one',email:'one@example.invalid',active:true,access:true,memberCategories:['EFETIVO']}};
  assert.equal(canUseYearEndSchedule(session),true);
  for(const category of ['RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO'])assert.equal(canUseYearEndSchedule({...session,profile:{...session.profile,memberCategories:[category,'ADMINISTRADOR']}}),false);
  for(const change of [s=>s.status='auth-limited',s=>s.profile.active=false,s=>s.profile.access=false,s=>s.profile.uid='other',s=>s.user.emailVerified=false,s=>s.profile.email='other@example.invalid']){const altered=structuredClone(session);change(altered);assert.equal(canUseYearEndSchedule(altered),false);}
});
test('the ranking uses numerical confirmation order without mutating the input',()=>{
  const rows=[{position:10},{position:2},{position:1}];assert.deepEqual(sortYearEndRegistrations(rows).map(r=>r.position),[1,2,10]);assert.equal(rows[0].position,10);
});

test('administrator roster uses only the official policy and respects exclusions and group exemptions',()=>{
  const policy={schemaVersion:1,cycle:'2026-2027',siglasByUid:{one:'AB',two:'FR',three:null,excluded:'CD'},excludedUids:['excluded'],approvedBindingsByUid:{private:'not exposed'}};
  assert.deepEqual(yearEndParticipants(policy),[{uid:'one',sigla:'AB',requireGroup:true},{uid:'two',sigla:'FR',requireGroup:false},{uid:'three',sigla:null,requireGroup:true}]);
  for(const invalid of [null,{...policy,cycle:'2025-2026'},{...policy,siglasByUid:[]},{...policy,excludedUids:'excluded'}])assert.throws(()=>yearEndParticipants(invalid),{code:'YEAR_END_POLICY_UNAVAILABLE'});
});

test('pending siglas follow confirmed choices alphabetically without assigning positions or changing totals',()=>{
  const rows=[{uid:'confirmed',sigla:'CD',position:2},{uid:'outside-policy',sigla:'AB',position:1}];
  const participants=yearEndParticipants({schemaVersion:1,cycle:'2026-2027',siglasByUid:{pendingNull:null,pendingFR:'FR',confirmed:'CD',pendingAB:'AB',pendingAD:'AD'}});
  const before=structuredClone({rows,participants}),pending=yearEndPendingParticipants(rows,participants);
  assert.deepEqual(pending.map(p=>p.sigla),['AB','AD','FR',null]);assert.ok(pending.every(p=>!('position' in p)));
  assert.deepEqual({rows,participants},before,'as escolhas e a relação oficial não podem ser alteradas pela consulta');
  const confirmed=sortYearEndRegistrations(rows);assert.deepEqual(confirmed.map(p=>p.position),[1,2]);
  const newChoice={uid:'pendingAB',sigla:'AB',position:3};
  assert.deepEqual(yearEndPendingParticipants([...rows,newChoice],participants).map(p=>p.sigla),['AD','FR',null]);
  assert.deepEqual(yearEndPendingParticipants(rows,[]),[]);assert.equal(yearEndPendingParticipants([],participants).length,participants.length);
});
