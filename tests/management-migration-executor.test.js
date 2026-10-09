import test from 'node:test';
import {createHash} from 'node:crypto';
import {createFbMigrationDestinationBudget, assessFbMigrationDestinationBudget, acknowledgeFbMigrationDestinationReservation, pauseFbMigrationDestinationBudget} from '../scripts/lib/management-migration-destination-budget.js';
import assert from 'node:assert/strict';
import {prepareSplitPlan, snapshotDigest, documentDigest} from '../scripts/lib/management-split-plan.js';
import {firestoreQuotaDayStart} from '../scripts/lib/management-read-budget.js';
import {executeManagementMigration, validateManagementMigrationExecution} from '../scripts/lib/management-migration-executor.js';

const FA='sahmt-17a16', FB='sahmt-gestao-5ae66';
const TIME='2026-10-08T12:00:00.000Z', SOURCE_TIME='2026-10-08T11:59:00.000Z';
const value=stringValue=>({stringValue});
const document=(path,fields={},time=SOURCE_TIME)=>({path,fields,createTime:time,updateTime:time});
const copy=value=>structuredClone(value);

function harness(documents=[document('managementAreas/area-demo',{name:value('Área demonstração')})], destinationDocuments=[], actions={}) {
  let current=Date.parse(TIME), reservations=0, paused=false;
  const roots=[...new Set(documents.map(row=>row.path.split('/')[0]))];
  const sourceSnapshot={schemaVersion:1,projectId:FA,databaseId:'(default)',readTime:SOURCE_TIME,coverage:{complete:true,consistent:true,rootCollections:roots},documents};
  const manifest={schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,sourceDatabaseId:'(default)',destinationDatabaseId:'(default)',backupSha256:snapshotDigest(sourceSnapshot),identityMappings:[{memberId:'member-demo',faUid:'uid-demo',fbUid:'uid-demo'}],entries:documents.map(row=>({path:row.path,action:actions[row.path]||'COPY',reason:'Gestão confirmada no manifesto',scope:'GESTAO',evidence:'RELATION_VERIFIED',sourceSha256:documentDigest(row),dependencies:[]}))};
  const destinationSnapshot={schemaVersion:1,projectId:FB,databaseId:'(default)',readTime:TIME,coverage:{complete:true,consistent:true,rootCollections:[...roots,'migrationOrigins']},documents:copy(destinationDocuments)};
  const plan=prepareSplitPlan(sourceSnapshot,manifest,destinationSnapshot);
  const pins={planSha256:plan.planSha256,sourceSnapshotSha256:snapshotDigest(sourceSnapshot),manifestSha256:snapshotDigest(manifest),destinationSnapshotSha256:snapshotDigest(destinationSnapshot),aclSha256:'a'.repeat(64),identitySha256:snapshotDigest(manifest.identityMappings)};
  const approval={schemaVersion:1,authorized:true,purpose:'MANAGEMENT_MIGRATION_CREATE_ONLY',requestId:'synthetic-request',sourceProjectId:FA,destinationProjectId:FB,databaseId:'(default)',approvedAt:TIME,expiresAt:'2026-10-08T12:10:00.000Z',pins};
  const live=new Map(destinationDocuments.map(row=>[row.path,copy(row)]));
  const calls={read:[],commit:[],budget:[],context:[],checkpoint:[],pause:[]};
  const now=()=>current;
  const iso=()=>new Date(current).toISOString();
  const context=()=>({schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,databaseId:'(default)',verifiedAt:iso(),expiresAt:new Date(current+300000).toISOString(),pins:copy(pins),manifestVerified:true,aclVerified:true,identityVerified:true,sourceSnapshotVerified:true,destinationSnapshotVerified:true,sourceStillMatchesBackup:true,destinationWriterState:'STOPPED',destinationClientAccess:'DISABLED',destinationNativeTriggersAbsent:true,firestoreReadsIssued:0});
  const budget=payload=>({
    schemaVersion:1,projectId:FB,authorizedPurpose:'MANAGEMENT_MIGRATION_CREATE_ONLY',allowed:true,
    pausedRequiresReview:paused,renewalClearsPause:false,dailyReadLimit:35000,quotaTimeZone:'America/Los_Angeles',
    quotaDayStart:firestoreQuotaDayStart(current),reservationQuotaDayStart:firestoreQuotaDayStart(current),humanDecisionAt:TIME,
    metric:'firestore.googleapis.com/document/read_ops_count',complete:true,fresh:true,verifiedAt:iso(),latestPoint:iso(),
    reads:100,reservedReads:++reservations*2,appTrafficReserve:5000,metricLagReserve:2000,maximumReads:payload.maximumReads,
    reservationId:'reservation-'+reservations,localReservationOnly:true,exactGlobalCutoff:false
  });
  const adapters={
    async freshContext(payload){calls.context.push(copy(payload));return context();},
    async reserveReadBudget(payload){calls.budget.push(copy(payload));return budget(payload);},
    async pauseReadBudget(payload){calls.pause.push(copy(payload));paused=true;return {persisted:true,projectId:FB,pausedRequiresReview:true,renewalClearsPause:false};},
    async readDestinationPair(payload){calls.read.push(copy(payload));return {readTime:iso(),consistent:true,document:copy(live.get(payload.path)||null),provenance:copy(live.get(payload.provenancePath)||null)};},
    async commitCreatePair(payload){
      calls.commit.push(copy(payload));
      const updates=payload.writes.map(write=>({path:write.update.name.split('/documents/')[1],fields:copy(write.update.fields)}));
      // A synthetic atomic create: validate every precondition before any write.
      if(updates.some(row=>live.has(row.path))) throw Error('SYNTHETIC_ALREADY_EXISTS');
      const time=iso();for(const row of updates)live.set(row.path,document(row.path,row.fields,time));
      return {atomic:true,committed:true,commitTime:time,writeResults:updates.map(row=>({path:row.path,updateTime:time}))};
    },
    async checkpoint(payload){calls.checkpoint.push(copy(payload));return {persisted:true,runId:payload.runId,state:payload.state};}
  };
  const input={sourceSnapshot,manifest,destinationSnapshot,plan,approval,adapters,now};
  return {input,live,calls,context,budget,advance:ms=>{current+=ms;},replan:()=>{
    input.manifest.backupSha256=snapshotDigest(input.sourceSnapshot);
    input.manifest.entries.forEach(row=>{row.sourceSha256=documentDigest(input.sourceSnapshot.documents.find(doc=>doc.path===row.path));});
    input.plan=prepareSplitPlan(input.sourceSnapshot,input.manifest,input.destinationSnapshot);
    Object.assign(pins,{planSha256:input.plan.planSha256,sourceSnapshotSha256:snapshotDigest(input.sourceSnapshot),manifestSha256:snapshotDigest(input.manifest),destinationSnapshotSha256:snapshotDigest(input.destinationSnapshot),identitySha256:snapshotDigest(input.manifest.identityMappings)});
  }};
}

