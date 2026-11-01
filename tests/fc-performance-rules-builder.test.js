import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildFcPerformanceRules} from '../scripts/lib/fc-performance-rules.js';
test('FC performance appends only its rules while preserving all existing station rules',async()=>{
 const original=await readFile(new URL('../firestore.fc.rules',import.meta.url),'utf8'),built=buildFcPerformanceRules(original);
 assert.ok(built.includes('match /fcPerformanceAwards/{id}'));assert.equal(buildFcPerformanceRules(built),built);
 const strip=s=>s.replace(/\n    \/\/ BEGIN_FC_PERFORMANCE_V1[\s\S]*?    \/\/ END_FC_PERFORMANCE_V1\n/,'');
 assert.equal(strip(built),strip(original.replace(/\r\n/g,'\n')));
});
test('FC performance refuses an unrecognised base and conflicting rule definitions',()=>{
 assert.throws(()=>buildFcPerformanceRules('invalid'),/FC_PERFORMANCE_RULE_BASE_INVALID/);
 assert.throws(()=>buildFcPerformanceRules("rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /fcPerformanceAwards/{id} { allow read: if true; }\n  }\n}\n"),/FC_PERFORMANCE_RULE_CONFLICT/);
});
