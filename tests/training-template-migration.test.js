import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const code=readFileSync(new URL('../apps-script-v2/TrainingTemplateMigration.gs',import.meta.url),'utf8');
function harness({responses=false,conflict=false,partial=false,httpError=false}={}) {
  const item={formId:'fixture-form',sourceId:'fixture-source',title:'Matéria fictícia',creditScopeId:'fixture-scope',version:1,maxTestScore:1,materialUrls:[]};
  const before={formId:item.formId,items:[{itemId:'old-ack'}]},after={formId:item.formId,info:{title:item.title},items:[{itemId:'ack'},{itemId:'quiz'},{itemId:'text'}]};
  const cfg={configVersion:1,managerUid:'manager',version:1,creditScopeId:item.creditScopeId,status:'READY',materialFingerprint:'fixture-material'};
  const activity={configVersion:1},targets=Array.from({length:75},(_,i)=>({formId:'previous-'+i})).concat(item);
  const audit={targets,snapshots:[before]},state={schemaVersion:1,status:'RUNNING',cursor:75,rows:Array(75).fill(null),runs:0,manifestDigest:'digest',startedAt:new Date().toISOString()};
  if (partial) state.rows[75]={formId:item.formId,status:'FORM_WRITE_PENDING',before,config:cfg,activity,wasAccepting:true,wasPublished:true};
  let stored=JSON.stringify(state),phase=partial?1:0,accepting=!partial,batchWrites=0,dbWrites=[],cfgReads=0,triggersRemoved=0;
  const file={getBlob:()=>({getDataAsString:()=>stored}),setContent:value=>{stored=value;},getUrl:()=> 'https://drive.google.com/file/d/fixture-report/view'};
  const context=vm.createContext({console:{log:()=>{}},evaluationAssertOperator_:()=> 'owner@example.invalid',
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>JSON.stringify({fileId:'recovery',triggerId:'one-trigger'})})},
    ScriptApp:{getProjectTriggers:()=>[{getUniqueId:()=> 'one-trigger',getHandlerFunction:()=> 'continuarPadronizacaoTreinamentosGestaoV2'}],deleteTrigger:()=>{triggersRemoved++;}},
    FormApp:{openById:()=>({isAcceptingResponses:()=>accepting,isPublished:()=>true,setAcceptingResponses:value=>{accepting=value;}})},
    SAHMT_V2_TRAINING_RELEASE:{areaId:'area'},
    SAHMT_TRAINING_TEMPLATE_PLANNER:{plan:()=>({batchUpdate:{requests:[]},mapping:{acknowledgement:{itemId:'ack',affirmativeValue:'SIM'},suggestionText:{itemId:'text'}}}),verify:()=>({})},
    trainingReleaseLoad_:()=>({digest:'digest'}),trainingReleaseContext_:()=>{},trainingReleaseSource_:()=>{},
    formsEvaluationHash_:value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    formsEvaluationMetadata_:()=>structuredClone(phase?after:before),
    formsEvaluationGoogleRequest_:url=>{if(url.includes('/responses?'))return responses?{responses:[{responseId:'discarded'}]}:{};if(httpError)throw Object.assign(new Error('private response body with token and user email'),{status:400});phase=1;batchWrites++;return{};},
    formsEvaluationConfiguration_:()=>({maxTestScore:1,mapping:{acknowledgement:{itemId:'ack'},suggestionText:{itemId:'text'}},questionSnapshot:[],questionFingerprint:'question-proof'}),
    formsEvaluationActive_:p=>p?.active===true,
    evaluationGet_:name=>name==='evaluationFormConfigs'?structuredClone({...cfg,configVersion:conflict&&++cfgReads>1?2:1}):name==='evaluationActivities'?structuredClone(activity):name==='evaluationAssignments'?{uid:'manager'}:name==='users'?{active:true}:null,
    evaluationWrite_:(collection,id,changes)=>({collection,id,changes}),evaluationRunTransaction_:callback=>{const plan=callback('tx');dbWrites.push(...plan.writes);return plan.result;}
  });
  vm.runInContext(code,context);
  context.trainingTemplatePrivateJson_=id=>id==='recovery'?{file,data:JSON.parse(stored)}:{data:audit};
  return {run:()=>context.continuarPadronizacaoTreinamentosGestaoV2(),sameRecord:(a,b)=>context.trainingTemplateSameRecord_(a,b),snapshot:()=>({accepting,batchWrites,dbWrites,triggersRemoved,state:JSON.parse(stored)})};
}
test('migração encerra o acionador e preserva escopo, UID e permissões fora da atualização',()=>{
  const h=harness(),r=h.run(),s=h.snapshot();assert.equal(r.code,'TRAINING_TEMPLATE_COMPLETED');assert.equal(s.batchWrites,1);assert.equal(s.accepting,true);assert.equal(s.triggersRemoved,1);
  assert.deepEqual(s.dbWrites.map(w=>w.collection),['trainingTemplateMigrations','evaluationFormConfigs','evaluationActivities']);
  const patch=s.dbWrites[1].changes;assert.equal(patch.participantTemplateVersion,2);assert.equal(patch.configVersion,2);assert.equal(patch.eligibleUids,undefined);assert.equal(patch.managerUid,undefined);assert.equal(patch.status,undefined);
});
test('resposta chegada após auditoria impede alteração de questões e mantém fechamento seguro',()=>{
  const h=harness({responses:true}),r=h.run(),s=h.snapshot();assert.equal(r.code,'TRAINING_RESPONSES_ARRIVED_PRESERVED');assert.equal(s.batchWrites,0);assert.equal(s.dbWrites.length,0);assert.equal(s.accepting,false);assert.equal(s.state.status,'STOPPED');assert.equal(s.triggersRemoved,1);
});
test('conflito de configuração não publica formulário nem sobrescreve o registro concorrente',()=>{
  const h=harness({conflict:true}),r=h.run(),s=h.snapshot();assert.equal(r.code,'TRAINING_CONFIGURATION_CAS_CONFLICT');assert.equal(s.dbWrites.length,0);assert.equal(s.accepting,false);assert.equal(s.state.status,'STOPPED');
});
test('metadado _createTime da leitura transacional não simula uma edição concorrente',()=>{
  const h=harness(),before={_documentName:'projects/demo/databases/(default)/documents/config/one',_updateTime:'2026-10-16T03:00:00.123456Z',validFrom:'2026-10-06T00:00:00Z'};
  const tx={...before,_createTime:'2026-10-06T00:00:00Z',validFrom:new Date(before.validFrom)};
  assert.equal(h.sameRecord(tx,before),true);
  assert.equal(h.sameRecord({...tx,_updateTime:'2026-10-16T03:00:00.123457Z'},before),false);
  assert.equal(h.sameRecord({...tx,_documentName:'different-document'},before),false);
});
test('retomada do layout aplicado não envia novamente deleteItem ou createItem',()=>{
  const h=harness({partial:true}),r=h.run(),s=h.snapshot();assert.equal(r.code,'TRAINING_TEMPLATE_COMPLETED');assert.equal(s.batchWrites,0);assert.equal(s.dbWrites.length,3);assert.equal(s.state.cursor,76);assert.equal(s.accepting,true);
});
test('erro HTTP informa etapa e status sem persistir mensagem ou resposta privada',()=>{
  const h=harness({httpError:true}),r=h.run(),s=h.snapshot();assert.equal(r.code,'TRAINING_TEMPLATE_HTTP_ERROR');assert.equal(r.diagnostic.stage,'FORMS_BATCH_UPDATE');assert.equal(r.diagnostic.httpStatus,400);assert.equal(r.diagnostic.category,'GOOGLE_BAD_REQUEST');assert.equal(JSON.stringify(s.state).includes('private response body'),false);assert.equal(s.dbWrites.length,0);
});