test('cria documento e proveniência em um commit create-only sem alterar FA',async()=>{
  const h=harness(), original=snapshotDigest(h.input.sourceSnapshot), result=await executeManagementMigration(h.input);
  assert.equal(result.status,'COMPLETE');assert.equal(result.receipts[0].status,'COMMITTED_PAIR');
  assert.equal(h.calls.commit.length,1);assert.equal(h.calls.commit[0].writes.length,2);
  assert.equal(h.live.size,2);assert.equal(snapshotDigest(h.input.sourceSnapshot),original);
  for(const write of h.calls.commit[0].writes){assert.deepEqual(write.currentDocument,{exists:false});assert.ok(write.update.name.startsWith('projects/'+FB+'/databases/(default)/documents/'));assert.equal(Object.hasOwn(write,'delete'),false);}
  assert.equal(result.sourceChanged,false);assert.equal(result.rebuildExecuted,false);assert.equal(result.triggersExecuted,false);
  assert.equal(h.calls.budget.length,2);assert.deepEqual(h.calls.budget.map(row=>row.stage),['READ_PAIR','COMMIT_PAIR']);
  assert.ok(h.calls.checkpoint.some(row=>row.state==='BEFORE_COMMIT'));assert.equal(h.calls.checkpoint.at(-1).state,'COMPLETE');
});

