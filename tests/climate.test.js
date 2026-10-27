import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMON, MODULES, OPEN, DIMENSIONS, validateSubmission, VERSION, CYCLE,groupForModule} from '../climate-domain/schema.js';
import {aggregate,summarize} from '../climate-domain/aggregate.js';
import {actionIndicators} from '../climate-domain/actions.js';
const answers = (value = 4) => Object.fromEntries(COMMON.map(q => [q.id, value]));
const payload = () => ({survey_version: VERSION, survey_cycle: CYCLE, submission_id: 'a'.repeat(32), consent: true, answers: answers(), comments: {O01: 'Integração'},group:'team'});
test('action indicators validate aggregate counts and handle zero denominators', () => {
  assert.deepEqual(actionIndicators({due:10,completedOnTime:8,reevaluated:4,effective:3}), {onTime:{numerator:8,denominator:10,percent:80},effectiveness:{numerator:3,denominator:4,percent:75}});
  assert.equal(actionIndicators({due:0,completedOnTime:0,reevaluated:0,effective:0}).onTime.percent,null);
  for(const input of [{due:1,completedOnTime:2,reevaluated:0,effective:0},{due:0,completedOnTime:0,reevaluated:1,effective:2},{due:0,completedOnTime:0,reevaluated:0,effective:0,uid:'forbidden'}])assert.throws(()=>actionIndicators(input));
});
test('editorial instrument: 32 common, 8 dimensions, 15 conditional and 5 open questions', () => {
  assert.equal(COMMON.length, 32); assert.equal(DIMENSIONS.length, 8); assert.equal(Object.values(MODULES).flat().length, 15); assert.equal(OPEN.length, 5);
  assert.equal(new Set([...COMMON, ...Object.values(MODULES).flat(), ...OPEN].map(q => q.id)).size, 52);
});
test('reject identifiers and unexpected data at every payload level', () => {
  for (const key of ['uid', 'UID', 'email', 'name', 'ip', 'timestamp', 'profile']) assert.throws(() => validateSubmission({...payload(), [key]: 'secret'}));
  assert.throws(() => validateSubmission({...payload(), answers: {...answers(), uid: 'secret'}}));
  assert.throws(() => validateSubmission({...payload(), comments: {email: 'secret'}}));
  assert.deepEqual(validateSubmission(payload()).answers, answers());
});
test('validate consent, cycle, token, numeric values, comments and mixed modules', () => {
  for (const change of [{consent: false}, {survey_cycle: 'bad'}, {survey_version: '2'}, {submission_id: 'uid'}, {answers: {Q01: '4'}}, {answers: {Q01: 6}}, {answers: {Q01: 'NA'}}, {comments: {O01: 'x'.repeat(1501)}}, {answers: {...answers(), R01: 4, T01: 5}}]) assert.throws(() => validateSubmission({...payload(), ...change}));
  assert.equal(validateSubmission({...payload(),group:'resident', answers: {Q01: 1, Q02: 'NA', R01: 5}, comments: {}}).answers.Q02, 'NA');
});
test('favorability excludes NA and blanks and uses actual numeric denominators', () => {
  const rows = Array.from({length: 10}, (_, i) => ({answers: answers(i < 5 ? 5 : 2)}));
  const result = summarize(rows,COMMON.map(q=>q.id),rows.length); assert.equal(result.favorable, 50); assert.equal(result.denominator, 320); assert.equal(aggregate(rows).participation.suppressed,true);
  rows.slice(0, 5).forEach(row => { row.answers.Q01 = 'NA'; });
  assert.equal(summarize(rows,COMMON.slice(0,4).map(q=>q.id),rows.length).denominator, 35);
});
test('suppress small samples, item denominators and small complements', () => {
  assert.throws(() => aggregate(Array.from({length: 4}, () => ({answers: answers()}))));
  const rows = Array.from({length: 10}, () => ({answers: answers()}));
  rows.slice(0, 6).forEach(row => { row.answers.Q01 = 'NA'; });
  assert.equal(summarize(rows,['Q01'],rows.length), null);
  rows.forEach(row => { row.answers.Q01 = 4; }); rows[0].answers.Q01 = 'NA'; assert.equal(summarize(rows,['Q01'],rows.length), null);
});
test('administrative module never published, including inference via complementary module totals', () => {
  const rows = Array.from({length: 12}, (_, i) => ({answers: {...answers(), ...Object.fromEntries(MODULES[i < 5 ? 'resident' : i < 10 ? 'preceptor' : 'administrative'].map(q => [q.id, 4]))}}));
  const result = aggregate(rows); assert.equal(result.groups.secretaries.suppressed,true); assert.equal(result.modules,undefined);
  assert.equal(JSON.stringify(result).includes('A01'), false); assert.equal(JSON.stringify(result).includes('submission_id'), false);
});
test('four requested groups remain separate, secretaries and pooled scores never disclosed',()=>{
 const rows=[...Array.from({length:5},()=>({group:'resident',answers:answers(5)})),...Array.from({length:5},()=>({group:'team',answers:answers(1)})),...Array.from({length:2},()=>({group:'secretaries',answers:answers(3)}))];
 rows.push(...Array.from({length:5},()=>({group:'substitute',answers:answers(4)})));
 const result=aggregate(rows);assert.deepEqual(Object.keys(result.groups),['team','resident','secretaries','substitute']);assert.equal(result.groups.resident.general.favorable,100);assert.equal(result.groups.team.general.favorable,0);assert.equal(result.groups.substitute.general.favorable,100);assert.equal(result.groups.secretaries.suppressed,true);
 for(const field of ['general','dimensions','psychologicalSafety','safetyCulture','contribution','improvementTrust','modules'])assert.equal(Object.hasOwn(result,field),false,field);
 assert.equal(Object.hasOwn(result.groups.secretaries,'general'),false);
 rows.push(...Array.from({length:10},()=>({group:'secretaries',answers:answers(5)})));assert.equal(aggregate(rows).groups.secretaries.suppressed,true);
});
test('unclassified older responses are never guessed as team and module groups are validated',()=>{
 const legacy=Array.from({length:5},()=>({answers:answers(5)}));assert.equal(aggregate(legacy).groups.team.suppressed,true);
 assert.equal(groupForModule('preceptor'),'team');assert.equal(groupForModule('clinical'),'team');assert.equal(groupForModule('resident'),'resident');assert.equal(groupForModule('administrative'),'secretaries');assert.equal(groupForModule('none'),'unspecified');
 assert.throws(()=>validateSubmission({...payload(),group:'team',answers:{Q01:4,R01:4}}));assert.throws(()=>validateSubmission({...payload(),group:'someone'}));
 const old={...payload(),survey_version:'1.0'};delete old.group;assert.throws(()=>validateSubmission(old));
 assert.throws(()=>validateSubmission({...old,group:'team'}));
 const missing=payload();delete missing.group;assert.throws(()=>validateSubmission(missing));assert.throws(()=>validateSubmission({...payload(),group:'unspecified'}));assert.equal(validateSubmission({...payload(),group:'substitute'}).group,'substitute');
});
