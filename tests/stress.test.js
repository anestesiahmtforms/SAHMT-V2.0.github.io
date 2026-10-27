import test from 'node:test';import assert from 'node:assert/strict';
import {QUESTIONS,DIMENSIONS,VERSION,CYCLE,calculate,validateSubmission} from '../stress-domain/schema.js';
import {GUIDANCE,SOURCE_GUIDES,SAFETY_NOTE,LIMITATION} from '../stress-domain/guidance.js';
import {aggregate} from '../stress-domain/aggregate.js';
import {commitBody} from '../climate/stress-transport.js';
export function answersFor(total){let remaining=total;return Object.fromEntries(QUESTIONS.map(q=>{const value=Math.min(5,remaining);remaining-=value;return [q.id,value];}));}
const payload=()=>({survey_cycle:CYCLE,survey_version:VERSION,submission_id:'a'.repeat(32),group:'team',answers:answersFor(60)});
test('30 unique items, three domains and all institutional score boundaries',()=>{
 assert.equal(QUESTIONS.length,30);assert.equal(new Set(QUESTIONS.map(q=>q.id)).size,30);assert.equal(DIMENSIONS.length,3);
 for(const [n,band]of [[0,'mild'],[30,'mild'],[31,'moderate'],[60,'moderate'],[61,'high'],[90,'high'],[91,'very_high'],[150,'very_high']]){const result=calculate(answersFor(n));assert.equal(result.total,n);assert.equal(result.band,band);assert.equal(result.dimensions.reduce((sum,d)=>sum+d.score,0),n);assert.ok(GUIDANCE[band]);assert.ok(SOURCE_GUIDES.some(g=>g.band===band));}
 assert.equal(calculate(answersFor(60),10).total,60);assert.equal(calculate(answersFor(60),10).stressRating,10);
 assert.match(LIMITATION,/não validada/);assert.match(SAFETY_NOTE,/Independentemente da pontuação/);
});
test('missing or invalid answers never become zero, and identifiers/computed scores rejected',()=>{
 const missing=answersFor(0);delete missing.S01;assert.throws(()=>calculate(missing));
 for(const value of [null,undefined,'0',false,6,-1,2.5])assert.throws(()=>calculate({...answersFor(0),S01:value}));
 for(const key of ['uid','name','email','ip','timestamp','score','band'])assert.throws(()=>validateSubmission({...payload(),[key]:'forbidden'}));
 for(const group of ['',undefined,'unspecified','person'])assert.throws(()=>validateSubmission({...payload(),group}));
 for(const rating of [-1,11,'5',null,1.5])assert.throws(()=>validateSubmission({...payload(),stress_rating:rating}));
 assert.equal(validateSubmission({...payload(),group:'substitute',stress_rating:0}).stress_rating,0);
});
test('REST payload contains only allowed survey data, no derived score, identity or optional-rating imputation',()=>{
 const fields=commitBody(payload()).writes[0].update.fields;assert.deepEqual(Object.keys(fields).sort(),['answers','group','survey_cycle','survey_version']);assert.equal(fields.answers.mapValue.fields.S01.integerValue,'5');
 assert.equal(commitBody({...payload(),stress_rating:0}).writes[0].update.fields.stress_rating.integerValue,'0');
});
test('overall + group means use complementary suppression; secretaries never released',()=>{
 const rows=[...Array.from({length:10},()=>({...payload(),answers:answersFor(20),group:'team'})),...Array.from({length:6},()=>({...payload(),answers:answersFor(70),group:'resident'})),...Array.from({length:5},()=>({...payload(),answers:answersFor(90),group:'substitute'})),...Array.from({length:2},()=>({...payload(),answers:answersFor(150),group:'secretaries'}))].map(({submission_id,...r})=>r);
 const result=aggregate(rows);assert.equal(result.overall.respondents,23);assert.equal(result.groups.secretaries.suppressed,true);assert.equal(result.groups.substitute.suppressed,true);assert.equal(result.groups.team.suppressed,false);assert.equal(result.groups.resident.suppressed,false);
 for(const group of Object.values(result.groups)){assert.equal(Object.hasOwn(group,'histogram'),false);assert.equal(Object.hasOwn(group,'highOrVeryHighPercent'),false);if(group.suppressed)assert.equal(Object.hasOwn(group,'meanScore'),false);}
 assert.throws(()=>aggregate(rows.slice(0,4)));assert.equal(JSON.stringify(result).includes('S01'),false);
});
test('severity margins never leave the aggregate, including rare-cell and extreme-mean inference cases',()=>{
 const rows=[...Array.from({length:2},()=>({...payload(),answers:answersFor(10)})),...Array.from({length:10},()=>({...payload(),answers:answersFor(40)})),...Array.from({length:5},()=>({...payload(),answers:answersFor(70)})),...Array.from({length:5},()=>({...payload(),answers:answersFor(110)}))];
 const rare=[...Array.from({length:5},()=>({...payload(),answers:answersFor(0)})),{...payload(),answers:answersFor(61)}];
 const extreme=[...Array.from({length:10},()=>({...payload(),group:'team',answers:answersFor(0)})),...Array.from({length:10},()=>({...payload(),group:'resident',answers:answersFor(150)})),...Array.from({length:5},()=>({...payload(),group:'substitute',answers:answersFor(150)})),...Array.from({length:2},()=>({...payload(),group:'secretaries',answers:answersFor(0)}))];
 for(const sample of [rows,rare,extreme]){const report=aggregate(sample);for(const field of ['histogram','highOrVeryHighPercent'])assert.equal(Object.hasOwn(report.overall,field),false);assert.equal(JSON.stringify(report).includes('"band"'),false);}
});
test('optional stress contributors are protected separately; action proposals derive from domain means',()=>{
 const rows=[...Array.from({length:10},()=>({...payload(),answers:answersFor(120),group:'team',stress_rating:5})),...Array.from({length:5},()=>({...payload(),answers:answersFor(100),group:'resident'})),...Array.from({length:5},()=>({...payload(),answers:answersFor(100),group:'substitute'})),...Array.from({length:2},()=>({...payload(),answers:answersFor(100),group:'secretaries',stress_rating:10}))];
 const result=aggregate(rows);assert.equal(result.overall.perceivedStress,null);assert.equal(result.groups.team.perceivedStress.mean,5);assert.ok(result.opportunities.some(o=>o.dimension===DIMENSIONS[0].label));
});
