import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotDigest,documentDigest,prepareSplitPlan} from '../scripts/lib/management-split-plan.js';
const module=await import('../scripts/lib/management-closed-staging.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const {prepareManagementClosedStagingBatch:prepare,validateManagementClosedStagingRead:validateRead,validateManagementClosedStagingCommit:validateCommit}=module;
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',base='projects/'+FB+'/databases/(default)/documents/';
const baselineTime='2026-10-09T01:04:00.000Z',captureTime='2026-10-09T19:29:04.765Z',readTime='2026-10-10T00:30:00.123456789Z',nowMs=Date.parse('2026-10-10T00:30:03.000Z'),captureSha='a'.repeat(64);
const value=v=>({stringValue:v}),clone=v=>structuredClone(v);
function fixture({copies=134,retained=231}={}){
 const docs=[...Array.from({length:copies},(_,i)=>({path:'managementAreas/area-'+i,fields:{title:value('Área '+i)},createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z'})),
 ...Array.from({length:retained},(_,i)=>({path:'users/member-'+i,fields:{active:{booleanValue:true}},createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z'}))];
 const sourceSnapshot={schemaVersion:1,projectId:FA,databaseId:'(default)',readTime:baselineTime,coverage:{complete:true,consistent:true,rootCollections:['managementAreas','users']},documents:docs};
 const destinationSnapshot={schemaVersion:1,projectId:FB,databaseId:'(default)',readTime:baselineTime,coverage:{complete:true,consistent:true,rootCollections:['managementAreas','users','migrationOrigins']},documents:[]};
 const manifest={schemaVersion:1,sourceProjectId:FA,sourceDatabaseId:'(default)',destinationProjectId:FB,destinationDatabaseId:'(default)',backupSha256:snapshotDigest(sourceSnapshot),
 identityMappings:[],entries:docs.map(d=>({path:d.path,sourceSha256:documentDigest(d),action:d.path.startsWith('users/')?'KEEP_FA':'COPY',reason:'Classificação local conferida',dependencies:[]}))};
 const plan=prepareSplitPlan(sourceSnapshot,manifest,destinationSnapshot),auditedSourceSnapshot={...clone(sourceSnapshot),readTime:captureTime};
 return {sourceSnapshot,destinationSnapshot,manifest,plan,auditedSourceSnapshot,sourceCaptureSha256:captureSha};
}
function regenerate(f){f.manifest.backupSha256=snapshotDigest(f.sourceSnapshot);for(const entry of f.manifest.entries)entry.sourceSha256=documentDigest(f.sourceSnapshot.documents.find(d=>d.path===entry.path));f.plan=prepareSplitPlan(f.sourceSnapshot,f.manifest,f.destinationSnapshot);return f;}
function emptyRows(batch,time=readTime){return batch.documentNames.map(name=>({missing:name,readTime:time}));}
function identicalRows(batch,time=readTime){return batch.writes.map(w=>({found:{name:w.update.name,fields:clone(w.update.fields),createTime:'2026-10-10T00:29:59.000Z',updateTime:'2026-10-10T00:29:59.000Z'},readTime:time}));}
function commit(batch,time='2026-10-10T00:30:01.123456789Z'){return {commitTime:time,writeResults:batch.documentNames.map(()=>({updateTime:time}))};}
function readInput(batch,rows,expectation='EMPTY'){return {batch,rows,readTime,expectation,nowMs};}
test('exports explícitos do módulo puro existem',()=>{for(const fn of [prepare,validateRead,validateCommit])assert.equal(typeof fn,'function');});
test('prepara 134 pares atômicos com 268 nomes FB únicos e provenance',()=>{
 const f=fixture(),b=prepare(f);assert.equal(b.writes.length,268);assert.equal(b.documentNames.length,268);assert.equal(new Set(b.documentNames).size,268);assert.equal(b.expectedDocuments.length,268);
 assert.equal(b.sourceReadTime,captureTime);assert.equal(b.baselineReadTime,baselineTime);assert.equal(b.planSha256,f.plan.planSha256);assert.equal(b.sourceCaptureSha256,captureSha);
 assert.deepEqual(b.counts,{sourceDocuments:365,copiedDocuments:134,keptInFa:231,provenanceDocuments:134,totalWrites:268});
 for(const w of b.writes){assert.equal(w.update.name.startsWith(base),true);assert.deepEqual(w.currentDocument,{exists:false});assert.equal(Object.hasOwn(w,'delete'),false);}
 assert.equal(b.productionAuthorized,false);assert.equal(b.migrationReady,false);assert.equal(b.historicalCapture,true);assert.equal(b.requiresReconciliationBeforeActivation,true);
 assert.ok(b.requestBytes<4*1024*1024);assert.equal(b.batchSha256.length,64);
});
test('preparação não altera entradas e usa cópias separadas',()=>{
 const f=fixture(),before=clone(f),b=prepare(f);assert.deepEqual(f,before);b.writes[0].update.fields.title.stringValue='Alterado';assert.deepEqual(f,before);
});
test('plano adulterado recusa antes da preparação',()=>{const f=fixture();f.plan.operations[0].fields.title=value('Mudou');assert.throws(()=>prepare(f),/STAGING_PLAN/);});
test('digest interno de plano adulterado recusa mesmo mantendo operações',()=>{const f=fixture();f.plan.planSha256='b'.repeat(64);assert.throws(()=>prepare(f),/STAGING_PLAN/);});
test('snapshot baseline ou manifesto diferentes recusam',()=>{
 for(const key of ['sourceSnapshot','manifest']){const f=fixture();if(key==='sourceSnapshot')f.sourceSnapshot.documents[0].fields.title=value('Outro');else f.manifest.entries[0].reason='Uma classificação diferente';assert.throws(()=>prepare(f));}
});
test('mudança no documento COPY auditado recusa',()=>{const f=fixture();f.auditedSourceSnapshot.documents[0].fields.title=value('Alterado');assert.throws(()=>prepare(f),/STAGING_SOURCE_CHANGED/);});
test('mudança em KEEP_FA auditado também recusa',()=>{const f=fixture();f.auditedSourceSnapshot.documents.at(-1).fields.active.booleanValue=false;assert.throws(()=>prepare(f),/STAGING_SOURCE_CHANGED/);});
test('mudanças createTime e updateTime auditados recusam',()=>{
 for(const key of ['createTime','updateTime']){const f=fixture();f.auditedSourceSnapshot.documents[0][key]='2026-10-01T00:00:00.000000001Z';assert.throws(()=>prepare(f));}
});
test('documento auditado ausente, extra ou duplicado recusa',()=>{
 for(const variant of ['missing','extra','duplicate']){const f=fixture();if(variant==='missing')f.auditedSourceSnapshot.documents.pop();else if(variant==='extra')f.auditedSourceSnapshot.documents.push({...clone(f.auditedSourceSnapshot.documents[0]),path:'managementAreas/extra'});else f.auditedSourceSnapshot.documents.push(clone(f.auditedSourceSnapshot.documents[0]));assert.throws(()=>prepare(f));}
});
test('captura auditada incompleta, root alterada ou instante regredido recusa',()=>{
 for(const variant of ['incomplete','root','old']){const f=fixture();if(variant==='incomplete')f.auditedSourceSnapshot.coverage.complete=false;else if(variant==='root')f.auditedSourceSnapshot.coverage.rootCollections.push('contacts');else f.auditedSourceSnapshot.readTime='2026-10-09T01:03:59.999999999Z';assert.throws(()=>prepare(f));}
});
test('digest da captura deve ser SHA256 literal',()=>{for(const sourceCaptureSha256 of ['',null,'A'.repeat(64),'x'.repeat(64)])assert.throws(()=>prepare({...fixture(),sourceCaptureSha256}),/STAGING_CAPTURE_PIN/);});
test('limite de 134 pares recusa 135',()=>{assert.throws(()=>prepare(fixture({copies:135})),/STAGING_PAIR_LIMIT/);});
test('nenhum par de staging vazio é permitido',()=>{assert.throws(()=>prepare(fixture({copies:0})),/STAGING_PAIR_LIMIT/);});
test('COPY de root fora das sete aprovadas recusa até com plano genérico válido',()=>{
 const f=fixture({copies:1,retained:0});f.sourceSnapshot.documents[0].path='activities/task';f.sourceSnapshot.coverage.rootCollections=['activities'];f.destinationSnapshot.coverage.rootCollections=['activities','migrationOrigins'];
 f.manifest.entries[0].path='activities/task';f.auditedSourceSnapshot=clone(f.sourceSnapshot);f.auditedSourceSnapshot.readTime=captureTime;regenerate(f);
 assert.equal(f.plan.readyForReview,true);assert.throws(()=>prepare(f),/STAGING_COPY_ROOT_FORBIDDEN/);
});
test('destination com par já existente recusa staging sem retry',()=>{
 const f=fixture({copies:1}),op=f.plan.operations[0];f.destinationSnapshot.documents=[
 {path:op.path,fields:clone(op.fields),createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z'},
 {path:op.provenancePath,fields:clone(op.provenanceFields),createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z'}];
 f.plan=prepareSplitPlan(f.sourceSnapshot,f.manifest,f.destinationSnapshot);assert.equal(f.plan.counts.identical,1);assert.throws(()=>prepare(f),/STAGING_CREATE_ONLY_REQUIRED/);
});
test('request de commit maior que 4MiB recusa',()=>{
 const f=fixture({copies:1,retained:0});f.sourceSnapshot.documents[0].fields.large=value('x'.repeat(4*1024*1024));f.auditedSourceSnapshot=clone(f.sourceSnapshot);f.auditedSourceSnapshot.readTime=captureTime;regenerate(f);assert.throws(()=>prepare(f),/STAGING_REQUEST_TOO_LARGE/);
});
test('EMPTY confirma todos os caminhos sem retornar documentos',()=>{
 const b=prepare(fixture()),result=validateRead(readInput(b,emptyRows(b)));assert.equal(result.status,'VERIFIED');assert.equal(result.counts.missing,268);assert.equal(result.counts.found,0);assert.equal(Object.hasOwn(result,'rows'),false);assert.equal(Object.hasOwn(result,'documents'),false);
});
test('EMPTY aceita resposta fora de ordem preservando cobertura exata',()=>{
 const b=prepare(fixture());assert.equal(validateRead(readInput(b,emptyRows(b).reverse())).status,'VERIFIED');
});
test('EMPTY rejeita um documento ou par inteiro existentes',()=>{
 const b=prepare(fixture());for(const n of [1,2]){const rows=emptyRows(b),found=identicalRows(b);for(let i=0;i<n;i++)rows[i]=found[i];assert.throws(()=>validateRead(readInput(b,rows)),/STAGING_DESTINATION_NOT_EMPTY/);}
});
test('leitura rejeita quantidade incompleta, extra e duplicata',()=>{
 const b=prepare(fixture());for(const v of ['missing','extra','duplicate']){const rows=emptyRows(b);if(v==='missing')rows.pop();else if(v==='extra')rows.push({missing:base+'managementAreas/extra',readTime});else rows[1]=clone(rows[0]);assert.throws(()=>validateRead(readInput(b,rows)));}
});
test('leitura rejeita nomes de FA ou root fora do lote',()=>{
 const b=prepare(fixture());for(const name of [b.documentNames[0].replace(FB,FA),base+'managementAreas/extra']){const rows=emptyRows(b);rows[0].missing=name;assert.throws(()=>validateRead(readInput(b,rows)),/STAGING_READ_OUTSIDE_BATCH/);}
});
test('leitura rejeita row sem readTime ou com readTime diferente por 1ns',()=>{
 const b=prepare(fixture());for(const time of [undefined,'2026-10-10T00:30:00.123456788Z']){const rows=emptyRows(b);rows[0].readTime=time;assert.throws(()=>validateRead(readInput(b,rows)),/STAGING_READ_TIME_MISMATCH/);}
});
test('readTime futuro ou calendário impossível recusa',()=>{
 const b=prepare(fixture());for(const time of ['2026-10-10T00:30:03.000000001Z','2026-02-30T00:30:00Z']){assert.throws(()=>validateRead({...readInput(b,emptyRows(b,time)),readTime:time}));}
});
test('row ambígua found+missing ou sem ambos recusa',()=>{
 const b=prepare(fixture());for(const variant of ['both','neither']){const rows=emptyRows(b);if(variant==='both')rows[0].found=identicalRows(b)[0].found;else delete rows[0].missing;assert.throws(()=>validateRead(readInput(b,rows)),/STAGING_READ_ROW_INVALID/);}
});
test('IDENTICAL valida ambos os hashes e retorna agregado',()=>{
 const b=prepare(fixture()),result=validateRead(readInput(b,identicalRows(b),'IDENTICAL'));assert.equal(result.status,'VERIFIED');assert.equal(result.counts.found,268);assert.equal(result.counts.missing,0);assert.equal(result.counts.pairs,134);
});
test('IDENTICAL rejeita mudança em conteúdo e em provenance',()=>{
 const b=prepare(fixture());for(const i of [0,1]){const rows=identicalRows(b);rows[i].found.fields.injected=value('Outro');assert.throws(()=>validateRead(readInput(b,rows,'IDENTICAL')),/STAGING_FIELDS_MISMATCH/);}
});
test('IDENTICAL rejeita documento ou provenance ausentes',()=>{
 const b=prepare(fixture());for(const i of [0,1]){const rows=identicalRows(b);rows[i]=emptyRows(b)[i];assert.throws(()=>validateRead(readInput(b,rows,'IDENTICAL')),/STAGING_PAIR_NOT_COMPLETE/);}
});
test('found requer valores tipados e create/update válidos',()=>{
 const b=prepare(fixture());for(const kind of ['type','create','update','order','future']){const rows=identicalRows(b),d=rows[0].found;if(kind==='type')d.fields.title={booleanValue:'true'};else if(kind==='create')d.createTime='2026-02-30T00:00:00Z';else if(kind==='update')delete d.updateTime;else if(kind==='order')d.createTime='2026-10-10T00:30:00Z';else d.updateTime='2026-10-10T00:30:00.123456790Z';assert.throws(()=>validateRead(readInput(b,rows,'IDENTICAL')));}
});
test('batch mutado recusa leituras e commit',()=>{
 const b=prepare(fixture());b.documentNames[0]=base+'users/bad';assert.throws(()=>validateRead(readInput(b,emptyRows(b))));assert.throws(()=>validateCommit({batch:b,response:commit(b),nowMs}));
});
test('expectation desconhecida recusa',()=>{const b=prepare(fixture());assert.throws(()=>validateRead(readInput(b,emptyRows(b),'OTHER')),/STAGING_READ_EXPECTATION/);});
test('commit REST verifica 268 resultados indexados, timestamp e atomicidade',()=>{
 const b=prepare(fixture()),r=validateCommit({batch:b,response:commit(b),nowMs});assert.equal(r.status,'VERIFIED');assert.equal(r.atomic,true);assert.equal(r.writeResults,268);assert.equal(r.pairs,134);assert.equal(r.commitTime,'2026-10-10T00:30:01.123456789Z');assert.equal(Object.hasOwn(r,'documents'),false);
});
test('commit incompleto ou extra recusa',()=>{
 const b=prepare(fixture());for(const delta of [-1,1]){const r=commit(b);if(delta<0)r.writeResults.pop();else r.writeResults.push(clone(r.writeResults[0]));assert.throws(()=>validateCommit({batch:b,response:r,nowMs}),/STAGING_COMMIT_RESULTS/);}
});
test('commit exige resultado updateTime de cada create',()=>{
 const b=prepare(fixture());for(const time of [undefined,'2026-02-30T00:00:00Z','2026-10-10T00:30:01.123456790Z']){const r=commit(b);r.writeResults[0].updateTime=time;assert.throws(()=>validateCommit({batch:b,response:r,nowMs}));}
});
test('commitTime futuro por 1ns, antigo ou inválido recusa',()=>{
 const b=prepare(fixture());for(const time of ['2026-10-10T00:30:03.000000001Z','2026-10-10T00:20:00Z','no-time'])assert.throws(()=>validateCommit({batch:b,response:commit(b,time),nowMs}));
});
test('resultado com name/path/index incompatíveis recusa',()=>{
 const b=prepare(fixture());for(const bad of [{name:base+'users/other'},{path:'users/other'},{index:1}]){const r=commit(b);Object.assign(r.writeResults[0],bad);assert.throws(()=>validateCommit({batch:b,response:r,nowMs}),/STAGING_COMMIT_INDEX/);}
});
test('resultado com transforms ou falha declarada recusa',()=>{
 const b=prepare(fixture());const r=commit(b);r.writeResults[0].transformResults=[value('bad')];assert.throws(()=>validateCommit({batch:b,response:r,nowMs}));
 const failed={...commit(b),error:{code:403}};assert.throws(()=>validateCommit({batch:b,response:failed,nowMs}));
});


test('readTime equivalente com seis e três casas é aceito sem perder nanosegundos',()=>{
 const b=prepare(fixture()),requested='2026-10-10T00:30:00.123000Z',returned='2026-10-10T00:30:00.123Z';
 const result=validateRead({...readInput(b,emptyRows(b,returned)),readTime:requested});
 assert.equal(result.status,'VERIFIED');assert.equal(result.readTime,requested);
});
