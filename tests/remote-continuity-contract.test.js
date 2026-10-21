import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContinuityProfile,validateContinuityResource,continuityEntriesForActor,CONTINUITY_MAX_AGE_MS} from '../src/remote-continuity-contract.js';
const now=Date.parse('2026-10-20T15:00:00Z'),day='2026-10-20';
const envelope=(overrides={})=>({schemaVersion:1,uid:'member-a',verifiedAt:now-25*3600000,profile:{uid:'member-a',displayName:'Pessoa sintética',email:'fixture@example.invalid',sigla:'AA',role:'temporario',active:true,access:true,permissions:{scheduleRead:true,eventsRead:true,labelsRead:true,checklistRead:true}},...overrides});
const resource=(kind,id,data,extra={})=>({schemaVersion:1,kind,id,data,verifiedAt:now,revision:'revision-1',...extra});

test('perfil remoto retém UID, permissões e data original, sem renovar autoridade',()=>{
 const value=envelope(),valid=validateContinuityProfile(value,now);
 assert.equal(valid.verifiedAt,value.verifiedAt);assert.equal(valid.profile.uid,value.uid);
 assert.deepEqual(valid.profile.permissions,value.profile.permissions);
 assert.equal(CONTINUITY_MAX_AGE_MS,7*86400000);
});
for(const [name,change] of [['UID divergente',p=>p.profile.uid='other'],['perfil expirado',p=>p.verifiedAt=now-CONTINUITY_MAX_AGE_MS-1],['data futura',p=>p.verifiedAt=now+1],['permissão textual',p=>p.profile.permissions.admin='true'],['sem estado booleano',p=>p.profile.active='true']])test('rejeita '+name,()=>{const value=envelope();change(value);assert.throws(()=>validateContinuityProfile(value,now),/CONTINUITY_/);});
test('recursos desconhecidos, snapshots parciais e metadados inválidos são recusados',()=>{
 assert.throws(()=>validateContinuityResource(resource('users','all',[]),now),/CONTINUITY_/);
 assert.throws(()=>validateContinuityResource(resource('stations','all',[],{complete:false}),now),/CONTINUITY_/);
 assert.throws(()=>validateContinuityResource(resource('stations','all',[],{verifiedAt:now+1}),now),/CONTINUITY_/);
 assert.equal(validateContinuityResource(resource('stations','all',[]),now).revision,'revision-1');
});
test('bootstrap filtra eventos/etiquetas pelo ator e prepara chaves de relatório reais',()=>{
 const profile=validateContinuityProfile(envelope(),now);
 const rows=[{id:'mine',date:day,active:true,createdByUid:'member-a'},{id:'participating',date:day,active:true,createdByUid:'other',memberSigla:'AA',staffSiglas:['AA']},{id:'other',date:day,active:true,createdByUid:'other',memberSigla:'BB',staffSiglas:['BB']}];
 const entries=continuityEntriesForActor(profile,[resource('events','2026-10',{records:rows}),resource('labels','2026-10',{records:rows}),resource('stations','all',[{id:'s1',active:true}])],{day,now});
 const events=entries.find(e=>e.kind==='events'&&e.id===`report:${day}:${day}:AA:100`);
 const labels=entries.find(e=>e.kind==='labels'&&e.id===`report:${day}:${day}:AA:50`);
 assert.deepEqual(events.data.records.map(r=>r.id),['mine','participating']);assert.deepEqual(labels.data.records.map(r=>r.id),['mine','participating']);
 assert.ok(entries.some(e=>e.kind==='events'&&e.id==='report:2026-10-01:2026-10-31:AA:100'));
 assert.ok(entries.some(e=>e.kind==='stations'&&e.id==='all'));
});
test('ausência de permissão não é suprida pela cópia remota',()=>{
 const p=envelope();p.profile.permissions={};
 assert.deepEqual(continuityEntriesForActor(validateContinuityProfile(p,now),[resource('stations','all',[]),resource('events','2026-10',{records:[]})],{day,now}),[]);
});
test('perfil inativo não recebe recursos',()=>{
 const p=envelope();p.profile.active=false;
 assert.throws(()=>continuityEntriesForActor(validateContinuityProfile(p,now),[],{day,now}),/CONTINUITY_ACCESS_DENIED/);
});
test('snapshot diário posterior atualiza o relatório mensal sem ressuscitar dados antigos',()=>{
 const p=validateContinuityProfile(envelope(),now),row={id:'r1',date:day,active:true,createdByUid:p.uid,description:'old'};
 const entries=continuityEntriesForActor(p,[resource('events','2026-10',{records:[row]},{verifiedAt:now-1000}),resource('events',day,{records:[{...row,description:'new'}]})],{day,now});
 assert.equal(entries.find(e=>e.id==='report:2026-10-01:2026-10-31:AA:100').data.records[0].description,'new');
 const removed=continuityEntriesForActor(p,[resource('events',day,{records:[row]},{verifiedAt:now-1000}),resource('events','2026-10',{records:[]})],{day,now});
 assert.equal(removed.find(e=>e.id===`report:${day}:${day}:AA:100`).data.records.length,0);
});
