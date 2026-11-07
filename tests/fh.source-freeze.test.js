import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildFhSourceRulesFreeze} from '../scripts/lib/fh-source-freeze.js';
test('FH source freeze changes exactly labels and its catalog while preserving every other byte',async()=>{
 const source=await readFile(new URL('../firestore.fa.fi-fj-retired.rules',import.meta.url),'utf8'),result=buildFhSourceRulesFreeze(source);assert.deepEqual(result.replacements.map(x=>x.collection).sort(),['appConfig/labelStaff','labels']);
 let original=result.content;for(const r of [...result.replacements].reverse())original=original.slice(0,r.preparedStart)+r.original+original.slice(r.preparedEnd);assert.equal(original,source);
 assert.match(result.content,/match \/labels\/\{fhDocument=\*\*\} \{ allow read, write: if false; \}/);assert.match(result.content,/match \/appConfig\/labelStaff \{ allow read, write: if false; \}/);
 assert.throws(()=>buildFhSourceRulesFreeze(source.replace('match /{document=**} {','match /{document=**} { allow read: if true;')),/FREEZE_/);
});
