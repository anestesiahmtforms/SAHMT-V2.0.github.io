import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingFolderLevel} from '../src/html-training-folders.js';
const item=(id,category,subcategory='')=>({id,title:id,category,subcategory});
const catalog=[item('one','Protocolos','Protocolos do SAHMT'),item('two','Protocolos','Protocolos da Instituição'),item('guide','Diretrizes'),item('risk','ROPs','Avaliação de riscos'),item('general','Documentos administrativos','Acesso geral'),item('restricted','Documentos administrativos','Acesso restrito')];
test('folder roots follow the supplied outline with only authorized catalog counts',()=>{
 const root=trainingFolderLevel(catalog);
 assert.deepEqual(root.folders.map(f=>f.name),['Protocolos','Diretrizes','ROPs','Documentos administrativos']);
 assert.deepEqual(root.folders.map(f=>f.count),[2,1,1,2]);assert.deepEqual(root.trainings,[]);
 const common=trainingFolderLevel(catalog.filter(t=>t.id!=='restricted'),['Documentos administrativos']);
 assert.equal(common.folders.find(f=>f.name==='Acesso restrito').count,0);
 assert.equal(JSON.stringify(common).includes('"id":"restricted"'),false);
});
test('protocol folders, administrative folders and ROP domains do not mix documents',()=>{
 assert.deepEqual(trainingFolderLevel(catalog,['Protocolos']).folders.map(f=>f.name),['Protocolos do SAHMT','Protocolos da Instituição']);
 assert.deepEqual(trainingFolderLevel(catalog,['Protocolos','Protocolos da Instituição']).trainings.map(t=>t.id),['two']);
 assert.deepEqual(trainingFolderLevel(catalog,['Documentos administrativos']).folders.map(f=>f.name),['Acesso restrito','Acesso geral']);
 assert.equal(trainingFolderLevel(catalog,['ROPs']).folders.length,6);
 assert.deepEqual(trainingFolderLevel(catalog,['ROPs','Avaliação de riscos']).trainings.map(t=>t.id),['risk']);
 assert.deepEqual(trainingFolderLevel(catalog,['Diretrizes']).trainings.map(t=>t.id),['guide']);
});
test('organization preserves item identity, legacy ROP category names and unknown folders',()=>{
 const rows=[item('legacy','ROPs - Anestesiologia HMT','Segurança'),item('new','Outra categoria','Nova pasta'),item('unclassified','Protocolos')];
 const before=structuredClone(rows);
 assert.equal(trainingFolderLevel(rows,['ROPs','Segurança']).trainings[0],rows[0]);
 assert.deepEqual(trainingFolderLevel(rows,['Outra categoria','Nova pasta']).trainings.map(t=>t.id),['new']);
 assert.deepEqual(trainingFolderLevel(rows,['Protocolos']).trainings.map(t=>t.id),['unclassified']);
 assert.deepEqual(rows,before);
});
