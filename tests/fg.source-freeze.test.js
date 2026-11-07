import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildFgSourceRulesFreeze} from '../scripts/lib/fg-source-freeze.js';
test('FG source closure replaces exactly its five Checklist blocks and preserves every other rule byte',async()=>{
  const original=await readFile(new URL('../firestore.rules',import.meta.url),'utf8'),result=buildFgSourceRulesFreeze(original);
  assert.deepEqual(result.replacements.map(x=>x.collection).sort(),['checklistResponsibilities','checklistSignatureRequests','checklistSignatures','checklists','stations']);
  let before=0,after=0;
  for(const replacement of result.replacements){assert.equal(original.slice(before,replacement.originalStart),result.content.slice(after,replacement.preparedStart));assert.equal(result.content.slice(replacement.preparedStart,replacement.preparedEnd),`match /${replacement.collection}/{fgDocument=**} { allow read, write: if false; }`);before=replacement.originalEnd;after=replacement.preparedEnd;}
  assert.equal(original.slice(before),result.content.slice(after));
});
test('an overlapping permissive wildcard blocks the source closure',async()=>{
  const source=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
  const unsafe=source.replace('match /{document=**} {','match /{document=**} { allow read, write: if true;');
  assert.notEqual(unsafe,source);assert.throws(()=>buildFgSourceRulesFreeze(unsafe),/OVERLAPPING_ALLOW/);
});