test('hash do plano adulterado e hash aprovado divergente impedem qualquer adaptador',async()=>{
  const h=harness();h.input.plan.operations[0].fields.name=value('Adulterado');
  await assert.rejects(executeManagementMigration(h.input),/MIGRATION_PLAN_HASH_MISMATCH/);assert.equal(h.calls.checkpoint.length,0);
  const clean=harness();clean.input.approval.pins.aclSha256='invalid';
  await assert.rejects(executeManagementMigration(clean.input),/MIGRATION_APPROVAL_PIN_MISMATCH/);assert.equal(clean.calls.read.length,0);
});

test('recomputação rejeita plano forjado mesmo com digest próprio e aprovação alterada',async()=>{
  const h=harness();h.input.plan.operations[0].fields.name=value('Forjado');
  const {planSha256,...unsigned}=h.input.plan;h.input.plan.planSha256=snapshotDigest(unsigned);h.input.approval.pins.planSha256=h.input.plan.planSha256;
  await assert.rejects(executeManagementMigration(h.input),/MIGRATION_PLAN_HASH_MISMATCH/);assert.equal(h.calls.read.length,0);
});

test('aprovação ausente, de outro projeto ou expirada é negada antes de reads',async()=>{
  for(const change of [
    approval=>{approval.authorized=false;},
    approval=>{approval.destinationProjectId=FA;},
    approval=>{approval.expiresAt=TIME;},
    approval=>{approval.purpose='TRAINING_RELEASE';}
  ]){const h=harness();change(h.input.approval);await assert.rejects(executeManagementMigration(h.input),/MIGRATION_APPROVAL/);assert.equal(h.calls.read.length,0);}
});

test('imutabilidade da entrada impede adulteração durante um adaptador assíncrono',async()=>{
  const h=harness(), original=h.input.adapters.checkpoint;
  h.input.adapters.checkpoint=async payload=>{h.input.plan.operations[0].fields.name=value('Alterado durante execução');h.input.approval.expiresAt='2099-01-01T00:00:00Z';return original(payload);};
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'COMPLETE');
  assert.equal(h.calls.commit[0].writes[0].update.fields.name.stringValue,'Área demonstração');
});

for(const [label,change,expected] of [
  ['contexto de ACL alterado',context=>{context.pins.aclSha256='b'.repeat(64);},'MIGRATION_CONTEXT_PIN_MISMATCH'],
  ['contexto de identidades alterado',context=>{context.pins.identitySha256='b'.repeat(64);},'MIGRATION_CONTEXT_PIN_MISMATCH'],
  ['manifesto não comprovado',context=>{context.manifestVerified=false;},'MIGRATION_CONTEXT_UNVERIFIED'],
  ['contexto antigo',context=>{context.verifiedAt=SOURCE_TIME.replace('11:59','11:50');},'MIGRATION_CONTEXT_STALE'],
  ['cliente FB ativo',context=>{context.destinationClientAccess='ENABLED';},'MIGRATION_DESTINATION_NOT_ISOLATED'],
  ['produtor FB ativo',context=>{context.destinationWriterState='RUNNING';},'MIGRATION_DESTINATION_NOT_ISOLATED'],
  ['adaptador de contexto faz reads não reservados',context=>{context.firestoreReadsIssued=1;},'MIGRATION_CONTEXT_ADAPTER_MUST_NOT_READ']
])test(label+' interrompe antes da leitura do par',async()=>{
  const h=harness();h.input.adapters.freshContext=async()=>{const context=h.context();change(context);return context;};
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'STOPPED');assert.equal(result.code,expected);assert.equal(h.calls.read.length,0);assert.equal(h.calls.commit.length,0);
});

for(const [label,change,expected] of [
  ['pausa persistente',proof=>{proof.pausedRequiresReview=true;},'MIGRATION_BUDGET_PAUSED_OR_INVALID'],
  ['métrica antiga mesmo declarada fresca',proof=>{proof.latestPoint='2026-10-08T11:50:00.000Z';},'MIGRATION_BUDGET_STALE_OR_INCOMPLETE'],
  ['métrica incompleta',proof=>{proof.complete=false;},'MIGRATION_BUDGET_STALE_OR_INCOMPLETE'],
  ['limite inclui margem e uso do app',proof=>{proof.reads=28000;},'MIGRATION_BUDGET_MARGIN_UNRELIABLE'],
  ['reserva insuficiente',proof=>{proof.reservedReads=1;},'MIGRATION_BUDGET_RESERVATION_INVALID'],
  ['mudança do dia sem decisão',proof=>{proof.reservationQuotaDayStart='2026-10-07T07:00:00.000Z';},'MIGRATION_BUDGET_DAY_REVIEW_REQUIRED'],
  ['promessa de corte global',proof=>{proof.exactGlobalCutoff=true;},'MIGRATION_BUDGET_MARGIN_UNRELIABLE']
])test(label+' impede reads e commits',async()=>{
  const h=harness();h.input.adapters.reserveReadBudget=async payload=>{const proof=h.budget(payload);change(proof);return proof;};
  const result=await executeManagementMigration(h.input);assert.equal(result.code,expected);assert.equal(h.calls.read.length,0);assert.equal(h.calls.commit.length,0);
});

