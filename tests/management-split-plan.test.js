import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotDigest,documentDigest,validateSplitSnapshot,prepareSplitPlan} from '../scripts/lib/management-split-plan.js';

const sourceProjectId='sahmt-17a16', destinationProjectId='demo-gestao-split';
const time='2026-10-08T12:00:00Z';
const value=stringValue=>({stringValue});
const doc=(path,fields={})=>({path,fields,createTime:time,updateTime:time});
function inputs(documents=[doc('managementAreas/area-demo',{id:value('area-demo')})]) {
  const snapshot={schemaVersion:1,projectId:sourceProjectId,databaseId:'(default)',readTime:time,coverage:{complete:true,consistent:true,rootCollections:[...new Set(documents.map(row=>row.path.split('/')[0]))]},documents};
  const manifest={schemaVersion:1,sourceProjectId,destinationProjectId,sourceDatabaseId:'(default)',destinationDatabaseId:'(default)',backupSha256:snapshotDigest(snapshot),identityMappings:[{memberId:'member-demo',faUid:'uid-demo',fbUid:'uid-demo'}],entries:documents.map(row=>({path:row.path,action:'COPY',reason:'Gestão verificada na seleção',scope:'GESTAO',evidence:'RELATION_VERIFIED',sourceSha256:documentDigest(row),dependencies:[]}))};
  return {snapshot,manifest};
}
const prepare=({snapshot,manifest},destination)=>prepareSplitPlan(snapshot,manifest,destination===undefined?{...structuredClone(snapshot),projectId:manifest.destinationProjectId,coverage:{...snapshot.coverage,rootCollections:[...snapshot.coverage.rootCollections,'migrationOrigins']},documents:[]}:destination);
function changedSnapshot(input,change) { change(input.snapshot); input.manifest.backupSha256=snapshotDigest(input.snapshot); input.snapshot.documents.forEach(row=>{const entry=input.manifest.entries.find(entry=>entry.path===row.path);if(entry)entry.sourceSha256=documentDigest(row);}); return input; }

test('simulação determinística preserva dados tipados, IDs, autoria e datas',()=>{
  const input=inputs([doc('activities/task-demo',{uid:value('uid-demo'),createdAt:{timestampValue:'2026-10-08T10:00:00.123456789Z'},count:{integerValue:'9223372036854775807'},details:{mapValue:{fields:{answers:{arrayValue:{values:[{nullValue:null},{booleanValue:true}]}}}}}})]);
  const plan=prepare(input);
  assert.equal(plan.mode,'OFFLINE_DRY_RUN');assert.equal(plan.productionAuthorized,false);assert.equal(plan.readyForReview,true);
  assert.deepEqual(plan.operations[0].fields,input.snapshot.documents[0].fields);assert.deepEqual(plan.operations[0].precondition,{exists:false});
  assert.equal(plan.operations[0].provenance.originalCreateTime,time);assert.equal(plan.operations[0].provenance.sourcePath,'activities/task-demo');
  assert.deepEqual(prepare(input),plan);assert.equal(plan.rollback.sourceChanged,false);assert.equal(plan.rollback.deleteSource,false);
});
test('backup alterado e hash de documento divergente são rejeitados',()=>{
  const input=inputs();input.snapshot.documents[0].fields.extra=value('alterado');assert.throws(()=>prepare(input),/BACKUP_HASH_MISMATCH/);
  input.manifest.backupSha256=snapshotDigest(input.snapshot);assert.throws(()=>prepare(input),/DOCUMENT_HASH_MISMATCH/);
});
test('backup parcial ou inconsistente não pode ser tratado como completo',()=>{
  for(const key of ['complete','consistent']) {const input=inputs();input.snapshot.coverage[key]=false;assert.throws(()=>prepare(input),/INCOMPLETE_SNAPSHOT/);}
});

