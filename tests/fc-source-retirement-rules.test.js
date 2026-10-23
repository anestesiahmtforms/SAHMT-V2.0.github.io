import test from 'node:test';import assert from 'node:assert/strict';
import {retireFcSourceRules} from '../scripts/lib/fc-source-retirement-rules.js';
const head="rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {\nmatch /users/{uid} {allow get: if request.auth.uid == uid;}\n";
const tail='\nmatch /{document=**} { allow read, write: if false; }\n}}';
const q='// BEGIN QMENTUM_FA\nmatch /qmentumUnits/{id} {allow read: if true;}\n// END QMENTUM_FA';
const o='// BEGIN OCCURRENCES_FA_V1\nmatch /{occurrenceCollection}/{id} {allow read: if true;}\n// END OCCURRENCES_FA_V1';
test('retirement removes only the two complete marked module sections and preserves identity rules byte for byte',()=>{
 const result=retireFcSourceRules(head+q+'\n'+o+tail,{requireBoth:true});
 assert.deepEqual(result,{source:head+'\n'+tail,removed:2});
 assert.equal(retireFcSourceRules(result.source).source,result.source);
});
test('malformed duplicate or unmarked module access and missing default denial block retirement',()=>{
 for(const source of [head+q+q+o+tail,head+q.replace('// END QMENTUM_FA','')+o+tail,head+q+o+'match /qmentumScoreOutbox/{id} {allow write: if true;}'+tail,head+q+o])assert.throws(()=>retireFcSourceRules(source));
 assert.throws(()=>retireFcSourceRules(head+o+tail,{requireBoth:true}),/SECTION_MISSING/);
});