test('revalida o orçamento antes do commit e conserva a leitura já realizada',async()=>{
  const h=harness();h.input.adapters.reserveReadBudget=async payload=>{const proof=h.budget(payload);if(payload.stage==='COMMIT_PAIR')proof.fresh=false;return proof;};
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'STOPPED');assert.equal(result.code,'MIGRATION_BUDGET_STALE_OR_INCOMPLETE');assert.equal(h.calls.read.length,1);assert.equal(h.calls.commit.length,0);
});

test('reserva repetida não pode financiar outra etapa',async()=>{
  const h=harness();h.input.adapters.reserveReadBudget=async payload=>({...h.budget(payload),reservationId:'same-reservation'});
  const result=await executeManagementMigration(h.input);assert.equal(result.code,'MIGRATION_BUDGET_RESERVATION_REUSED');assert.equal(h.calls.commit.length,0);
});

test('lease ou orçamento expira durante checkpoint antes do commit e interrompe sem escrita',async()=>{
  const h=harness(), original=h.input.adapters.checkpoint;
  h.input.adapters.checkpoint=async payload=>{if(payload.state==='BEFORE_COMMIT')h.advance(300001);return original(payload);};
  const result=await executeManagementMigration({...h.input,limits:{maximumDurationMs:300000}});
  assert.equal(result.status,'STOPPED');assert.equal(result.code,'MIGRATION_DEADLINE_EXCEEDED');assert.equal(h.calls.commit.length,0);
});

test('reexecução com captura e plano atualizados só SKIP para dados e proveniência equivalentes',async()=>{
  const first=harness();assert.equal((await executeManagementMigration(first.input)).status,'COMPLETE');
  const repeated=harness(first.input.sourceSnapshot.documents,[...first.live.values()]);
  assert.equal(repeated.input.plan.operations[0].operation,'SKIP');
  const result=await executeManagementMigration(repeated.input);assert.equal(result.status,'COMPLETE');assert.equal(result.receipts[0].status,'SKIPPED_VERIFIED_IDENTICAL');assert.equal(repeated.calls.commit.length,0);assert.equal(repeated.calls.budget.length,1);
});

test('concorrente já criou o par idêntico: SKIP sem nova escrita',async()=>{
  const h=harness(), operation=h.input.plan.operations[0];
  h.live.set(operation.path,document(operation.path,operation.fields,TIME));h.live.set(operation.provenancePath,document(operation.provenancePath,operation.provenanceFields,TIME));
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'COMPLETE');assert.equal(result.receipts[0].status,'SKIPPED_VERIFIED_IDENTICAL');assert.equal(h.calls.commit.length,0);
});

for(const kind of ['document-only','provenance-only','different-fields','different-provenance'])test('conflito '+kind+' nunca causa overwrite ou preenchimento parcial',async()=>{
  const h=harness(), operation=h.input.plan.operations[0];
  if(kind!=='provenance-only')h.live.set(operation.path,document(operation.path,kind==='different-fields'?{name:value('outro')}:operation.fields,TIME));
  if(kind!=='document-only')h.live.set(operation.provenancePath,document(operation.provenancePath,kind==='different-provenance'?{}:operation.provenanceFields,TIME));
  const initial=snapshotDigest([...h.live]);const result=await executeManagementMigration(h.input);
  assert.equal(result.status,'STOPPED');assert.match(result.code,/MIGRATION_DESTINATION_(PARTIAL_PAIR|DATA_OR_PROVENANCE)_CONFLICT/);assert.equal(h.calls.commit.length,0);assert.equal(snapshotDigest([...h.live]),initial);
});