test('datas impossíveis são rejeitadas e nanos mantêm a ordem de captura',()=>{
  for (const readTime of ['2026-02-30T12:00:00Z','2025-02-29T12:00:00Z','2026-10-08T24:00:00Z','0000-01-01T00:00:00Z']) {
    const input=inputs();input.snapshot.readTime=readTime;
    assert.throws(()=>validateSplitSnapshot(input.snapshot),/INVALID_SNAPSHOT_HEADER/);
  }
  const future=inputs();future.snapshot.readTime='2026-10-08T12:00:00.123456788Z';future.snapshot.documents[0].updateTime='2026-10-08T12:00:00.123456789Z';
  assert.throws(()=>validateSplitSnapshot(future.snapshot),/INVALID_DOCUMENT_TIMES/);
  const reversed=inputs();reversed.snapshot.documents[0].createTime='2026-10-08T11:00:00.123456789Z';reversed.snapshot.documents[0].updateTime='2026-10-08T11:00:00.123456788Z';
  assert.throws(()=>validateSplitSnapshot(reversed.snapshot),/INVALID_DOCUMENT_TIMES/);
  const leap=inputs();for(const row of leap.snapshot.documents){row.createTime='2024-02-29T12:00:00.123456789Z';row.updateTime=row.createTime;}leap.snapshot.readTime='2024-02-29T12:00:00.123456789Z';
  assert.equal(validateSplitSnapshot(leap.snapshot),leap.snapshot);
  const field=inputs();field.snapshot.documents[0].fields.invalid={timestampValue:'2026-02-30T12:00:00Z'};
  assert.throws(()=>validateSplitSnapshot(field.snapshot),/INVALID_TIMESTAMP/);
});
test('cada documento exige classificação e caminhos únicos sem curinga',()=>{
  const input=inputs();input.manifest.entries=[];assert.throws(()=>prepare(input),/CLASSIFICATION_INCOMPLETE/);
  const bad=changedSnapshot(inputs(),snapshot=>snapshot.documents[0].path='managementAreas/*');assert.throws(()=>prepare(bad),/INVALID_OR_DUPLICATE_DOCUMENT_PATH/);
});
test('dados operacionais e de Auth ficam em FA',()=>{
  for(const collection of ['users','checklists','appConfig','documentAccessEmails','evaluationChecklistTransfers']) {
    const input=inputs([doc(`${collection}/demo`)]);assert.throws(()=>prepare(input),/OPERATIONAL_OR_AUTH_COPY_FORBIDDEN/);
    input.manifest.entries[0].action='KEEP_FA';assert.equal(prepare(input).counts.keepFa,1);
  }
});
test('runtime e totais derivados exigem reconstrução ou retenção',()=>{
  const input=inputs([doc('evaluationRuntime/main')]);assert.throws(()=>prepare(input),/DERIVED_STATE_COPY_FORBIDDEN/);
  input.manifest.entries[0].action='REBUILD';assert.equal(prepare(input).counts.rebuild,1);
});
test('coleção mista não migra por nome e score legado exige origem Gestão',()=>{
  const input=inputs([doc('scores/score-demo',{sourceType:value('CHECKLIST_CONFIRMATION')})]);
  delete input.manifest.entries[0].evidence;assert.throws(()=>prepare(input),/MIXED_DOCUMENT_NOT_PROVEN/);
  input.manifest.entries[0].evidence='RELATION_VERIFIED';assert.throws(()=>prepare(input),/LEGACY_SCORE_NOT_MANAGEMENT/);
});
test('UIDs desconhecidos e remapeamento não validado são bloqueados',()=>{
  const input=inputs([doc('activities/task-demo',{uid:value('missing')})]);assert.throws(()=>prepare(input),/UID_NOT_MAPPED/);
  const remapped=inputs();remapped.manifest.identityMappings[0].fbUid='new-uid';assert.throws(()=>prepare(remapped),/UID_REMAP_REQUIRES_REVIEWED_ADAPTER/);
});
test('mapa UID membro impede colisões e não aceita email como chave implícita',()=>{
  const input=inputs();input.manifest.identityMappings.push({...input.manifest.identityMappings[0]});assert.throws(()=>prepare(input),/IDENTITY_MAPPING_COLLISION/);
  const withEmail=inputs();withEmail.manifest.identityMappings[0].email='member@example.invalid';assert.throws(()=>prepare(withEmail),/INVALID_IDENTITY_MAPPING/);
});
test('referências entre documentos selecionados apontam para FB',()=>{
  const reference=`projects/${sourceProjectId}/databases/(default)/documents/managementAreas/area-demo`;
  const input=inputs([doc('managementAreas/area-demo'),doc('activities/task-demo',{area:{referenceValue:reference}})]);
  input.manifest.entries[1].dependencies=['managementAreas/area-demo'];
  const plan=prepare(input), task=plan.operations.find(row=>row.path==='activities/task-demo');
  assert.equal(task.fields.area.referenceValue,reference.replace(sourceProjectId,destinationProjectId));assert.equal(plan.blockers.length,0);
});
test('dependência retida e referência fora da seleção bloqueiam revisão pronta',()=>{
  const reference=`projects/${sourceProjectId}/databases/(default)/documents/users/uid-demo`;
  const input=inputs([doc('users/uid-demo'),doc('activities/task-demo',{author:{referenceValue:reference}})]);
  input.manifest.entries[0].action='KEEP_FA';input.manifest.entries[1].dependencies=['users/uid-demo'];
  const plan=prepare(input);assert.equal(plan.readyForReview,false);assert.ok(plan.blockers.some(item=>item.code==='REFERENCE_NEEDS_PROJECTION_OR_ADAPTER'));assert.ok(plan.blockers.some(item=>item.code==='DEPENDENCY_NEEDS_PROJECTION_OR_ADAPTER'));
  assert.equal(plan.operations[0].fields.author.referenceValue,reference);
});
test('Checklist não é duplicado em FB e ledger exige seu award migrado',()=>{
  const checklist=inputs([doc('evaluationAwards/award-demo',{modality:value('CHECKLIST')})]);assert.throws(()=>prepare(checklist),/UNREVIEWED_OR_CHECKLIST_CREDIT_COPY_FORBIDDEN/);
  const ledger=inputs([doc('evaluationLedger/ledger-demo',{awardId:value('award-demo')})]);assert.throws(()=>prepare(ledger),/LEDGER_AWARD_DEPENDENCY_REQUIRED/);
  const input=inputs([doc('evaluationAwards/award-demo',{modality:value('ACK'),uid:value('uid-demo'),areaId:value('area-demo')}),doc('evaluationLedger/ledger-demo',{awardId:value('award-demo'),uid:value('uid-demo')}),doc('managementAreas/area-demo')]);
  input.manifest.entries[1].dependencies=['evaluationAwards/award-demo'];assert.equal(prepare(input).counts.copy,3);assert.equal(prepare(input).readyForReview,true);
});
test('reexecução identifica cópia idêntica sem gerar outra operação de escrita',()=>{
  const input=inputs(), first=prepare(input);
  const operation=first.operations[0];
  const destination={...structuredClone(input.snapshot),projectId:destinationProjectId,coverage:{...input.snapshot.coverage,rootCollections:['managementAreas','migrationOrigins']},documents:[doc(operation.path,operation.fields),doc(operation.provenancePath,operation.provenanceFields)]};
  const repeated=prepare(input,destination);assert.equal(repeated.operations[0].result,'ALREADY_IDENTICAL');assert.equal(repeated.counts.identical,1);assert.equal(repeated.readyForReview,true);
  assert.equal(repeated.operations[0].operation,'SKIP');assert.equal(repeated.operations[0].writeRequired,false);
});
test('conteúdo diferente no destino exige revisão e nunca propõe overwrite',()=>{
  const input=inputs(), destination={...structuredClone(input.snapshot),projectId:destinationProjectId};destination.coverage.rootCollections.push('migrationOrigins');destination.documents[0].fields.id=value('outro');
  const plan=prepare(input,destination);assert.equal(plan.counts.conflicts,1);assert.equal(plan.readyForReview,false);assert.deepEqual(plan.operations[0].precondition,{exists:false});
});
test('autoria Uid e listas Uids são validadas recursivamente em mapas e arrays',()=>{
  for(const fields of [{createdByUid:value('unknown')},{approvedByUid:value('unknown')},{responsibleUids:{arrayValue:{values:[value('unknown')]}}},{participants:{arrayValue:{values:[{mapValue:{fields:{participantUid:value('unknown')}}}]}}}]) {
    assert.throws(()=>prepare(inputs([doc('activities/task-demo',fields)])),/UID_NOT_MAPPED/);
  }
});
test('classificação literal sem vínculo real não prova origem Gestão',()=>{
  const plan=prepare(inputs([doc('learningActivities/learning-demo')]));
  assert.equal(plan.readyForReview,false);assert.ok(plan.blockers.some(item=>item.code==='MIXED_RELATION_NOT_DEMONSTRATED'));
});
test('dependência areaId string é descoberta mesmo se omitida no manifesto',()=>{
  const input=inputs([doc('activities/task-demo',{managementAreaId:value('area-demo')}),doc('managementAreas/area-demo')]);input.manifest.entries[1].action='KEEP_FA';
  const plan=prepare(input);assert.equal(plan.readyForReview,false);assert.ok(plan.blockers.some(item=>item.code==='STRING_RELATION_NEEDS_BACKUP_OR_PROJECTION'));
});
test('snapshot destino precisa cobrir coleções alvo e proveniência',()=>{
  const input=inputs(),destination={...structuredClone(input.snapshot),projectId:destinationProjectId,coverage:{complete:true,consistent:true,rootCollections:['users']},documents:[]};
  assert.throws(()=>prepare(input,destination),/DESTINATION_COVERAGE_INCOMPLETE/);
});
test('registro idêntico no destino sem proveniência não vira cópia confirmada',()=>{
  const input=inputs(),destination={...structuredClone(input.snapshot),projectId:destinationProjectId};destination.coverage.rootCollections.push('migrationOrigins');
  const plan=prepare(input,destination);assert.equal(plan.readyForReview,false);assert.equal(plan.operations[0].result,'IDENTICAL_WITHOUT_VERIFIED_PROVENANCE');assert.equal(plan.operations[0].writeRequired,false);
});
test('sidecar divergente e sidecar órfão exigem revisão',()=>{
  const input=inputs(),operation=prepare(input).operations[0];
  const destination={...structuredClone(input.snapshot),projectId:destinationProjectId,coverage:{...input.snapshot.coverage,rootCollections:['managementAreas','migrationOrigins']},documents:[doc(operation.path,operation.fields),doc(operation.provenancePath,{...operation.provenanceFields,sourcePath:value('managementAreas/other')})]};
  assert.equal(prepare(input,destination).readyForReview,false);
  destination.documents=[doc(operation.provenancePath,operation.provenanceFields)];const orphan=prepare(input,destination);assert.ok(orphan.blockers.some(item=>item.code==='ORPHAN_DESTINATION_PROVENANCE'));
});
test('projeto destino igual a FA ou snapshot destino de outro projeto é rejeitado',()=>{
  const input=inputs();input.manifest.destinationProjectId=sourceProjectId;assert.throws(()=>prepare(input),/DESTINATION_PROJECT_INVALID/);
  const clean=inputs(), wrong={...structuredClone(clean.snapshot),projectId:'demo-other-project'};assert.throws(()=>prepare(clean,wrong),/DESTINATION_SNAPSHOT_MISMATCH/);
});
test('tipos Firestore inválidos e datas posteriores ao snapshot são rejeitados',()=>{
  const input=inputs([doc('activities/task-demo',{points:{integerValue:2}})]);assert.throws(()=>validateSplitSnapshot(input.snapshot),/INVALID_INTEGER/);
  input.snapshot.documents[0].fields={};input.snapshot.documents[0].updateTime='2026-10-09T12:00:00Z';assert.throws(()=>validateSplitSnapshot(input.snapshot),/INVALID_DOCUMENT_TIMES/);
});
test('sem captura do destino o plano nunca fica pronto para revisão da cópia',()=>{
  const input=inputs(),plan=prepare(input,null);assert.equal(plan.readyForReview,false);assert.equal(plan.destinationVerified,false);assert.ok(plan.blockers.some(item=>item.code==='DESTINATION_SNAPSHOT_REQUIRED'));
});

