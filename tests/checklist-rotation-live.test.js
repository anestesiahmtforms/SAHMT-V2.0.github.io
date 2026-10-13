import test from 'node:test';
import assert from 'node:assert/strict';
import {createChecklistRotationListener} from '../src/checklist-rotation-listener.js';
const day='2026-10-10';
function harness() {
 const subscriptions=new Map(),payloads=[];
 const sdk={doc:(_db,collection,id)=>`${collection}/${id}`,collection:(_db,name)=>name,where:()=>null,orderBy:()=>null,limit:()=>null,query:(collection)=>collection,
 onSnapshot:(reference,_options,next)=>{subscriptions.set(reference,next);return()=>subscriptions.delete(reference);}};
 const stop=createChecklistRotationListener({day,uid:'fixture'},value=>payloads.push(value),error=>{throw error;},{sdk,db:{}});
 const docSnapshot=(id,data)=>({id,exists:()=>!!data,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
 const schedule=events=>subscriptions.get(`scheduleDays/${day}`)(docSnapshot(day,{date:day,positions:[{position:1,sigla:'AA'},{position:2,sigla:'BB'}],highlights:{events}}));
 const name=sigla=>subscriptions.get(`eventMembers/${sigla}`)(docSnapshot(sigla,{sigla,name:'Pessoa '+sigla,active:true}));
 return {subscriptions,payloads,stop,schedule,name};
}
test('alteração de Eventos no documento compartilhado recalcula primeiro disponível sem planilha ou Functions',()=>{
 const h=harness();h.schedule([]);h.subscriptions.get('vacations')({docs:[],metadata:{fromCache:false,hasPendingWrites:false},docChanges:()=>[]});h.name('AA');
 assert.equal(h.payloads.at(-1).rotation.sigla,'AA');assert.equal(h.payloads.at(-1).current,true);
 h.schedule(['EVENTO:AA:AA:event-fixture']);h.name('BB');
 assert.equal(h.payloads.at(-1).rotation.sigla,'BB');assert.equal(h.payloads.at(-1).rotation.position,2);assert.equal(h.payloads.at(-1).current,true);
 h.schedule([]);h.name('AA');assert.equal(h.payloads.at(-1).rotation.sigla,'AA');
 h.stop();assert.equal(h.subscriptions.size,0);
});