test('par ausente após plano SKIP é mudança do destino e não é recriado',async()=>{
  const first=harness();await executeManagementMigration(first.input);
  const h=harness(first.input.sourceSnapshot.documents,[...first.live.values()]);h.live.clear();
  const result=await executeManagementMigration(h.input);assert.equal(result.code,'MIGRATION_DESTINATION_CHANGED_SINCE_PLAN');assert.equal(h.calls.commit.length,0);
});

test('resposta de leitura não consistente e path trocado são negados',async()=>{
  for(const alter of [pair=>{pair.consistent=false;},pair=>{pair.document=document('managementAreas/wrong',{},TIME);}]){
    const h=harness();h.input.adapters.readDestinationPair=async()=>{const pair={readTime:TIME,consistent:true,document:null,provenance:null};alter(pair);return pair;};
    const result=await executeManagementMigration(h.input);assert.match(result.code,/MIGRATION_DESTINATION_(READ_UNVERIFIED|PATH_MISMATCH)/);assert.equal(h.calls.commit.length,0);
  }
});

test('dependências são criadas antes dos dependentes mesmo com plano em ordem alfabética',async()=>{
  const h=harness([document('activities/task-demo',{areaId:value('area-demo')}),document('managementAreas/area-demo')]);
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'COMPLETE');
  assert.deepEqual(result.completedPaths,['managementAreas/area-demo','activities/task-demo']);assert.equal(h.live.size,4);
});

test('ciclo precisa de outro lote revisado e não inicia execução',async()=>{
  const h=harness([document('activities/one'),document('activities/two')]);
  h.input.manifest.entries[0].dependencies=['activities/two'];h.input.manifest.entries[1].dependencies=['activities/one'];h.replan();
  await assert.rejects(executeManagementMigration(h.input),/MIGRATION_DEPENDENCY_CYCLE_REQUIRES_BATCH/);assert.equal(h.calls.checkpoint.length,0);
});

test('evaluationRequests não migra como uma fila executável mesmo com relação Gestão',async()=>{
  const h=harness([document('evaluationRequests/request-demo',{areaId:value('area-demo')}),document('managementAreas/area-demo')]);
  assert.equal(h.input.plan.readyForReview,true);
  await assert.rejects(executeManagementMigration(h.input),/MIGRATION_EXECUTABLE_REQUEST_OR_RUNTIME_FORBIDDEN/);assert.equal(h.calls.read.length,0);
});

test('KEEP_FA e REBUILD ficam como classificação e nunca geram escrita, crédito ou runtime',async()=>{
  const h=harness([document('managementAreas/area-demo'),document('evaluationRuntime/main'),document('users/uid-demo')],[],{'evaluationRuntime/main':'REBUILD','users/uid-demo':'KEEP_FA'});
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'COMPLETE');assert.equal(h.calls.commit.length,1);assert.equal(h.live.size,2);assert.equal(result.rebuildExecuted,false);assert.equal(result.runtimeActivated,false);
});

test('falha na segunda unidade mantém receipt da primeira e não repete o commit',async()=>{
  const h=harness([document('managementAreas/one'),document('managementAreas/two')]), original=h.input.adapters.commitCreatePair;
  h.input.adapters.commitCreatePair=async payload=>{if(payload.writes[0].update.name.endsWith('/two'))throw Error('SYNTHETIC_COMMIT_FAILED');return original(payload);};
  const result=await executeManagementMigration(h.input);
  assert.equal(result.status,'UNKNOWN_COMMIT_OUTCOME');assert.deepEqual(result.completedPaths,['managementAreas/one']);assert.equal(result.receipts[0].status,'COMMITTED_PAIR');assert.equal(result.receipts[1].status,'UNKNOWN_COMMIT_OUTCOME');assert.equal(h.live.size,2);assert.equal(result.checkpointPersisted,true);assert.equal(result.requiresFreshReviewBeforeResume,true);
});

test('checkpoint de intenção precisa persistir antes de qualquer commit',async()=>{
  const h=harness();h.input.adapters.checkpoint=async payload=>({persisted:payload.state!=='BEFORE_COMMIT',runId:payload.runId,state:payload.state});
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'STOPPED');assert.equal(result.code,'MIGRATION_CHECKPOINT_NOT_PERSISTED');assert.equal(h.calls.commit.length,0);
});

