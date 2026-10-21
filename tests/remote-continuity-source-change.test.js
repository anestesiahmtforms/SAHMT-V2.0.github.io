import test from'node:test';import assert from'node:assert/strict';import{continuitySourceChanges}from'../src/remote-continuity-source-change.js';
test('alteração confirmada atualiza um catálogo completo sem eliminar outros itens',()=>{
 const resources=[{kind:'stations',id:'all',data:[{id:'a',name:'Antes'},{id:'b',name:'Outro'}]}];
 const result=continuitySourceChanges(resources,{path:'stations/a',data:{name:'Depois'},verifiedAt:100});
 assert.equal(result[0].data.length,2);assert.equal(result[0].data.find(row=>row.id==='a').name,'Depois');
 assert.equal(continuitySourceChanges([],{path:'stations/a',data:{name:'Depois'},verifiedAt:100}).length,0);
});
test('exclusão remove o item dos snapshots e publicação de escala não precisa de lista fictícia',()=>{
 const result=continuitySourceChanges([{kind:'labels',id:'2026-10',data:{records:[{id:'a',date:'2026-10-20'}]}}],{path:'labels/a',deleted:true,verifiedAt:100});assert.deepEqual(result[0].data.records,[]);
 const schedule=continuitySourceChanges([],{path:'scheduleDays/2026-10-21',data:{version:2},verifiedAt:100});assert.equal(schedule[0].data.version,2);
});
