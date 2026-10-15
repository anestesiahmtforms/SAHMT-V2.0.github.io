import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveEvaluationStore} from '../src/evaluation-store.js';
const setup=()=>({faDb:{app:{options:{projectId:'sahmt-17a16'}}}, auth:{currentUser:{uid:'fixture'}},sdk:{}});
const fb=()=>({db:{app:{options:{projectId:'sahmt-gestao-5ae66'}}},auth:{currentUser:{uid:'fixture'}}});
test('FA default never initializes FB',async()=>{const x=setup();const s=await resolveEvaluationStore({...x,loadSecondary:()=>{throw Error('unexpected');}});assert.equal(s.db,x.faDb);});
test('stale FB target and foreign database fail closed',async()=>{
 await assert.rejects(()=>resolveEvaluationStore({...setup(),target:'FB',loadSecondary:async()=>fb()}),/CONFIGURATION_INVALID/);
 const x=setup();x.faDb.app.options.projectId='sahmt-gestao-5ae66';await assert.rejects(()=>resolveEvaluationStore(x),/CONFIGURATION_INVALID/);
});
test('logout, account switch and replacement session with the same UID invalidate old views',async()=>{
 for(const replacement of [null,{uid:'other'},{uid:'fixture'}]){const x=setup(),store=await resolveEvaluationStore(x);x.auth.currentUser=replacement;assert.throws(()=>store.assertSession(),/sessão expirou/);}
});
test('an unauthenticated view cannot acquire the evaluation store',async()=>{const x=setup();x.auth.currentUser=null;await assert.rejects(()=>resolveEvaluationStore(x),/sessão expirou/);});