test('checkpoint falha após commit conhecido: receipt preserva o par confirmado',async()=>{
  const h=harness();h.input.adapters.checkpoint=async payload=>{if(payload.state==='PROGRESS')throw Error('SYNTHETIC_CHECKPOINT_FAILED');return {persisted:true,runId:payload.runId,state:payload.state};};
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'COMMITTED_CHECKPOINT_INCOMPLETE');assert.equal(result.receipts[0].status,'COMMITTED_PAIR');assert.deepEqual(result.completedPaths,['managementAreas/area-demo']);assert.equal(h.live.size,2);
});

test('commit sem confirmação atômica é incerto, sem retry e sem confirmar conclusão',async()=>{
  const h=harness(), original=h.input.adapters.commitCreatePair;
  h.input.adapters.commitCreatePair=async payload=>({...await original(payload),atomic:false});
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'UNKNOWN_COMMIT_OUTCOME');assert.equal(result.code,'MIGRATION_COMMIT_UNVERIFIED');assert.equal(h.calls.commit.length,1);assert.equal(result.completedPaths.length,0);
});

test('timeout no commit reporta incerteza e impede próxima unidade',async()=>{
  const h=harness();let attempts=0;h.input.adapters.commitCreatePair=async()=>{attempts++;return new Promise(()=>{});};
  const result=await executeManagementMigration({...h.input,limits:{adapterTimeoutMs:10}});
  assert.equal(result.status,'UNKNOWN_COMMIT_OUTCOME');assert.equal(result.code,'MIGRATION_ADAPTER_TIMEOUT');assert.equal(attempts,1);
});

test('abort mantém ações locais e interrompe sem limpeza de dados',async()=>{
  const h=harness(), controller=new AbortController();controller.abort();
  const result=await executeManagementMigration({...h.input,signal:controller.signal});
  assert.equal(result.status,'STOPPED');assert.equal(result.code,'MIGRATION_ABORTED');assert.equal(result.pendingLocalActionsPreserved,true);assert.equal(h.calls.read.length,0);assert.equal(h.live.size,0);
});

test('erros externos são sanitizados e receipts não incluem documento privado',async()=>{
  const h=harness();h.input.adapters.readDestinationPair=async()=>{throw Error('secret@example.invalid raw document token');};
  const result=await executeManagementMigration(h.input);assert.equal(result.code,'MIGRATION_ADAPTER_FAILED');
  const serialized=JSON.stringify(result);assert.equal(serialized.includes('secret@'),false);assert.equal(serialized.includes('Área demonstração'),false);assert.equal(serialized.includes('"fields"'),false);
});

test('limite de unidades não permite continuação implícita',async()=>{
  const h=harness([document('managementAreas/one'),document('managementAreas/two')]);
  await assert.rejects(executeManagementMigration({...h.input,limits:{maximumUnits:1}}),/MIGRATION_UNIT_LIMIT_REQUIRES_REVIEW/);assert.equal(h.calls.checkpoint.length,0);
});

test('validação é local e preserva productionAuthorized false do dry run',()=>{
  const h=harness();assert.equal(validateManagementMigrationExecution({...h.input,nowMs:Date.parse(TIME)}).destinationProjectId,FB);assert.equal(h.input.plan.productionAuthorized,false);
});


test('reservas com IDs diferentes ainda precisam acumular leituras',async()=>{
  const h=harness();h.input.adapters.reserveReadBudget=async payload=>({...h.budget(payload),reservedReads:2});
  const result=await executeManagementMigration(h.input);assert.equal(result.code,'MIGRATION_BUDGET_RESERVATION_NOT_CUMULATIVE');assert.equal(h.calls.read.length,1);assert.equal(h.calls.commit.length,0);
});


test('gatilhos nativos de FB presentes impedem migração sem ativar qualquer execução',async()=>{
  const h=harness();h.input.adapters.freshContext=async()=>({...h.context(),destinationNativeTriggersAbsent:false});
  const result=await executeManagementMigration(h.input);assert.equal(result.code,'MIGRATION_DESTINATION_NOT_ISOLATED');assert.equal(h.calls.commit.length,0);
});

