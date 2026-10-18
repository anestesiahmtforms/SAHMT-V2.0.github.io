import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoSession, DEMO_MODULES} from '../src/demo-session.js';
test('two synthetic personas are isolated, resettable, and cannot become real users',()=>{
 const session=createDemoSession();assert.equal(session.snapshot().persona,null);
 assert.throws(()=>session.login('real-uid'),/DEMO_PERSONA/);
 session.login('common');session.record('events',{description:'Exemplo'});assert.equal(session.snapshot().records.events.length,1);
 session.login('admin');assert.equal(session.snapshot().records.events.length,0);session.reset();assert.equal(session.snapshot().persona,null);
});
test('common persona cannot alter administration or simulate a revision',()=>{
 const session=createDemoSession();session.login('common');assert.throws(()=>session.record('admin',{}),/DEMO_ADMIN/);assert.throws(()=>session.reviseTraining('training-1'),/DEMO_ADMIN/);
 assert.ok(DEMO_MODULES.includes('qmentum'));
});
test('retakes change status but not points; a revision starts blue and earns again',()=>{
 const session=createDemoSession();session.login('common');
 session.attemptTraining('training-1',{complete:true,score:2,maxScore:10});assert.equal(session.trainingState('training-1').color,'yellow');
 session.attemptTraining('training-1',{complete:true,score:8,maxScore:10});assert.equal(session.trainingState('training-1').color,'green');assert.equal(session.snapshot().points,2);
 session.login('admin');session.reviseTraining('training-1');session.login('common');assert.equal(session.trainingState('training-1').color,'blue');
 session.attemptTraining('training-1',{complete:true,score:5,maxScore:10});assert.equal(session.snapshot().points,7);
});
test('an unsent partial attempt is yellow but does not consume the one scored response',()=>{
 const session=createDemoSession();session.login('common');session.attemptTraining('training-1',{complete:false,score:0,maxScore:10,submitted:false});
 assert.equal(session.snapshot().points,0);assert.equal(session.trainingState('training-1').color,'yellow');
 session.attemptTraining('training-1',{complete:true,score:10,maxScore:10});assert.equal(session.snapshot().points,10);
});
test('no side effects are accepted as part of simulated payloads',()=>{
 const session=createDemoSession();session.login('admin');assert.throws(()=>session.record('events',{send:()=>fetch('https://invalid.example')}),/DEMO_INPUT/);
 assert.throws(()=>session.record('unknown',{}),/DEMO_MODULE/);
});
