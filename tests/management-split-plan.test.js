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