test('falha de orçamento grava pausa persistente e métricas frescas não autorizam retomada',async()=>{
  const h=harness();let failFirst=true;h.input.adapters.reserveReadBudget=async payload=>{const proof=h.budget(payload);if(failFirst){failFirst=false;proof.fresh=false;}return proof;};
  const result=await executeManagementMigration(h.input);assert.equal(result.readPausePersisted,true);assert.equal(h.calls.pause.length,1);
  const second=await executeManagementMigration(h.input);assert.equal(second.code,'MIGRATION_BUDGET_PAUSED_OR_INVALID');assert.equal(h.calls.read.length,0);assert.equal(h.calls.commit.length,0);
});

test('latch de pausa indisponível mantém bloqueio auditável, sem próximo documento',async()=>{
  const h=harness();h.input.adapters.reserveReadBudget=async payload=>({...h.budget(payload),fresh:false});h.input.adapters.pauseReadBudget=async()=>{throw Error('SYNTHETIC_PAUSE_FAILURE');};
  const result=await executeManagementMigration(h.input);assert.equal(result.status,'STOPPED');assert.equal(result.readPausePersisted,false);assert.equal(result.requiresFreshReviewBeforeResume,true);assert.equal(h.calls.commit.length,0);
});

function boundedHarness(...args) {
  const h = harness(...args);
  const scope = {schemaVersion:1, projectId:FB, databaseId:'(default)',
    runId:createHash('sha256').update(h.input.approval.requestId + '\u0000' + h.input.plan.planSha256).digest('hex'),
    pins:copy(h.input.approval.pins), unitPaths:h.input.plan.operations.map(operation=>operation.path)};
  const authorization = {schemaVersion:1, authorized:true, projectId:FB, databaseId:'(default)',
    purpose:'MANAGEMENT_MIGRATION_CREATE_ONLY', authorizationSource:'EXPLICIT_HUMAN_CONTINUE_FB',
    authorizationId:'human-continued-fb', approvedAt:TIME, expiresAt:h.input.approval.expiresAt,
    maximumDurationMs:300000, readPairMaximumReads:2, commitPairMaximumReads:2,
    maximumPostcheckReads:scope.unitPaths.length * 2, maximumReservedReads:scope.unitPaths.length * 6};
  let policy = createFbMigrationDestinationBudget({projectId:FB, scope, authorization, nowMs:h.input.now()});
  let counter = 0;
  h.calls.budgetPersistence = [];
  h.input.adapters.reserveReadBudget = async payload => {
    h.calls.budget.push(copy(payload));
    const reservation = {...payload, databaseId:'(default)', reservationId:'bounded-' + (++counter)};
    const pending = assessFbMigrationDestinationBudget({
      projectId:FB, scope, policy, nowMs:h.input.now(), reservation});
    // Two acknowledged synthetic durable writes happen before either transport.
    policy = pending.nextPolicy; h.calls.budgetPersistence.push(copy(policy));
    const acknowledged = acknowledgeFbMigrationDestinationReservation({
      projectId:FB, scope, policy, nowMs:h.input.now(),
      acknowledgement:{persisted:true, reservationId:reservation.reservationId, policySha256:pending.policySha256}});
    policy = acknowledged.nextPolicy; h.calls.budgetPersistence.push(copy(policy));
    return acknowledged.proof;
  };
  h.input.adapters.pauseReadBudget = async payload => {
    h.calls.pause.push(copy(payload));
    policy = pauseFbMigrationDestinationBudget({projectId:FB, policy, nowMs:h.input.now(), reason:payload.reason});
    return {persisted:true, projectId:FB, pausedRequiresReview:true, renewalClearsPause:false};
  };
  h.destinationBudget = () => copy(policy);
  return h;
}

test('modo FB autorizado executa sem Monitoring e sem alterar trava da origem', async () => {
  const h = boundedHarness(), faPause = {projectId:FA, pausedRequiresReview:true, dailyReadLimit:45000};
  const original = copy(faPause);
  const result = await executeManagementMigration(h.input);
  assert.equal(result.status, 'COMPLETE');
  assert.equal(h.calls.commit.length, 1);
  assert.equal(h.destinationBudget().reservedReads, 4);
  assert.equal(h.destinationBudget().maximumReservedReads, 6);
  assert.equal(h.destinationBudget().dailyReadLimit, null);
  assert.equal(h.destinationBudget().totalUsageKnown, false);
  assert.deepEqual(faPause, original);
  assert.equal(result.exactGlobalReadCutoff, false);
  assert.equal(h.calls.budgetPersistence.length, 4);
  assert.deepEqual(h.calls.budgetPersistence.map(row=>row.status),
    ['RESERVATION_PENDING','IN_PROGRESS','RESERVATION_PENDING','IN_PROGRESS']);
});

