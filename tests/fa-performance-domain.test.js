import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFaPerformance} from '../fa-performance/domain.js';
const start=Date.parse('2026-11-02T12:00:00Z'),now=start+10000;
const profiles=[{id:'a',uid:'a',sigla:'AA',active:true,access:true},{id:'b',uid:'b',sigla:'BB',active:true,access:true}];
const event=(more={})=>({id:'e',eventType:'atraso',delayMultiple:0,date:'2026-11-02',memberSigla:'AA',createdAt:start+1,active:true,status:'OPEN',...more});
const signature=(more={})=>({id:'s',date:'2026-11-02',responsibleUid:'a',signerUid:'b',signedAt:start+3,acknowledgedAt:start+1,declaration:true,snapshotValid:true,...more});
const request=(more={})=>({id:'2026-11-02',day:'2026-11-02',signerUid:'b',status:'VALIDATED',requestedAt:start+1,validatedAt:start+3,finalSignatureId:'s',...more});
const project=(more={})=>projectFaPerformance({events:[],signatures:[],requests:[],profiles,previousAwards:[],effectiveFrom:start,cutoffDay:'2026-11-02',now,complete:true,...more});
test('FA computes exact delay table independently from financial amounts and creator',()=>{
 for(let m=0;m<=6;m++){const p=project({events:[event({delayMultiple:m,amountToPay:999,createdByUid:'b'})]});assert.equal(p.totals.a,m===0?-.5:-m);assert.equal(p.totals.b,0);}
 assert.equal(project({events:[event({eventType:'OUTROS'})]}).awards.length,0);
 for(const delayMultiple of [null,'',-1,7,'1.5'])assert.equal(project({events:[event({delayMultiple})]}).pending,1);
});
test('FA excludes historical, undated, future and incomplete source reads',()=>{
 for(const more of [{createdAt:start-1},{createdAt:null},{date:'2026-11-01'},{date:'2026-11-04'}])assert.equal(project({events:[event(more)]}).awards.length,0);
 assert.throws(()=>project({complete:false}),/INCOMPLETE/);
});
test('FA accepts third party science once per day and self science earns zero',()=>{
 const p=project({signatures:[signature()],requests:[request()]});assert.equal(p.totals.a,-1);assert.equal(p.totals.b,1);
 const again=project({signatures:[signature(),signature({id:'s2',signedAt:start+4})],requests:[request(),request({finalSignatureId:'s2'})],previousAwards:p.awards});assert.equal(again.totals.b,1);assert.equal(again.ledger.length,0);
 const self=project({signatures:[signature({signerUid:'a'})],requests:[request({signerUid:'a'})]});assert.equal(self.totals.a,0);assert.equal(self.awards.length,1);
});
test('FA requires post-cutoff accepted request and trusted signature snapshot',()=>{
 for(const more of [{requestedAt:start-1},{validatedAt:null},{status:'DUPLICATE'}])assert.equal(project({signatures:[signature()],requests:[request(more)]}).awards.length,0);
 for(const more of [{snapshotValid:false},{signedAt:start-1},{acknowledgedAt:start-1}])assert.equal(project({signatures:[signature(more)],requests:[request()]}).awards.length,0);
});
test('FA retries and reconciles event edits/cancellation/deletion with signed deltas',()=>{
 const first=project({events:[event()]});assert.equal(first.ledger[0].delta,-.5);
 const repeat=project({events:[event()],previousAwards:first.awards});assert.equal(repeat.ledger.length,0);
 const changed=project({events:[event({delayMultiple:3})],previousAwards:first.awards});assert.equal(changed.totals.a,-3);assert.equal(changed.ledger[0].delta,-2.5);
 const paid=project({events:[event({status:'PAID',delayMultiple:3})],previousAwards:changed.awards});assert.equal(paid.totals.a,-3);
 for(const events of [[],[event({active:false})],[event({status:'CANCELLED'})]]){const p=project({events,previousAwards:changed.awards});assert.equal(p.totals.a,0);assert.equal(p.ledger[0].delta,3);}
 const corrected=project({events:[event({memberSigla:'BB'})],previousAwards:first.awards});assert.equal(corrected.totals.a,0);assert.equal(corrected.totals.b,-.5);
});
test('FA ambiguous identity stays pending; profile reassignment cannot transfer an existing debt',()=>{
 const ambiguous=[...profiles,{id:'c',uid:'c',sigla:'AA',active:true,access:true}];
 assert.equal(project({profiles:ambiguous,events:[event()]}).pending,1);
 const first=project({events:[event()]});const p=project({profiles:ambiguous,events:[event({delayMultiple:2})],previousAwards:first.awards});assert.equal(p.totals.a,-.5);assert.equal(p.ledger.length,0);
});
test('FA event edits keep correcting the same balance years later, with no expiry',()=>{
 const first=project({events:[event()]});const late=project({now:Date.parse('2030-02-01T12:00:00Z'),events:[event({delayMultiple:6})],previousAwards:first.awards});assert.equal(late.totals.a,-6);assert.equal(late.ledger[0].delta,-5.5);
 const historical=project({now:Date.parse('2030-02-01T12:00:00Z'),events:[event({createdAt:start-1,updatedAt:Date.parse('2030-02-01T11:00:00Z')})]});assert.equal(historical.totals.a,0);
});
