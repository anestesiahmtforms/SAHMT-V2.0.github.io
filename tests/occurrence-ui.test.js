import test from 'node:test';
import assert from 'node:assert/strict';
import {OCCURRENCE_FORMS} from '../src/occurrence-schema.js';
import {occurrenceFieldMarkup,occurrenceFormMarkup,occurrenceGroupMarkup,occurrenceCategoryMarkup,occurrenceModuleAccess,loadOccurrenceCatalogForSession,occurrenceCatalogErrorMessage,createOccurrenceSessionGate,submitOccurrenceWithFallback,summarizeOccurrenceOutbox,occurrenceQueueFailureMessage} from '../src/occurrences-ui.js';

test('pending summary is UID-local, contains no report values, and never claims server confirmation',()=>{
 const summary=summarizeOccurrenceOutbox([
  {type:'occurrences',status:'queued',payload:{values:{description:'PRIVATE synthetic report'}}},
  {type:'occurrences',status:'failed',payload:{values:{description:'PRIVATE denied report'}}},
  {type:'events',status:'queued',payload:{}}
 ]);
 assert.deepEqual(summary,{queued:1,needsReview:1,message:'1 ocorrência(s) salva(s) neste dispositivo, aguardando sincronização. 1 ocorrência(s) precisam de revisão e não foram confirmadas.'});
 assert.doesNotMatch(summary.message,/PRIVATE|confirmada pelo Firestore|pontuação/);
});

test('local queue failure tells the user to keep the form open and never claims it was saved',()=>{
 assert.match(occurrenceQueueFailureMessage(Error('OCCURRENCE_QUEUE_FULL')),/mantenha o formulário aberto/);
 assert.match(occurrenceQueueFailureMessage(Error('OCCURRENCE_QUEUE_TOO_LARGE')),/limite local/);
 assert.doesNotMatch(occurrenceQueueFailureMessage(Error('IDB_FAILURE')),/Registro confirmado|Pontuação aguardando/);
});

test('transient save failure stores the same validated occurrence ID under the active UID',async()=>{
 const calls=[], input={uid:'uid-a',recordId:'10000000-0000-4000-8000-000000000001',formId:'F01',values:{occurrence:'sintética'},displayName:'Pessoa sintética',anonymous:false,catalogs:{F01:['opção']}};
 const result=await submitOccurrenceWithFallback({repository:{save:async()=>{throw Error('OCCURRENCE_TRANSIENT_WRITE_FAILED');}},input,isCurrent:()=>true,createdAtClient:123,
  enqueue:async item=>{calls.push(item);return item.recordId;}});
 assert.equal(result.status,'queued');assert.equal(result.id,input.recordId);assert.equal(calls.length,1);
 assert.deepEqual(calls[0],{uid:'uid-a',recordId:input.recordId,payload:{formId:'F01',values:input.values,displayName:input.displayName,anonymous:false,createdAtClient:123}});
});

test('permission denial and changed session never enter the offline queue',async()=>{
 const input={uid:'uid-a',recordId:'10000000-0000-4000-8000-000000000001',formId:'F01',values:{occurrence:'sintética'},displayName:'Pessoa',anonymous:false};let enqueues=0;
 const enqueue=async()=>{enqueues++;};
 await assert.rejects(submitOccurrenceWithFallback({repository:{save:async()=>{throw Error('OCCURRENCE_PERMISSION_DENIED');}},input,enqueue,isCurrent:()=>true}),/OCCURRENCE_PERMISSION_DENIED/);
 await assert.rejects(submitOccurrenceWithFallback({repository:{save:async()=>{throw Error('OCCURRENCE_TRANSIENT_WRITE_FAILED');}},input,enqueue,isCurrent:()=>false}),/OCCURRENCE_SESSION_CHANGED/);
 assert.equal(enqueues,0);
});

test('online confirmation bypasses the queue and a local storage failure is not reported as pending',async()=>{
 const input={uid:'uid-a',recordId:'10000000-0000-4000-8000-000000000001',formId:'F01',values:{occurrence:'sintética'},displayName:'Pessoa',anonymous:false};let enqueues=0;
 const saved=await submitOccurrenceWithFallback({repository:{save:async()=>({status:'saved',id:input.recordId})},input,enqueue:async()=>{enqueues++;},isCurrent:()=>true});
 assert.equal(saved.status,'saved');assert.equal(enqueues,0);
 await assert.rejects(submitOccurrenceWithFallback({repository:{save:async()=>{throw Error('OCCURRENCE_TRANSIENT_WRITE_FAILED');}},input,enqueue:async()=>{throw Error('OCCURRENCE_QUEUE_FULL');},isCurrent:()=>true}),/OCCURRENCE_QUEUE_FULL/);
});

