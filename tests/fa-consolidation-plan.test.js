import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFaConsolidationPlan, faConsolidationReport} from '../scripts/lib/fa-consolidation-plan.js';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';

const FA='sahmt-17a16', FB='sahmt-gestao-5ae66';
const time='2026-10-15T10:00:00.123456Z';
const doc=(path,fields)=>({path,fields,createTime:time,updateTime:time});
const snapshot=(projectId,documents=[],rootCollections=['trainings'])=>({schemaVersion:1,projectId,databaseId:'(default)',readTime:time,coverage:{complete:true,consistent:true,rootCollections},documents});
const setup=(a=[],b=[],scope=['trainings'])=>({source:snapshot(FB,a,scope),destination:snapshot(FA,b,scope),scope});

test('FB -> FA creates exact IDs, preserves typed values, timestamps and historical attribution',()=>{
 const fields={title:{stringValue:'sintético'},large:{integerValue:'9223372036854775807'},stamp:{timestampValue:time},bytes:{bytesValue:'AAE='},point:{geoPointValue:{latitude:-19,longitude:-43}},origin:{stringValue:FB},value:{doubleValue:'NaN'},list:{arrayValue:{values:[{mapValue:{fields:{ok:{booleanValue:true}}}}]}}};
 const input=setup([doc('trainings/fixture',fields)]),before=structuredClone(input),plan=prepareFaConsolidationPlan(input);
 assert.equal(plan.ready,true);assert.equal(plan.operations[0].action,'CREATE');assert.equal(plan.operations[0].path,'trainings/fixture');
 assert.deepEqual(plan.operations[0].fields,fields);assert.deepEqual(plan.operations[0].precondition,{exists:false});assert.equal(plan.operations[0].sourceUpdateTime,time);
 assert.deepEqual(input,before);assert.equal(plan.planSha256,prepareFaConsolidationPlan(input).planSha256);
});
test('equivalent document is skipped without writing or adding scores',()=>{
 const row=doc('trainings/fixture',{points:{integerValue:'2'}}),plan=prepareFaConsolidationPlan(setup([row],[row]));
 assert.equal(plan.ready,true);assert.equal(plan.operations[0].action,'SKIP');assert.equal(plan.counts.writes,0);
});
test('newer source timestamps alone do not resolve a collision',()=>{
 const input=setup([doc('trainings/fixture',{title:{stringValue:'atual'}})],[doc('trainings/fixture',{title:{stringValue:'anterior'}})]);
 const plan=prepareFaConsolidationPlan(input);assert.equal(plan.ready,false);assert.equal(plan.conflicts[0].code,'CONTENT_CONFLICT');assert.equal(plan.counts.writes,0);
 input.resolutions=[{path:'trainings/fixture',action:'USE_SOURCE',sourceFieldsSha256:snapshotDigest(input.source.documents[0].fields),destinationFieldsSha256:snapshotDigest(input.destination.documents[0].fields),reason:'FB é a fonte atual conferida'}];
 const resolved=prepareFaConsolidationPlan(input);assert.equal(resolved.ready,true);assert.equal(resolved.operations[0].action,'UPDATE');assert.deepEqual(resolved.operations[0].precondition,{updateTime:time});
 input.resolutions[0].destinationFieldsSha256='0'.repeat(64);assert.throws(()=>prepareFaConsolidationPlan(input),/RESOLUTION_STALE/);
});
test('FA-only records require review to avoid resurfacing removed content',()=>{
 const input=setup([],[doc('trainings/old',{active:{booleanValue:true}})]),plan=prepareFaConsolidationPlan(input);
 assert.equal(plan.ready,false);assert.equal(plan.conflicts[0].code,'DESTINATION_ONLY_REVIEW');
 input.resolutions=[{path:'trainings/old',action:'KEEP_DESTINATION',destinationFieldsSha256:snapshotDigest(input.destination.documents[0].fields),reason:'Conteúdo exclusivo do FA confirmado'}];
 assert.equal(prepareFaConsolidationPlan(input).ready,true);
});
test('nested typed references are rewritten only to mapped FA documents; plain project strings remain historical',()=>{
 const fields={ref:{arrayValue:{values:[{mapValue:{fields:{value:{referenceValue:'projects/'+FB+'/databases/(default)/documents/trainings/fixture'}}}}]}},origin:{stringValue:FB}};
 const plan=prepareFaConsolidationPlan(setup([doc('trainings/fixture',fields)]));
 assert.equal(plan.operations[0].fields.ref.arrayValue.values[0].mapValue.fields.value.referenceValue,'projects/'+FA+'/databases/(default)/documents/trainings/fixture');
 assert.equal(plan.operations[0].fields.origin.stringValue,FB);
 const broken=structuredClone(fields);broken.ref.arrayValue.values[0].mapValue.fields.value.referenceValue='projects/'+FB+'/databases/(default)/documents/unknown/missing';
 assert.equal(prepareFaConsolidationPlan(setup([doc('trainings/fixture',broken)])).conflicts[0].code,'UNMAPPED_SOURCE_REFERENCE');
});
test('subcollections preserve their full paths and logical deletion markers',()=>{
 const row=doc('trainings/fixture/versions/v1',{deleted:{booleanValue:true}}),plan=prepareFaConsolidationPlan(setup([row]));
 assert.equal(plan.operations[0].path,row.path);assert.deepEqual(plan.operations[0].fields,row.fields);
});
test('identity, leases, wrong projects, incomplete coverage and unrecognized scope are blocked',()=>{
 for(const name of ['users','managementAuthorizationLeases','managementRuntime','evaluationUnknown','appConfig'])assert.throws(()=>prepareFaConsolidationPlan(setup([],[],[name])),/SCOPE/);
 for(const project of [FA,'indicadores---sahmt']){const input=setup();input.source.projectId=project;assert.throws(()=>prepareFaConsolidationPlan(input),/PROJECT/);}
 const input=setup();input.destination.coverage.complete=false;assert.throws(()=>prepareFaConsolidationPlan(input),/SNAPSHOT/);
});
test('shared collections cannot be copied wholesale',()=>{
 assert.throws(()=>prepareFaConsolidationPlan(setup([doc('notifications/fixture',{title:{stringValue:'sintético'}})],[],['notifications'])),/SHARED_SELECTION/);
});
test('aggregate report contains neither document IDs nor data values',()=>{
 const report=faConsolidationReport(prepareFaConsolidationPlan(setup([doc('trainings/private-id',{title:{stringValue:'private-value'}})])));
 assert.equal(report.counts.create,1);assert.equal(JSON.stringify(report).includes('private-'),false);
});
