import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {UNUSED_SCHEDULE_HELPERS,pruneUnusedScheduleRuleHelpers} from '../scripts/lib/firestore-rules-unused-helpers.js';
const source=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
test('prunes only unreachable legacy schedule helpers, preserving all allow expressions',()=>{
 const result=pruneUnusedScheduleRuleHelpers(source);
 assert.deepEqual(result.removed,[...UNUSED_SCHEDULE_HELPERS]);assert.ok(result.removedSourceBytes>3000);
 assert.deepEqual([...result.source.matchAll(/\ballow\s[\s\S]*?;/g)].map(x=>x[0]),[...source.matchAll(/\ballow\s[\s\S]*?;/g)].map(x=>x[0]));
 assert.deepEqual(pruneUnusedScheduleRuleHelpers(result.source),{source:result.source,removed:[],removedSourceBytes:0});
 for(const name of ['signedIn','profile','activeUser','isAdmin','can'])assert.ok(result.source.includes('function '+name+'('));
});
test('future call site blocks pruning; strings/comments are not executable references',()=>{
 const close=source.lastIndexOf('\n  }');
 assert.throws(()=>pruneUnusedScheduleRuleHelpers(source.slice(0,close)+'\n match /synthetic/{id} { allow write: if validNewScheduleDay(request.resource.data,id); }\n'+source.slice(close)),/STILL_REFERENCED/);
 const suffix="\n// validNewScheduleDay() is retired; ' } { ' are not braces\n";
 assert.deepEqual(pruneUnusedScheduleRuleHelpers(source+suffix).removed,[...UNUSED_SCHEDULE_HELPERS]);
});
test('partial and shadowed declarations fail closed',()=>{
 assert.throws(()=>pruneUnusedScheduleRuleHelpers(source.replace('function validNewScheduleDay(','function renamedLegacy(')),/SET_INCOMPLETE/);
 assert.throws(()=>pruneUnusedScheduleRuleHelpers(source.replace('function validNewScheduleDay(','function validSchedulePositions(')),/DECLARATION_AMBIGUOUS/);
});
