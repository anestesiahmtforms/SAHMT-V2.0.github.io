import test from 'node:test';
import assert from 'node:assert/strict';
import {OCCURRENCE_FORMS} from '../src/occurrence-schema.js';
import {occurrenceFieldMarkup,occurrenceFormMarkup,occurrenceGroupMarkup,occurrenceCategoryMarkup,occurrenceModuleAccess,loadOccurrenceCatalogForSession,occurrenceCatalogErrorMessage,createOccurrenceSessionGate} from '../src/occurrences-ui.js';

test('leituras simultâneas aguardam uma única conexão FC e preservam o UID',async()=>{
  const auth={currentUser:null};let calls=0;
  const gate=createOccurrenceSessionGate({auth,uid:'synthetic',isCurrent:()=>true,connect:async()=>{
    calls++;auth.currentUser={uid:'synthetic'};return {targets:{FC:{status:'ready'}}};
  }});
  await Promise.all([gate(),gate(),gate()]);
  assert.equal(calls,1);
  await gate();assert.equal(calls,1);
  auth.currentUser=null;
  await gate();assert.equal(calls,2);
});

test('conexão FC divergente ou sessão FA trocada não libera leituras',async()=>{
  const auth={currentUser:null};
  const gate=createOccurrenceSessionGate({auth,uid:'synthetic',isCurrent:()=>true,connect:async()=>{
    auth.currentUser={uid:'other'};return {targets:{FC:{status:'ready'}}};
  }});
  await assert.rejects(gate(),{message:'OCCURRENCE_FC_CONNECTION_UNAVAILABLE'});
  let current=true;
  const switched=createOccurrenceSessionGate({auth:{currentUser:null},uid:'synthetic',isCurrent:()=>current,
    connect:async()=>{current=false;return {targets:{FC:{status:'ready'}}};}});
  await assert.rejects(switched(),{message:'OCCURRENCE_SESSION_CHANGED'});
});

test('nova leitura aguarda o resultado do broker mesmo depois de Auth preencher o usuário',async()=>{
  const auth={currentUser:null};let finish;
  const gate=createOccurrenceSessionGate({auth,uid:'synthetic',isCurrent:()=>true,connect:async()=>{
    auth.currentUser={uid:'synthetic'};
    return new Promise(resolve=>{finish=resolve;});
  }});
  const first=gate();await Promise.resolve();
  let completed=false;const second=gate().then(()=>{completed=true;});
  await Promise.resolve();assert.equal(completed,false);
  finish({targets:{FC:{status:'ready'}}});await Promise.all([first,second]);
  assert.equal(completed,true);
});

test('catálogo reconecta uma vez ao FC quando a sessão está sem autorização',async()=>{
  let reads=0,connects=0;
  const result=await loadOccurrenceCatalogForSession({uid:'synthetic',isCurrent:()=>true,
    repository:{loadCatalog:async()=>{if(++reads===1)throw Error('OCCURRENCE_PERMISSION_DENIED');return {catalogs:{ok:[]}};}},
    reconnect:async()=>{connects++;return {targets:{FC:{status:'ready'}}};}});
  assert.equal(reads,2);assert.equal(connects,1);assert.deepEqual(result,{catalogs:{ok:[]}});
});

test('catálogo não reconecta após troca de usuário e não mascara falha de vínculo',async()=>{
  let connects=0;
  await assert.rejects(loadOccurrenceCatalogForSession({uid:'synthetic',isCurrent:()=>false,
    repository:{loadCatalog:async()=>{throw Error('OCCURRENCE_SESSION_INVALID');}},
    reconnect:async()=>{connects++;return {targets:{FC:{status:'ready'}}};}}),/OCCURRENCE_SESSION_INVALID/);
  assert.equal(connects,0);
  await assert.rejects(loadOccurrenceCatalogForSession({uid:'synthetic',isCurrent:()=>true,
    repository:{loadCatalog:async()=>{throw Error('OCCURRENCE_CATALOG_UNAVAILABLE');}},
    reconnect:async()=>{connects++;return {targets:{FC:{status:'unavailable'}}};}}),/OCCURRENCE_CATALOG_UNAVAILABLE/);
  assert.equal(connects,0);
  assert.match(occurrenceCatalogErrorMessage(Error('OCCURRENCE_PERMISSION_DENIED')),/permissão/);
});

test('falha de rede no token ou catálogo não dispara nova autenticação no FC',async()=>{
  for(const code of ['OCCURRENCE_AUTHORIZATION_UNAVAILABLE','OCCURRENCE_CATALOG_UNAVAILABLE']){
    let connects=0;
    await assert.rejects(loadOccurrenceCatalogForSession({uid:'synthetic',isCurrent:()=>true,
      repository:{loadCatalog:async()=>{throw Error(code);}},
      reconnect:async()=>{connects++;return {targets:{FC:{status:'ready'}}};}}),{message:code});
    assert.equal(connects,0);
  }
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
