import test from 'node:test';
import assert from 'node:assert/strict';
import {retiredChannelCollection,retiredContinuityKind} from '../worker-operational-channel/module-retirement.js';
import {continuityStateAction} from '../worker-operational-channel/continuity.js';
test('FH retirement closes only labels and its catalog while preserving existing FI/FJ flags and Checklist',()=>{
 const env={FI_FJ_MODULES_RETIRED:'true',FH_MODULE_RETIRED:'true'};
 for(const c of ['events','scheduleReleases','labels'])assert.equal(retiredChannelCollection(env,c),true);
 for(const c of ['labels','labelStaff'])assert.equal(retiredContinuityKind(env,c),true);
 for(const c of ['checklists','users','appConfig','contacts']){assert.equal(retiredChannelCollection(env,c),false);assert.equal(retiredContinuityKind(env,c),false);}
 assert.equal(retiredChannelCollection({FI_FJ_MODULES_RETIRED:'true'},'labels'),false);
});
test('FH retired queues are excluded before the bounded drain and audits expose the label pending count',async()=>{
 const statements=[];const sql={exec:(query)=>{statements.push(query);return {toArray:()=>query.includes('GROUP BY')?[{collection:'labels',count:3}]:[]};}};
 await continuityStateAction(sql,'/continuity-drain',{excludeMigratedModules:true,excludeFhLabels:true});assert.match(statements[0],/NOT IN \('events','scheduleReleases','labels'\).*LIMIT 10/);
 const r=await continuityStateAction(sql,'/continuity-module-audit',{}),data=await r.json();assert.equal(data.pendingLabels,3);assert.equal(data.pendingMigrated,0);assert.match(statements[1],/IN \('events','scheduleReleases','labels'\)/);
});
