import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileContinuityOperation} from '../src/remote-continuity-reconciliation.js';
const now=Date.parse('2026-10-20T15:00:00Z');
const op={uid:'synthetic',requestId:'stable',collection:'checklists',day:'2026-10-19',createdAt:now-86400000,data:{date:'2026-10-19',stationId:'station1',condition:'SIM',status:'COMPLETED',occurrence:'',responsibleUid:null,responsibleName:null,responsibleEmail:null}};
const profile={uid:op.uid,active:true,access:true,role:'temporario',displayName:'Exemplo',permissions:{checklistWrite:true,scheduleWrite:true}};
test('reconciliação preserva dia histórico, identidade e criação com precondição de inexistência',()=>{
 let writes;const result=reconcileContinuityOperation(op,profile,{now,getDocument:()=>null,commit:input=>{writes=input;}});
 assert.equal(result.state,'confirmed');assert.equal(writes[0].currentDocument.exists,false);assert.equal(writes[0].record.date,'2026-10-19');assert.equal(writes[0].record.createdAt,new Date(op.createdAt).toISOString());assert.equal(writes[0].record.createdByUid,op.uid);
});
test('repetição do mesmo ID não grava e divergência não sobrescreve',()=>{
 let writes=0;const ctx={now,getDocument:()=>({data:{...op.data,id:op.requestId,clientMutationId:op.requestId,createdByUid:op.uid}}),commit:()=>writes++};
 assert.equal(reconcileContinuityOperation(op,profile,ctx).state,'confirmed');assert.equal(writes,0);
 ctx.getDocument=()=>({data:{...op.data,id:op.requestId,clientMutationId:op.requestId,createdByUid:'other'}});
 assert.equal(reconcileContinuityOperation(op,profile,ctx).state,'conflict');assert.equal(writes,0);
});
test('permissão revogada bloqueia antes da leitura do registro',()=>{
 const value=reconcileContinuityOperation(op,{...profile,active:false},{now,getDocument:()=>assert.fail('No record read'),commit:()=>assert.fail('No writes')});assert.equal(value.state,'conflict');assert.equal(value.code,'CONTINUITY_ACCESS_DENIED');
});
test('liberação da escala preserva CAS e não escolhe uma versão nova silenciosamente',()=>{
 const release={...op,collection:'scheduleReleases',data:{day:op.day,sigla:'AA',marked:true,groupSiglas:['AA'],tokenSigla:'AA',occurredAt:op.createdAt,expectedVersion:1}};
 const value=reconcileContinuityOperation(release,profile,{now,getDocument:()=>({updateTime:'v2',data:{version:2,highlights:{siglas:[]}}}),commit:()=>assert.fail('Conflict cannot write')});assert.equal(value.state,'conflict');
});
