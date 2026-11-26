import test from 'node:test';
import assert from 'node:assert/strict';
import {OCCURRENCE_FORMS} from '../src/occurrence-schema.js';
import {prepareOccurrenceAnalysis,buildPreparationPrompt,readAnalysisDraft,readPreparationDraft} from '../src/occurrence-ai-prompts.js';
import {OCCURRENCE_IMPROVEMENT_QUESTION} from '../src/occurrence-questionnaire.js';
import {occurrenceFieldMarkup,occurrenceFormMarkup,occurrenceGroupMarkup,occurrenceCategoryMarkup,occurrenceModuleAccess,loadOccurrenceCatalogForSession,occurrenceCatalogErrorMessage,createOccurrenceSessionGate,submitOccurrenceWithFallback,occurrenceWriteFailureMessage} from '../src/occurrences-ui.js';

const report={origin:'app',sequence:4,formId:'F03',description:'Relato sintético',details:{attendance:'IDENTIFICADOR NÃO EXPORTÁVEL'}};
const improvementQuestions=[
 ...Array.from({length:4},(_,index)=>({prompt:'Pergunta '+index,options:['Primeira','Segunda']})),
 {prompt:OCCURRENCE_IMPROVEMENT_QUESTION,options:['Revisar protocolo','Melhorar comunicação','Rever supervisão']}
];

test('preparo do SAHMT enumera o formulário na ordem do registro e preserva o método IDEA',()=>{
 const clinical=buildPreparationPrompt({...report,title:'Evento sintético',occurredOn:'2026-11-25',
  details:{...report.details,eventClassification:'Evento sem Dano',incidentType:'Evento anestésico',age:'Idade bruta reservada'}},
 false,{age:'8 meses',diagnosisOrTreatment:'Tratamento sintético',chartDisclosure:'Sim',teamFactors:'Comunicação escrita',
  taskFactors:'Texto inválido',analysisParticipants:'Serviço de Anestesiologia'});
 assert.match(clinical,/de 5 a 10 perguntas/);
 assert.match(clinical,/Caderno 7 da Anvisa[\s\S]*Resolução CFM nº 2\.174\/2017/);
 assert.match(clinical,/exatamente três propostas distintas[\s\S]*Cada participante escolhe apenas uma ação/);
 const {itensDoRegistro:items}=JSON.parse(clinical.split('\n\nDADOS DA OCORRÊNCIA\n')[1]);
 assert.deepEqual(items.map(item=>item.numero),items.map((_,index)=>index+1));
 assert.deepEqual(items.slice(0,8),[
  {numero:1,rotulo:'Data da ocorrência',valor:'25/11/2026'},
  {numero:2,rotulo:'Classificação do evento',valor:'Evento sem Dano'},
  {numero:3,rotulo:'Ocorrência',valor:'Evento sintético'},
  {numero:4,rotulo:'Descrição',valor:'Relato sintético'},
  {numero:5,rotulo:'Atendimento',situacao:'consulta interna'},
  {numero:6,rotulo:'Sexo',situacao:'a confirmar'},
  {numero:7,rotulo:'Idade',valor:'8 meses'},
  {numero:8,rotulo:'Diagnóstico ou Tratamento',valor:'Tratamento sintético'}
 ]);
 assert.deepEqual(items.slice(-2).map(item=>item.rotulo),['Em que período ocorreu o evento?','Disclosure com registro em prontuário']);
 assert.equal(items.at(-1).valor,'Sim');
 assert.equal(items.find(item=>item.rotulo==='Tipo de Evento').valor,'Evento anestésico');
 assert.equal(items.find(item=>item.rotulo==='Fatores contribuintes do time (equipe)?').valor,'Comunicação escrita');
 assert.equal(items.find(item=>item.rotulo==='Fatores contribuintes da tarefa?').situacao,'a confirmar');
 assert.doesNotMatch(clinical,/IDENTIFICADOR NÃO EXPORTÁVEL|Texto inválido|Idade bruta reservada/);
 const ethical=buildPreparationPrompt({...report,formId:'F08'},false);
 assert.match(ethical,/Tratamento das Questões Éticas — IDEA/);
 assert.doesNotMatch(ethical,/itensDoRegistro/);
 const hospital=buildPreparationPrompt({...report,origin:'hospital',hospitalNumber:'1'},false);
 assert.match(hospital,/Pré-análise de ocorrência no contexto anestésico/);
 assert.doesNotMatch(hospital,/itensDoRegistro/);
});

