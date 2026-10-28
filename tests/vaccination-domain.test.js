import test from 'node:test';
import assert from 'node:assert/strict';
import { VACCINES, VACCINATION_CATEGORIES, VACCINATION_YEARS, VACCINATION_STATUSES, VACCINATION_DECLARATIONS, validateVaccinationInput, isVaccinationAdmin, buildVaccinationReport } from '../src/vaccination-domain.js';

const valid = () => ({ year: 2026, category: 'Equipe', awareness: false, truth: true, states: Object.fromEntries(['hepatitisB', 'tetanus', 'mmr', 'influenza'].map(id => [id, 'UNKNOWN'])), declaration: 'NO_PROOF', notes: '  Synthetic notes\r\nonly  ', expectedVersion: 0 });
test('complete vocabulary validates every category, year, state and declaration; false awareness accepted', () => {
  assert.equal(VACCINES.length, 4);
  for (const category of VACCINATION_CATEGORIES) for (const year of VACCINATION_YEARS) for (const status of VACCINATION_STATUSES) for (const declaration of VACCINATION_DECLARATIONS) {
    const result = validateVaccinationInput({ ...valid(), category, year, declaration: declaration.id, states: Object.fromEntries(VACCINES.map(v => [v.id, status.id])) });
    assert.equal(result.awareness, false); assert.equal(result.notes, 'Synthetic notes\nonly');
  }
});
test('invalid, incomplete and spoofed submissions are rejected', () => {
  for (const patch of [{year:2025},{year:'2026'},{category:'Other'},{awareness:0},{truth:false},{truth:'true'},{states:{}},{states:{...valid().states,extra:'UPDATED'}},{states:{...valid().states,mmr:'INVALID'}},{declaration:'INVALID'},{notes:'x'.repeat(1501)},{notes:123},{expectedVersion:-1},{expectedVersion:1.5},{expectedVersion:Number.MAX_SAFE_INTEGER},{uid:'another'},{email:'another@example.invalid'}]) {
    assert.throws(() => validateVaccinationInput({...valid(),...patch}), error => error.code === 'VAC_INVALID_INPUT');
  }
  for (const key of Object.keys(valid()).filter(k => !['notes','category'].includes(k))) { const input = valid(); delete input[key]; assert.throws(() => validateVaccinationInput(input)); }
  assert.equal(validateVaccinationInput({...valid(),notes:undefined}).notes,'');
});
test('only explicit application administrators qualify', () => {
  assert.equal(isVaccinationAdmin({role:'administrador_app'}),true);
  assert.equal(isVaccinationAdmin({permissions:{admin:true}}),true);
  for (const profile of [null,{}, {role:'gestor'}, {permissions:{peopleManage:true}}, {permissions:{admin:'true'}}]) assert.equal(isVaccinationAdmin(profile),false);
});
test('reports label registered versus respondents and distinguish unknown from no response', () => {
  const participants = ['one','two','three'].map(uid => ({uid,email:`${uid}@example.invalid`,active:true,access:true,category:'Equipe',memberCategories:['EFETIVO']}));
  participants.push({uid:'inactive',active:false,access:true},{uid:'revoked',active:true,access:false});
  for (let i=1;i<=5;i++) participants.push({uid:`owner${i}`,email:`anestesiahmtforms${i===1?'':i}@gmail.com`,active:true,access:true});
  const records = [{...valid(),uid:'one',states:{...valid().states,hepatitisB:'UPDATED'}},{...valid(),uid:'two',states:{...valid().states,hepatitisB:'PENDING'}},{...valid(),uid:'inactive'},{...valid(),uid:'three',year:2027}];
  const report = buildVaccinationReport(participants,records,2026), vaccine = report.general.vaccines.find(v => v.id === 'hepatitisB');
  assert.equal(report.general.registered,3); assert.equal(report.general.respondents,2); assert.equal(report.general.missingResponses,1);
  assert.deepEqual(vaccine.coverageRegistered,{numerator:1,denominator:3,percent:100/3});
  assert.deepEqual(vaccine.coverageRespondents,{numerator:1,denominator:2,percent:50});
  assert.equal(vaccine.pending,1); assert.equal(vaccine.unreported,1);
  assert.equal(report.general.vaccines.find(v=>v.id==='mmr').unknown,2);
  assert.equal(report.byGroup.find(g=>g.category==='Equipe').registered,3);
  assert.match(report.denominatorLabels.registered,/cadastrad/i);
});
test('report deduplicates identity, ignores outsider/year records and uses registry classification over saved categories', () => {
  const p={uid:'one',active:true,access:true,memberCategories:['RESIDENTE_2']};
  const report=buildVaccinationReport([p,p],[{...valid(),uid:'one',category:'Residentes',version:1},{...valid(),uid:'outsider'},{...valid(),uid:'one',category:'Residentes',version:2}],2026);
  assert.equal(report.general.registered,1);assert.equal(report.general.respondents,1);
  assert.equal(report.byGroup.find(g=>g.category==='Residentes').registered,1);
  assert.equal(report.byGroup.find(g=>g.category==='Equipe').participation.percent,null);
  assert.throws(()=>buildVaccinationReport([],[],2030));
});