test('FA session is reused immediately without any broker call',async()=>{
 const auth={currentUser:{uid:'synthetic'}};let calls=0;
 const gate=createOccurrenceSessionGate({auth,uid:'synthetic',isCurrent:()=>true,connect:async()=>{calls++;}});
 await Promise.all([gate(),gate(),gate()]);assert.equal(calls,0);
 auth.currentUser=null;await assert.rejects(gate(),/OCCURRENCE_SESSION_INVALID/);assert.equal(calls,0);
});
test('changed or missing FA identity never opens the form',async()=>{
 for(const auth of [{currentUser:null},{currentUser:{uid:'other'}}])await assert.rejects(createOccurrenceSessionGate({auth,uid:'synthetic',isCurrent:()=>true})(),/SESSION_INVALID/);
 await assert.rejects(createOccurrenceSessionGate({auth:{currentUser:{uid:'synthetic'}},uid:'synthetic',isCurrent:()=>false})(),/SESSION_CHANGED/);
});
test('FA catalog reads once and validates identity after a delayed response',async()=>{
 let current=true,reads=0,connects=0;
 const options={uid:'synthetic',isCurrent:()=>current,repository:{loadCatalog:async()=>{reads++;return{catalogs:{ok:[]}};}},reconnect:async()=>{connects++;}};
 assert.deepEqual(await loadOccurrenceCatalogForSession(options),{catalogs:{ok:[]}});assert.equal(reads,1);assert.equal(connects,0);
 options.repository.loadCatalog=async()=>{current=false;return{catalogs:{ok:[]}};};
 await assert.rejects(loadOccurrenceCatalogForSession(options),/SESSION_CHANGED/);
});
test('permission or network failures never create a secondary connection',async()=>{
 for(const code of ['OCCURRENCE_PERMISSION_DENIED','OCCURRENCE_AUTHORIZATION_UNAVAILABLE','OCCURRENCE_CATALOG_UNAVAILABLE']){
  let connects=0;await assert.rejects(loadOccurrenceCatalogForSession({uid:'synthetic',isCurrent:()=>true,repository:{loadCatalog:async()=>{throw Error(code);}},reconnect:async()=>{connects++;}}),{message:code});assert.equal(connects,0);
 }
 assert.match(occurrenceCatalogErrorMessage(Error('OCCURRENCE_PERMISSION_DENIED')),/permissão/);
});
test('grupos mostram os dez formulários e removem o atalho oncológico',()=>{
  const markup=['A','B','C','D'].map(id=>occurrenceCategoryMarkup(id,{canWrite:true})).join('');
  assert.equal((markup.match(/data-occurrence-form="F\d\d"/g)||[]).length,10);
  assert.doesNotMatch(markup,/ONCOLÓGICA|Em preparação|occurrence-form-launch--pending/);
  assert.doesNotMatch(markup,/Formulário de Registro/);
});

test('módulo exige permissão explícita mesmo quando o usuário é administrador',()=>{
  assert.deepEqual(occurrenceModuleAccess({admin:true}),{read:false,write:false,audit:false,any:false});
  assert.deepEqual(occurrenceModuleAccess({occurrencesWrite:true}),{read:false,write:true,audit:false,any:true});
});

test('grupo impede envio sem autorização de gravação',()=>{
  const markup=occurrenceCategoryMarkup('A',{canWrite:false});
  assert.match(markup,/data-occurrence-form="F01" disabled/);
});

test('página inicial mostra quatro acessos a banners, sem expandir formulários nela',()=>{
  const markup=occurrenceGroupMarkup();
  assert.equal((markup.match(/data-occurrence-group="[A-D]"/g)||[]).length,4);
  assert.doesNotMatch(markup,/<details|<summary|data-occurrence-form=/);
  assert.equal((markup.match(/class="occurrence-icon"/g)||[]).length,4);
  assert.match(markup,/NOTIFICAÇÃO DE INCIDENTE ASSISTENCIAL/);
});

test('banner de categoria mostra somente seus formulários e retorno independente',()=>{
  const markup=occurrenceCategoryMarkup('B');
  assert.doesNotMatch(markup,/REGISTRO DE OCORRÊNCIA|class="eyebrow"/);
  assert.match(markup,/NOTIFICAÇÃO DE INFRAÇÃO OU DILEMA ÉTICO/);
  assert.match(markup,/data-occurrence-form="F08"/);
  assert.doesNotMatch(markup,/data-occurrence-form="F01"|identity-card/);
  assert.match(markup,/data-occurrence-group-cancel/);
  assert.match(markup,/class="occurrence-icon"/);
});

test('formulário destaca o título do evento sem texto superior repetido',()=>{
  const markup=occurrenceFormMarkup(OCCURRENCE_FORMS[0]);
  assert.doesNotMatch(markup,/REGISTRO DE OCORRÊNCIA|class="eyebrow"/);
  assert.match(markup,/NOTIFICAÇÃO DE FARMACOVIGILÂNCIA - QUEIXA TÉCNICA DE MEDICAMENTO/);
});

test('formulário F10 não mostra bloco de informações gerais nem campos ausentes',()=>{
  const form=OCCURRENCE_FORMS.find(item=>item.id==='F10');
  const markup=occurrenceFormMarkup(form,{SETORES_55:['Setor A']},'Usuária de teste');
  assert.doesNotMatch(markup,/Informações Gerais|Colaborador|Classificação da Não Conformidade/);
  assert.match(markup,/Setor de Origem/);assert.match(markup,/Setor de Destino/);
  assert.match(markup,/name="anonymous"/);
});

test('listas longas têm pesquisa e todas as opções são escapadas para HTML',()=>{
  const item={id:'sector',label:'Setor',type:'select',required:true,catalog:'SETORES_55'};
  const markup=occurrenceFieldMarkup(item,{SETORES_55:Array.from({length:55},(_,index)=>index?'Setor '+index:'<script>')});
  assert.match(markup,/type="search"/);assert.doesNotMatch(markup,/<script>/);assert.match(markup,/&lt;script&gt;/);
});

test('forms 1–9 keep general date only once, and F08 does not add Cadastro',()=>{
  for(const form of OCCURRENCE_FORMS.filter(item=>item.id!=='F10')){
    const markup=occurrenceFormMarkup(form,{},'Pessoa');
    assert.equal((markup.match(/name="eventDate"/g)||[]).length,1,form.id);
    assert.doesNotMatch(markup,/name="Cadastro"/);
  }
});