test('o rascunho das GRA exige três ações e usa as opções da votação no texto',()=>{
 const draft={protocolo:'GRA 004',descricao:'Descrição',perguntas:improvementQuestions};
 const read=perguntas=>readPreparationDraft(JSON.stringify({...draft,perguntas}),'GRA 004',false,'F03');
 const prepared=read(improvementQuestions);
 assert.deepEqual(prepared.questions,improvementQuestions);
 assert.equal(prepared.description,'Descrição\n\nAÇÕES DE MELHORIA\n1. Revisar protocolo\n2. Melhorar comunicação\n3. Rever supervisão');
 const withActions={...draft,descricao:'Descrição\n\n**Ações de melhoria:**\n1. Texto divergente'};
 assert.equal(readPreparationDraft(JSON.stringify(withActions),'GRA 004',false,'F03').description,prepared.description);
 const edited={...improvementQuestions.at(-1),prompt:'Qual medida você recomenda para o serviço?'};
 assert.equal(read([...improvementQuestions.slice(0,-1),edited]).questions.at(-1).prompt,edited.prompt);
 assert.throws(()=>read(improvementQuestions.slice(1)),/OCCURRENCE_PREPARATION_QUESTION_COUNT_INVALID/);
 assert.deepEqual(read([...improvementQuestions.slice(0,4),...improvementQuestions]).questions.length,9);
 const maximum=[...Array.from({length:9},(_,index)=>({prompt:'Questão '+index,options:['Uma','Outra']})),improvementQuestions.at(-1)];
 assert.equal(read(maximum).questions.length,10);
 assert.throws(()=>read([maximum[0],...maximum]),/OCCURRENCE_PREPARATION_QUESTION_COUNT_INVALID/);
 for(const options of [['A','B'],['A','B','C','D'],['Revisão','revisão','Outro']]){
  const questions=[...improvementQuestions.slice(0,4),{prompt:OCCURRENCE_IMPROVEMENT_QUESTION,options}];
  assert.throws(()=>read(questions),/OCCURRENCE_IMPROVEMENT_VOTE_INVALID/);
 }
 const legacyTwo=[...improvementQuestions.slice(0,-1),{...improvementQuestions.at(-1),options:['A','B']}];
 assert.deepEqual(readPreparationDraft(JSON.stringify({...draft,protocolo:'GR 004',perguntas:legacyTwo}),
  'GR 004',false,'F03'),{description:'Descrição',questions:legacyTwo});
});