for (const [label, change] of [
  ['run', proof=>{proof.runId='f'.repeat(64);}],
  ['path', proof=>{proof.path='managementAreas/another';}],
  ['stage', proof=>{proof.stage='COMMIT_PAIR';}],
  ['pins', proof=>{proof.pins.aclSha256='f'.repeat(64);}],
  ['projeto', proof=>{proof.projectId=FA;}],
  ['purpose', proof=>{proof.authorizedPurpose='TRAINING_RELEASE';}],
  ['persistência', proof=>{proof.reservationPersisted=false;}],
  ['limite herdado', proof=>{proof.dailyReadLimit=35000;}],
  ['corte global', proof=>{proof.exactGlobalCutoff=true;}]
]) test('modo FB rejeita prova divergente em ' + label + ' antes de transporte', async () => {
  const h=boundedHarness(), reserve=h.input.adapters.reserveReadBudget;
  h.input.adapters.reserveReadBudget=async payload=>{const proof=await reserve(payload);change(proof);return proof;};
  const result=await executeManagementMigration(h.input);
  assert.equal(result.status,'STOPPED');assert.match(result.code,/MIGRATION_BUDGET_DESTINATION_/);
  assert.equal(h.calls.read.length,0);assert.equal(h.calls.commit.length,0);
  assert.equal(result.readPausePersisted,true);
  assert.equal(h.destinationBudget().reservedReads,2);
  assert.equal(h.destinationBudget().pausedRequiresReview,true);
});

test('modo FB falha em persistência mantém reserva e não inicia leitura', async () => {
  const h=boundedHarness(), reserve=h.input.adapters.reserveReadBudget;
  h.input.adapters.reserveReadBudget=async payload=>{
    await reserve(payload);
    throw new Error('MIGRATION_BUDGET_DESTINATION_PERSISTENCE_REQUIRED');
  };
  const result=await executeManagementMigration(h.input);
  assert.equal(result.code,'MIGRATION_BUDGET_DESTINATION_PERSISTENCE_REQUIRED');
  assert.equal(result.readPausePersisted,true);
  assert.equal(h.destinationBudget().reservedReads,2);
  assert.equal(h.calls.read.length,0);assert.equal(h.calls.commit.length,0);
});

test('modo FB revalida deadline após checkpoint de intenção', async () => {
  const h=boundedHarness(), checkpoint=h.input.adapters.checkpoint, reserve=h.input.adapters.reserveReadBudget;
  h.input.adapters.reserveReadBudget=async payload=>{
    const proof=await reserve(payload);proof.maximumDurationMs=1000;proof.deadlineAt='2026-10-08T12:00:01.000Z';return proof;
  };
  h.input.adapters.checkpoint=async payload=>{
    const result=await checkpoint(payload);if(payload.state==='BEFORE_COMMIT')h.advance(1001);return result;
  };
  const result=await executeManagementMigration(h.input);
  assert.equal(result.status,'STOPPED');assert.equal(result.code,'MIGRATION_BUDGET_DESTINATION_PROOF_EXPIRED');
  assert.equal(h.calls.read.length,1);assert.equal(h.calls.commit.length,0);
  assert.equal(h.destinationBudget().reservedReads,4);
  assert.equal(result.readPausePersisted,true);
});

test('modo FB mantém pausa em reexecução mesmo sem bloqueio de Monitoring', async () => {
  const h=boundedHarness(), reserve=h.input.adapters.reserveReadBudget;
  let first=true;
  h.input.adapters.reserveReadBudget=async payload=>{
    const proof=await reserve(payload);if(first){first=false;proof.pausedRequiresReview=true;}return proof;
  };
  const failed=await executeManagementMigration(h.input);
  assert.equal(failed.readPausePersisted,true);
  const second=await executeManagementMigration(h.input);
  assert.equal(second.code,'MIGRATION_BUDGET_DESTINATION_PAUSED_REQUIRES_REVIEW');
  assert.equal(h.calls.read.length,0);assert.equal(h.calls.commit.length,0);
  assert.equal(h.destinationBudget().reservedReads,2);
});
