import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndicatorService} from '../worker-indicators/service.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
import {METRICS} from '../indicators-platform/domain/catalog.js';

const metricId='management-activity-on-time';
const now=Date.parse('2026-10-28T12:00:00Z');
const identity=(uid)=>({uid,email:`${uid}@example.invalid`,provider:'google.com',emailVerified:true});
const profile=(user)=>({...user,active:true,access:true,role:'administrador_app'});

function fixture({clock=now,enabled=true,effectiveFrom='2026-10-01T00:00:00.000Z'}={}){
 const store=vaccinationMemoryStore(),profiles=new Map(),user=identity('fd-author');
 profiles.set('FA:'+user.uid,profile(user));profiles.set('FD:'+user.uid,profile(user));
 store.seed('users',user.uid,profile(user));
 store.seed('fdPerformanceRuntime','current',{schemaVersion:1,projectId:'rotinas-8a617',enabled,effectiveFrom});
 store.seed('indicatorSnapshots','2026_management',{schemaVersion:1,year:2026,platform:'management',version:1,status:'AVAILABLE',metrics:[{...METRICS.find(m=>m.id===metricId),months:[],quarters:[]}]});
 const sources={async profile(project,uid){return structuredClone(profiles.get(project+':'+uid)||null);},async load(){return {sources:{},connectionStatus:[],reads:0};}};
 const service=createIndicatorService({store,sources,now:()=>clock,uuid:()=> 'fd-performance-test-id'});
 return {store,profiles,user,service};
}

test('FD performance acknowledgement is worth one point and idempotent per user indicator and year',async()=>{
 const f=fixture();
 const first=await f.service.execute('ACKNOWLEDGE_INDICATOR',{metricId,year:2026},f.user);
 const retry=await f.service.execute('ACKNOWLEDGE_INDICATOR',{metricId,year:2026},f.user);
 assert.equal(first.award.points,1);
 assert.equal(retry.award.points,1);
 assert.equal((await f.store.list('fdPerformanceAwards')).length,1);
});

test('FD suggestion awards two points only after a different authorized reviewer approves it',async()=>{
 const f=fixture(),reviewer=identity('fd-reviewer');
 f.profiles.set('FA:'+reviewer.uid,profile(reviewer));f.profiles.set('FD:'+reviewer.uid,profile(reviewer));
 f.store.seed('users',reviewer.uid,profile(reviewer));
 const pending=await f.service.execute('SUBMIT_SUGGESTION',{metricId,year:2026,text:'Avaliar outra forma de organizar este indicador.'},f.user);
 assert.equal(pending.suggestion.status,'PENDING');
 assert.equal((await f.store.list('fdPerformanceAwards')).length,0);
 const approved=await f.service.execute('REVIEW_SUGGESTION',{suggestionId:pending.suggestion.id,decision:'APPROVED'},reviewer);
 assert.equal(approved.award.points,2);
 assert.equal((await f.store.list('fdPerformanceAwards')).length,1);
});

test('FD performance rejects self approval and requests before activation',async()=>{
 const f=fixture();
 const pending=await f.service.execute('SUBMIT_SUGGESTION',{metricId,year:2026,text:'Avaliar outra forma de organizar este indicador.'},f.user);
 await assert.rejects(f.service.execute('REVIEW_SUGGESTION',{suggestionId:pending.suggestion.id,decision:'APPROVED'},f.user),e=>e.code==='FD_PERFORMANCE_SELF_REVIEW');
 const before=fixture({clock:Date.parse('2026-09-30T23:59:59Z')});
 await assert.rejects(before.service.execute('ACKNOWLEDGE_INDICATOR',{metricId,year:2026},before.user),e=>e.code==='FD_PERFORMANCE_BEFORE_ACTIVATION');
});

test('FD read-authorized users can earn points but cannot approve suggestions',async()=>{
 const f=fixture(),reader=identity('fd-reader');
 const fdProfile={uid:reader.uid,email:reader.email,active:true,access:true,role:'usuario',permissions:{managementIndicatorsRead:true}};
 f.profiles.set('FA:'+reader.uid,profile(reader));
 f.profiles.set('FD:'+reader.uid,fdProfile);
 f.store.seed('users',reader.uid,fdProfile);
 const acknowledged=await f.service.execute('ACKNOWLEDGE_INDICATOR',{metricId,year:2026},reader);
 assert.equal(acknowledged.award.points,1);
 const suggestion=await f.service.execute('SUBMIT_SUGGESTION',{metricId,year:2026,text:'Proponho revisar a organização deste indicador.'},reader);
 await assert.rejects(f.service.execute('REVIEW_SUGGESTION',{suggestionId:suggestion.suggestion.id,decision:'APPROVED'},reader),e=>e.code==='INDICATOR_FORBIDDEN');
 assert.equal((await f.store.list('fdPerformanceAwards')).length,1);
});