test('análise leva somente a ação vencedora à IA e conserva empate ou ausência de votos',()=>{
 const analyze=answers=>{
  const questions=[...improvementQuestions.slice(0,-1),{...improvementQuestions.at(-1),prompt:'Qual medida você recomenda?'}];
  return prepareOccurrenceAnalysis({...report,preparedDescription:'Pré-análise publicada\n\nAÇÕES DE MELHORIA\n1. Revisar protocolo\n2. Melhorar comunicação\n3. Rever supervisão'},{
   questions,entries:answers.map(answer=>({answers:[1,1,1,1,answer],comment:'Comentário da equipe'})),legacy:[]
  },{},'2026-11-25');
 };
 const {prompt,plan}=analyze([1,2,2]);
 assert.deepEqual(plan.priority,{action:'Melhorar comunicação',total:3,votes:2,state:'winner'});
 assert.equal(plan.dueDate,'2026-12-02');
 assert.match(prompt,/Pré-análise publicada[\s\S]*Melhorar comunicação[\s\S]*Comentário da equipe/);
 assert.doesNotMatch(prompt,/Revisar protocolo|Rever supervisão/);
 assert.equal(analyze([1,2]).plan.priority.state,'tie');
 assert.equal(analyze([1,2]).plan.dueDate,'');
 assert.equal(analyze([]).plan.priority.state,'no-votes');
 assert.equal(analyze([]).plan.priority.total,0);
 const withoutPoll=prepareOccurrenceAnalysis(report,{questions:[...improvementQuestions.slice(0,-1),
  {prompt:'Houve acompanhamento?',options:['Sim','Não','A confirmar']}],
  entries:[{answers:[1,1,1,1,1]}],legacy:[]},{},'2026-11-25');
 assert.equal(withoutPoll.plan.priority.state,'no-poll');
 assert.equal(withoutPoll.plan.dueDate,'');
 assert.match(withoutPoll.prompt,/Houve acompanhamento\?/);
});

test('análise clínica repete os itens da pré-análise, gera uma ação única e usa o prazo calculado pelo app',()=>{
 const entry={...report,preparedDescription:'Pré-análise aprovada'};
 const {prompt,plan}=prepareOccurrenceAnalysis(entry,{questions:improvementQuestions,
  entries:[{answers:[1,1,1,1,3],comment:'Comentário registrado.'}],legacy:[]},{
  age:'8 meses',sex:'Feminino',diagnosisOrTreatment:'Tratamento sintético',teamFactors:'Comunicação verbal',chartDisclosure:'Não'
 },'2026-12-28');
 assert.deepEqual(plan.items.slice(0,8).map(item=>item.rotulo),[
  'Data da ocorrência','Classificação do evento','Ocorrência','Descrição','Atendimento','Sexo','Idade','Diagnóstico ou Tratamento'
 ]);
 assert.match(prompt,/"rotulo": "Atendimento"[\s\S]*\[\[NUMERO_DO_ATENDIMENTO\]\]/);
 assert.match(prompt,/"valor": "Relato sintético"[\s\S]*"preparacaoPublicada": "Pré-análise aprovada"/);
 assert.match(prompt,/"Fatores contribuintes do time \(equipe\)\?",\s*"valor": "Comunicação verbal"/);
 assert.match(prompt,/"valor": "Feminino"[\s\S]*"valor": "8 meses"[\s\S]*"valor": "Tratamento sintético"/);
 assert.doesNotMatch(prompt,/IDENTIFICADOR NÃO EXPORTÁVEL/);
 const items=plan.items.map(({numero})=>({numero,analise:'Síntese da equipe '+numero+'.'}));
 const result=readAnalysisDraft(JSON.stringify({protocolo:'GRA 004',itens:items.reverse(),prazoSugerido:'01/01/2050',
  fundamentacaoAcao:'Conforme a avaliação da equipe.'}),'GRA 004',plan);
 assert.equal(result.dueDate,'2027-01-04');
 assert.match(result.text,/^1\. Data da ocorrência — Síntese da equipe 1\./);
 assert.match(result.text,/5\. Atendimento — \[\[NUMERO_DO_ATENDIMENTO\]\]/);
 assert.match(result.text,/AÇÕES DE MELHORIA\n1\. Rever supervisão\nVotação da equipe — 1 de 1 voto\.\nConforme a avaliação da equipe\.$/);
 assert.doesNotMatch(result.text,/Revisar protocolo|Melhorar comunicação|2050/);
 assert.throws(()=>readAnalysisDraft(JSON.stringify({protocolo:'GRA 004',itens:items.slice(1)}),'GRA 004',plan),
  /OCCURRENCE_ANALYSIS_ITEMS_INVALID/);
 const tied={...plan,priority:{action:null,total:2,votes:0,state:'tie'},dueDate:''};
 const tiedResult=readAnalysisDraft(JSON.stringify({protocolo:'GRA 004',itens:items}),'GRA 004',tied);
 assert.equal(tiedResult.dueDate,'');
 assert.match(tiedResult.text,/A votação terminou empatada/);
 assert.deepEqual(readAnalysisDraft(JSON.stringify({protocolo:'GRA 004',resultado:'Análise',prazoSugerido:'30/11/2026'}),'GRA 004'),
  {text:'Análise',dueDate:'2026-11-30'});
 assert.throws(()=>readAnalysisDraft(JSON.stringify({protocolo:'GRA 004',resultado:'Análise',prazoSugerido:'2026-02-30'}),'GRA 004'),
  /OCCURRENCE_ANALYSIS_DATE_INVALID/);
});

