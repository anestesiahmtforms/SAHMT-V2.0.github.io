import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndicatorSources,OPERATIONAL_SOURCE_ROUTES} from '../worker-indicators/sources.js';
import {SOURCE_READ_LIMITS} from '../worker-indicators/read-budget.js';

test('FD operational metrics read each instance owner with year filters and owner budgets',async()=>{
 const expected={checklists:'FG',labels:'FH',events:'FJ'},seen=[];
 const source=createIndicatorSources({getAccessToken:async()=> 'synthetic',readBudget:{reserve:async(project,count)=>({project,count}),settle:async()=>{}},fetchImpl:async(url,options)=>{
  const project=Object.entries({FA:'sahmt-17a16',FG:'sahmt-checklist-fg',FH:'sahmt-etiquetas-fh',FJ:'sahmt-escala-fj'}).find(([,id])=>url.includes('/projects/'+id+'/'))?.[0];
  const query=JSON.parse(options.body).structuredQuery;
  seen.push({project,collection:query.from[0].collectionId,where:query.where,orderBy:query.orderBy});
  return Response.json([]);
 }});
 for(const [collection,project] of Object.entries(expected)){
  const result=await source.load('operations',2026,'FA.'+collection);
  assert.equal(result.sources.FA[collection].status,'ok');
  assert.equal(result.readsByProject[project],1);
 }
 assert.deepEqual(OPERATIONAL_SOURCE_ROUTES,expected);
 assert.equal(SOURCE_READ_LIMITS.FH,6000);
 assert.deepEqual(seen.map(row=>[row.project,row.collection]),[['FG','checklists'],['FH','labels'],['FJ','events']]);
 for(const row of seen){assert.ok(row.where);assert.match(JSON.stringify(row.where),/2026-01-01/);assert.match(JSON.stringify(row.where),/2027-01-01/);assert.equal(row.orderBy[0].field.fieldPath,'date');}
 assert.equal(seen.some(row=>row.project==='FA'),false);
});

test('owner denial or unavailability produces unavailable source without FA fallback',async()=>{
 const urls=[];const source=createIndicatorSources({getAccessToken:async()=> 'synthetic',fetchImpl:async url=>{urls.push(url);return Response.json({}, {status:403});}});
 for(const collection of ['checklists','labels','events']){
  const result=await source.load('operations',2026,'FA.'+collection);
  assert.deepEqual(result.sources.FA[collection],{status:'unavailable',rows:[]});
 }
 assert.equal(urls.length,3);assert.ok(urls.every(url=>!url.includes('/projects/sahmt-17a16/')));
});