function historicalInput(path='documents/document-demo', fields={createdByUid:value('uid-archived-demo')}) {
  return inputs([doc(path,fields)]);
}
function attributionFor(input, field='createdByUid', path=input.snapshot.documents[0].path) {
  const row=input.snapshot.documents.find(row=>row.path===path), sourceUid=row.fields[field].stringValue;
  return {path,sourceSha256:documentDigest(row),field,sourceUid,actor:{sourceProjectId,sourceUid,status:'ARCHIVED_UNRESOLVED',active:false,access:false,memberId:null}};
}
function withHistorical(input=historicalInput(), field='createdByUid') {
  input.manifest.historicalAttributions=[attributionFor(input,field)];
  return input;
}

test('autoria histórica preserva UID original sem criar vínculo de membro nem alterar snapshot',()=>{
  const input=withHistorical(), original=structuredClone(input), plan=prepare(input);
  assert.equal(plan.readyForReview,true);assert.equal(plan.productionAuthorized,false);assert.equal(plan.counts.copy,1);
  assert.deepEqual(input,original);assert.deepEqual(plan.operations[0].fields,input.snapshot.documents[0].fields);
  assert.equal(plan.operations[0].fields.createdByUid.stringValue,'uid-archived-demo');
  assert.equal(plan.operations[0].provenance.sourceSha256,documentDigest(input.snapshot.documents[0]));
  assert.equal(plan.manifestSha256,snapshotDigest(input.manifest));assert.equal(input.manifest.identityMappings.length,1);
  assert.equal(plan.operations.some(row=>['users','eventMembers','managementAuthorizationLeases'].includes(row.path.split('/')[0])),false);
  assert.deepEqual(prepare(input),plan);
});
test('exceções distintas cobrem createdByUid e updatedByUid nas duas coleções de documentos',()=>{
  const input=inputs([doc('documents/document-demo',{createdByUid:value('uid-archived-demo'),updatedByUid:value('uid-archived-demo')}),doc('scopedDocuments/document-demo',{createdByUid:value('uid-archived-demo'),updatedByUid:value('uid-demo')})]);
  input.manifest.historicalAttributions=[attributionFor(input,'createdByUid','documents/document-demo'),attributionFor(input,'updatedByUid','documents/document-demo'),attributionFor(input,'createdByUid','scopedDocuments/document-demo')];
  const plan=prepare(input);assert.equal(plan.readyForReview,true);assert.equal(plan.counts.copy,2);
  for(const operation of plan.operations) assert.deepEqual(operation.fields,input.snapshot.documents.find(row=>row.path===operation.path).fields);
});
test('manifesto legado ausente ou lista vazia mantém bloqueio de UID não mapeado',()=>{
  assert.equal(prepare(inputs()).readyForReview,true);
  const mapped=historicalInput('documents/document-demo',{createdByUid:value('uid-demo')});assert.equal(prepare(mapped).readyForReview,true);
  const empty=inputs();empty.manifest.historicalAttributions=[];assert.equal(prepare(empty).readyForReview,true);
  const unmapped=historicalInput();unmapped.manifest.historicalAttributions=[];assert.throws(()=>prepare(unmapped),/UID_NOT_MAPPED/);
  assert.throws(()=>prepare(historicalInput()),/UID_NOT_MAPPED/);
});
test('campo opcional historicalAttributions presente exige array válido',()=>{
  for(const data of [null,undefined,{},true,'archive']) {
    const input=inputs();input.manifest.historicalAttributions=data;assert.throws(()=>prepare(input),/INVALID_HISTORICAL_ATTRIBUTIONS/);
  }
});
test('autoria histórica recusa registro com chave extra, ausente, símbolo ou objeto impróprio',()=>{
  const changes=[row=>row.email='never@example.invalid',row=>delete row.field,row=>row[Symbol('extra')]=true,row=>Object.setPrototypeOf(row,{inherited:true}),row=>Object.defineProperty(row,'field',{enumerable:false}),row=>Object.defineProperty(row,'field',{enumerable:true,get(){throw new Error('GETTER_MUST_NOT_RUN');}})];
  for(const change of changes) {const input=withHistorical();change(input.manifest.historicalAttributions[0]);assert.throws(()=>prepare(input),/INVALID_HISTORICAL_ATTRIBUTION/);}
  for(const row of [null,[],true,'archive']) {const input=withHistorical();input.manifest.historicalAttributions=[row];assert.throws(()=>prepare(input),/INVALID_HISTORICAL_ATTRIBUTION/);}
});
test('ator arquivado exige esquema exato, origem FA e acesso e atividade falsos',()=>{
  const changes=[actor=>actor.active=true,actor=>actor.active=0,actor=>actor.access=true,actor=>actor.access='false',actor=>actor.memberId='member-demo',actor=>delete actor.memberId,actor=>actor.status='ACTIVE',actor=>actor.sourceProjectId=destinationProjectId,actor=>actor.sourceUid='uid-other-demo',actor=>actor.fbUid='uid-archived-demo',actor=>actor[Symbol('extra')]=true,actor=>Object.defineProperty(actor,'active',{enumerable:false}),actor=>Object.defineProperty(actor,'active',{enumerable:true,get(){throw new Error('GETTER_MUST_NOT_RUN');}})];
  for(const change of changes) {const input=withHistorical();change(input.manifest.historicalAttributions[0].actor);assert.throws(()=>prepare(input),/INVALID_HISTORICAL_ARCHIVED_ACTOR/);}
  for(const actor of [null,[],true]) {const input=withHistorical();input.manifest.historicalAttributions[0].actor=actor;assert.throws(()=>prepare(input),/INVALID_HISTORICAL_ARCHIVED_ACTOR/);}
});
test('autoria histórica recusa UID vazio, inválido ou superior ao limite',()=>{
  for(const sourceUid of ['',null,'with space','with/slash','with\u0000control','x'.repeat(201)]) {
    const input=withHistorical();input.manifest.historicalAttributions[0].sourceUid=sourceUid;assert.throws(()=>prepare(input),/INVALID_HISTORICAL_ATTRIBUTION_UID/);
  }
});
test('UID já mapeado não pode também virar ator histórico sem acesso',()=>{
  const input=withHistorical(historicalInput('documents/document-demo',{createdByUid:value('uid-demo')}));
  assert.throws(()=>prepare(input),/HISTORICAL_ATTRIBUTION_ALREADY_MAPPED/);
});
test('cada par de caminho e campo histórico é único',()=>{
  const input=withHistorical();input.manifest.historicalAttributions.push(structuredClone(input.manifest.historicalAttributions[0]));
  assert.throws(()=>prepare(input),/DUPLICATE_HISTORICAL_ATTRIBUTION/);
});
test('hash histórico continua pinado ao documento completo original',()=>{
  const input=withHistorical();input.manifest.historicalAttributions[0].sourceSha256='0'.repeat(64);assert.throws(()=>prepare(input),/HISTORICAL_ATTRIBUTION_HASH_MISMATCH/);
  const changed=withHistorical();changedSnapshot(changed,snapshot=>snapshot.documents[0].fields.title=value('changed title'));
  assert.throws(()=>prepare(changed),/HISTORICAL_ATTRIBUTION_HASH_MISMATCH/);
});
test('UID histórico e campo precisam existir com valor string exato na origem',()=>{
  const wrongUid=withHistorical();wrongUid.manifest.historicalAttributions[0].sourceUid='uid-other-demo';wrongUid.manifest.historicalAttributions[0].actor.sourceUid='uid-other-demo';
  assert.throws(()=>prepare(wrongUid),/HISTORICAL_ATTRIBUTION_FIELD_MISMATCH/);
  const missing=withHistorical();missing.manifest.historicalAttributions[0].field='updatedByUid';assert.throws(()=>prepare(missing),/HISTORICAL_ATTRIBUTION_FIELD_MISMATCH/);
  const type=withHistorical();changedSnapshot(type,snapshot=>snapshot.documents[0].fields.createdByUid={booleanValue:false});type.manifest.historicalAttributions[0].sourceSha256=documentDigest(type.snapshot.documents[0]);
  assert.throws(()=>prepare(type),/HISTORICAL_ATTRIBUTION_FIELD_MISMATCH/);
});
test('exceção histórica proíbe gestores, participantes, responsáveis, benefícios e aliases de autoria',()=>{
  for(const field of ['uid','beneficiaryUid','managerUid','responsibleUid','approvedByUid','participantUid','createdBy','updatedBy','responsibleUids','details.createdByUid']) {
    const input=withHistorical();input.manifest.historicalAttributions[0].field=field;assert.throws(()=>prepare(input),/HISTORICAL_ATTRIBUTION_FIELD_FORBIDDEN/);
  }
});
test('caminho histórico exige documento raiz existente em documents ou scopedDocuments',()=>{
  for(const path of ['documents/absent-demo','activities/task-demo','documents/document-demo/history/event-demo','scopedDocuments/document-demo/history/event-demo','documents/*']) {
    const input=withHistorical();input.manifest.historicalAttributions[0].path=path;assert.throws(()=>prepare(input),/HISTORICAL_ATTRIBUTION_PATH_MISMATCH/);
  }
  const nested=withHistorical(historicalInput('documents/document-demo/history/event-demo'));assert.throws(()=>prepare(nested),/HISTORICAL_ATTRIBUTION_PATH_MISMATCH/);
  const wrongCollection=withHistorical(historicalInput('activities/task-demo'));assert.throws(()=>prepare(wrongCollection),/HISTORICAL_ATTRIBUTION_PATH_MISMATCH/);
});
test('exceção em documento KEEP_FA não consumido bloqueia o manifesto',()=>{
  const input=withHistorical();input.manifest.entries[0].action='KEEP_FA';assert.throws(()=>prepare(input),/HISTORICAL_ATTRIBUTION_UNCONSUMED/);
});
test('mesmo UID arquivado em função corrente continua exigindo identityMapping',()=>{
  for(const field of ['uid','beneficiaryUid','managerUid','responsibleUid','approvedByUid','participantUid','createdBy','updatedBy']) {
    const input=withHistorical(historicalInput('documents/document-demo',{createdByUid:value('uid-archived-demo'),[field]:value('uid-archived-demo')}));
    assert.throws(()=>prepare(input),/UID_NOT_MAPPED/);
  }
  const array=withHistorical(historicalInput('documents/document-demo',{createdByUid:value('uid-archived-demo'),responsibleUids:{arrayValue:{values:[value('uid-archived-demo')]}}}));
  assert.throws(()=>prepare(array),/UID_NOT_MAPPED/);
});
test('exceção top-level não libera autoria homônima aninhada nem em arrays',()=>{
  for(const details of [{mapValue:{fields:{createdByUid:value('uid-archived-demo')}}},{arrayValue:{values:[{mapValue:{fields:{createdByUid:value('uid-archived-demo')}}}]}}]) {
    const input=withHistorical(historicalInput('documents/document-demo',{createdByUid:value('uid-archived-demo'),details}));assert.throws(()=>prepare(input),/UID_NOT_MAPPED/);
  }
});
test('outro autor não mapeado ou outra ocorrência sem exceção explícita continuam bloqueados',()=>{
  const input=withHistorical(historicalInput('documents/document-demo',{createdByUid:value('uid-archived-demo'),updatedByUid:value('uid-other-demo')}));assert.throws(()=>prepare(input),/UID_NOT_MAPPED/);
  const second=inputs([doc('documents/document-demo',{createdByUid:value('uid-archived-demo')}),doc('scopedDocuments/second-demo',{createdByUid:value('uid-archived-demo')})]);
  second.manifest.historicalAttributions=[attributionFor(second)];assert.throws(()=>prepare(second),/UID_NOT_MAPPED/);
});
test('reexecução de documento histórico idêntico ainda exige proveniência sem novo crédito ou identidade',()=>{
  const input=withHistorical(), operation=prepare(input).operations[0];
  const destination={...structuredClone(input.snapshot),projectId:destinationProjectId,coverage:{...input.snapshot.coverage,rootCollections:['documents','migrationOrigins']},documents:[doc(operation.path,operation.fields),doc(operation.provenancePath,operation.provenanceFields)]};
  const repeated=prepare(input,destination);assert.equal(repeated.readyForReview,true);assert.equal(repeated.operations[0].result,'ALREADY_IDENTICAL');
  assert.equal(repeated.operations[0].writeRequired,false);assert.equal(repeated.operations.length,1);assert.equal(repeated.counts.identical,1);
});

for(const [label,payload] of [
  ['top-level',{mapValue:{}}],
  ['mapa aninhado',{mapValue:{fields:{details:{mapValue:{}}}}}],
  ['array aninhado',{arrayValue:{values:[{mapValue:{}},{mapValue:{fields:{details:{mapValue:{}}}}}]}}]
])test('relações aceitam mapValue vazio válido em '+label+' sem alterar campos',()=>{
  const input=inputs([doc('managementAreas/area-demo',{payload})]), before=structuredClone(input);
  assert.equal(validateSplitSnapshot(input.snapshot),input.snapshot);
  const plan=prepare(input);assert.equal(plan.readyForReview,true);assert.equal(plan.counts.copy,1);assert.equal(plan.blockers.length,0);
  assert.deepEqual(plan.operations[0].fields,input.snapshot.documents[0].fields);assert.deepEqual(input,before);
});