test('occurrence write failures never mention local queues or delayed synchronization',()=>{
 assert.match(occurrenceWriteFailureMessage(Object.assign(Error('offline'),{code:'online-required'})),/Conecte-se ao servidor/);
 assert.match(occurrenceWriteFailureMessage(Object.assign(Error('network'),{code:'write-unconfirmed'})),/nenhum reenvio foi agendado/);
 assert.doesNotMatch(occurrenceWriteFailureMessage(Error('other')),/fila|armazenad|aguardando sincronização/);
});

test('transient save failure is reported as unconfirmed and never queued',async()=>{
 const input={uid:'uid-a',recordId:'10000000-0000-4000-8000-000000000001',formId:'F01',values:{occurrence:'sintética'},displayName:'Pessoa sintética',anonymous:false,catalogs:{F01:['opção']}};
 await assert.rejects(submitOccurrenceWithFallback({repository:{save:async()=>{throw Error('OCCURRENCE_TRANSIENT_WRITE_FAILED');}},input,isCurrent:()=>true}),{code:'write-unconfirmed'});
});

test('permission denial and changed session never create an offline operation',async()=>{
 const input={uid:'uid-a',recordId:'10000000-0000-4000-8000-000000000001',formId:'F01',values:{occurrence:'sintética'},displayName:'Pessoa',anonymous:false};
 await assert.rejects(submitOccurrenceWithFallback({repository:{save:async()=>{throw Error('OCCURRENCE_PERMISSION_DENIED');}},input,isCurrent:()=>true}),/OCCURRENCE_PERMISSION_DENIED/);
 await assert.rejects(submitOccurrenceWithFallback({repository:{save:async()=>{throw Error('OCCURRENCE_TRANSIENT_WRITE_FAILED');}},input,isCurrent:()=>false}),/OCCURRENCE_SESSION_CHANGED/);
});

test('online confirmation succeeds without any queue or local storage',async()=>{
 const input={uid:'uid-a',recordId:'10000000-0000-4000-8000-000000000001',formId:'F01',values:{occurrence:'sintética'},displayName:'Pessoa',anonymous:false};
 const saved=await submitOccurrenceWithFallback({repository:{save:async()=>({status:'saved',id:input.recordId})},input,isCurrent:()=>true});
 assert.equal(saved.status,'saved');
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

test('a stalled FC catalogue expires and a new attempt can open without restarting',async()=>{
 let hang=true;const options={uid:'synthetic',isCurrent:()=>true,timeoutMs:20,repository:{loadCatalog:()=>hang?new Promise(()=>{}):Promise.resolve({catalogs:{ok:[]}})}};
 await assert.rejects(loadOccurrenceCatalogForSession(options),{code:'deadline-exceeded'});
 hang=false;assert.deepEqual(await loadOccurrenceCatalogForSession(options),{catalogs:{ok:[]}});
 assert.match(occurrenceCatalogErrorMessage({code:'deadline-exceeded'}),/novamente no formulário/);
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
