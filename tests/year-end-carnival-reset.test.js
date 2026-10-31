import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resetYearEndForCarnival,activateYearEndCarnival,YEAR_END_CARNIVAL_RESET_ID} from '../scripts/lib/year-end-carnival-reset.js';
import {prepareYearEndCarnivalRules,yearEndRulesBlock} from '../scripts/lib/year-end-carnival-rules.js';
import {yearEndResetStore} from './helpers/year-end-reset-store.js';
import {emptyYearEndTotals,changeYearEndTotals} from '../src/year-end-schedule-totals.js';

test('dry-run reports only counts and performs no writes or record backups',async()=>{
 const f=yearEndResetStore(),plans=[];const report=await resetYearEndForCarnival({...f,onPlan:p=>plans.push(p)});
 assert.equal(report.registrations,2);assert.equal(f.calls.some(c=>c.path===':commit'),false);assert.equal(f.get(f.base+'/registrations/one').position,1);
 assert.doesNotMatch(JSON.stringify(plans),/plantao|grupo|createdAt|one|two/);
});
test('reset atomically removes only this cycle choices and zeroes counters without changing access or identity configuration',async()=>{
 const f=yearEndResetStore(),profile=f.get('users/one'),policy=f.get(f.base+'/policy/participation');
 const report=await resetYearEndForCarnival({...f,apply:true});assert.equal(report.deleted,2);assert.equal(report.remaining,0);assert.equal(report.verified,true);
 assert.equal(f.get(f.base+'/registrations/one'),null);assert.equal(f.get(f.base+'/registrations/two'),null);
 const totals=f.get(f.base+'/summary/totals');delete totals.updatedAt;assert.deepEqual(totals,emptyYearEndTotals());assert.equal(f.get(f.base+'/control/order').lastPosition,0);
 const next=f.get(f.base+'/policy/participation');assert.equal(next.summaryVersion,0);assert.equal(next.resetId,YEAR_END_CARNIVAL_RESET_ID);assert.deepEqual(next.siglasByUid,policy.siglasByUid);assert.equal(next.source,policy.source);
 assert.deepEqual(f.get('users/one'),profile);assert.deepEqual(f.get('otherCycle/registrations/one'),{preserved:true});
 const writes=f.calls.find(c=>c.path===':commit').body.writes;assert.equal(writes.filter(w=>w.delete).length,2);assert.ok(writes.every(w=>(w.delete||w.update.name).includes('/'+f.base+'/')));
});
test('a concurrent last test registration causes retry so no marking is left behind',async()=>{
 const f=yearEndResetStore();let changed=false;
 const report=await resetYearEndForCarnival({...f,apply:true,onPlan:()=>{if(changed)return;changed=true;const row=f.record('three',3);f.put(f.base+'/registrations/three',row);f.put(f.base+'/summary/totals',changeYearEndTotals(f.get(f.base+'/summary/totals'),null,row));}});
 assert.equal(report.deleted,3);assert.equal(f.get(f.base+'/registrations/three'),null);assert.equal(report.remaining,0);
});
test('activation requires verified release and empty reset; a later retry never erases new real registrations',async()=>{
 const f=yearEndResetStore();await assert.rejects(activateYearEndCarnival({...f,verifyRelease:async()=>{}}),/RESET_REQUIRED/);
 await resetYearEndForCarnival({...f,apply:true});await assert.rejects(activateYearEndCarnival({...f,verifyRelease:async()=>{throw Error('RELEASE_NOT_READY');}}),/RELEASE_NOT_READY/);assert.equal(f.get(f.base+'/policy/participation').summaryVersion,0);
 const active=await activateYearEndCarnival({...f,verifyRelease:async()=>{}});assert.equal(active.summaryVersion,2);
 f.put(f.base+'/registrations/one',{...f.record('one',1),plantao:'carnaval'});f.put(f.base+'/summary/totals',changeYearEndTotals(emptyYearEndTotals(),null,{plantao:'carnaval',grupo:'reveillon'}));
 const again=await resetYearEndForCarnival({...f,apply:true});assert.equal(again.alreadyReset,true);assert.equal(again.deleted,0);assert.equal(f.get(f.base+'/registrations/one').plantao,'carnaval');
});
test('rules publication preserves every unrelated live rule and rejects unreviewed scale changes',async()=>{
 const candidate=await readFile('firestore.climate.rules','utf8');
 const oldBlock=await readFile('tests/fixtures/year-end-legacy-block.rules','utf8');
 const legacy=candidate.replace(yearEndRulesBlock(candidate),()=>oldBlock),live='// another independently released module\n'+legacy;
 const prepared=prepareYearEndCarnivalRules(live,candidate);assert.equal(prepared.alreadyCurrent,false);assert.equal(prepared.content.replace(yearEndRulesBlock(prepared.content),''),live.replace(yearEndRulesBlock(live),''));
 assert.equal(prepareYearEndCarnivalRules(prepared.content,candidate).alreadyCurrent,true);assert.throws(()=>prepareYearEndCarnivalRules(live.replace('d.position > 0','d.position > 4'),candidate),/RULES_DRIFT/);
});
test('reset rejects other projects before any request',async()=>{
 await assert.rejects(resetYearEndForCarnival({projectId:'sahmt-17a16',request:()=>assert.fail('wrong project')}),/FE_PROJECT_REQUIRED/);
});
