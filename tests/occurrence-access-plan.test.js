import test from 'node:test';import assert from 'node:assert/strict';import {planOccurrenceAccess} from '../scripts/lib/occurrence-access-plan.js';
const u=uid=>({uid,email:uid+'@example.invalid',disabled:false});const p=uid=>({...u(uid),active:true,access:true,permissions:{labelsRead:true},updateTime:'v1'});
test('only occurrencesWrite is added; identity, role and other permissions untouched',()=>{
 const profile=p('a'),plan=planOccurrenceAccess({sourceUsers:[u('a')],profiles:[profile]});assert.deepEqual(plan.writes[0].updateMask.fieldPaths,['permissions.occurrencesWrite']);assert.equal(profile.permissions.occurrencesWrite,undefined);assert.deepEqual(Object.keys(plan.writes[0].update.fields),['permissions']);assert.deepEqual(plan.writes[0].currentDocument,{updateTime:'v1'});
});
test('protected, test, inactive, unapproved and already granted profiles unchanged',()=>{
 const profiles=[p('a'),p('b'),{...p('c'),active:false},{...p('d'),access:false},{...p('e'),permissions:{occurrencesWrite:true}}];assert.equal(planOccurrenceAccess({sourceUsers:profiles.map(x=>u(x.uid)),profiles,protectedUids:['a'],excludedUids:['b']}).writes.length,0);
});
test('ambiguous identities fail closed',()=>{assert.throws(()=>planOccurrenceAccess({sourceUsers:[u('a')],profiles:[{...p('a'),email:'other@example.invalid'}]}));});
