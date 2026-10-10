const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve,reject; const promise = new Promise((a,b) => {resolve = a;reject=b;}); return {promise,resolve,reject};};
async function harness({kind='events',pendingRead}={}) {
  const {createReportRuntime}=await import('../src/report-runtime.js');
  const {mergeReportPendingRecords}=await import('../src/report-pending.js');
  const nodes=new Map(), subscriptions=[], paints=[], stops=[], pendingReads=[], timers=new Map();
  let route=kind, renders=0, timerId=0;
  const element = extra=>({isConnected:true,innerHTML:'',textContent:'',disabled:false,querySelector:()=>null,replaceChildren(){this.innerHTML='';},append(){},classList:{values:new Set(),toggle(name,on){on?this.values.add(name):this.values.delete(name);}},...extra});
  for(const [module,prefix] of [['events','event'],['labels','label'],['checklist','checklist']]) {
    nodes.set('#'+prefix+'-report-dialog',element({open:module===kind}));
    nodes.set('#'+prefix+'-report-results',element());
    nodes.set('#'+prefix+'-report-day',element({value:'2026-10-02'}));
    nodes.set('#'+prefix+'-report-month',element({value:'2026-09'}));
    nodes.set('#'+prefix+'-report-sync',element());
  }
  nodes.set('#module-content',element()); nodes.set('#checklist-month',element({value:'2026-09'}));
  const ctx=vm.createContext({
    session:{status:'signed-in',user:{uid:'user-a'},profile:{displayName:'Pessoa fictícia A',sigla:'AA',role:'administrador_app',active:true,access:true,permissions:{admin:true,eventsRead:true,eventsWrite:true,labelsRead:true,labelsWrite:true,labelsManage:true,checklistRead:true,checklistWrite:true,checklistSign:true,checklistManage:true}}},
    cleanupCurrentModule:null,evaluationModuleGeneration:0,
    appFeatures:{events:true,labels:true,checklist:true}, appFeaturesUid:'user-a', appFeaturesLoadSequence:0, DEFAULT_APP_FEATURES:{events:true,labels:true,checklist:true},
    currentRoute:()=>route, featureEnabledForRoute:(value,features)=>features[value]!==false,
    eventReportMode:'daily',labelReportMode:'daily',checklistReportMode:'daily',eventReportCursor:null,labelReportCursor:null,
    eventReportSourceRecords:[],eventReportStale:false,loadedEventReportRecords:[],loadedLabelRecords:[],checklistReportContext:null,
    navigator:{onLine:true}, document:{querySelector:selector=>nodes.get(selector)||null,createElement:()=>element({dataset:{}})},
    todayInputValue:()=> '2026-10-02', escapeHtml:String, createReportRuntime, mergeReportPendingRecords,
    listUnsettledOperations:async uid=>{pendingReads.push(uid);return pendingRead?pendingRead.promise:[];},
    startupReports:{takeLive:()=>null,clear(){},holdLive(){}},
    fakeSubscribe:(module,scope,hooks)=>{const index=subscriptions.length;subscriptions.push({kind:module,scope,hooks});return()=>stops.push(index);},
    renderEventReportRecords:()=>paints.push({kind:'events',records:[...ctx.eventReportSourceRecords]}),
    renderLiveLabelReport:(data,scope)=>paints.push({kind:'labels',data,scope}),
    loadDailyChecklist:(stations,day,data,scope)=>paints.push({kind:'checklist',stations,day,data,scope}),
    loadMonthlyChecklist:(stations,data,scope)=>paints.push({kind:'checklist',stations,data,scope}),
    setTimeout:callback=>{const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
    startupBannerActive:false,notice:'',labelManualConfirmation:{},scheduleOutboxRetry(){},preloadStartupReports(){},preloadOperationalDataWhenIdle(){},syncOutbox(){},
    render:async()=>{renders++;}, normalizeAppFeatures:features=>({...features}),mockLite:{readAppFeatures:async()=>({...ctx.appFeatures})},console
  });
  ctx.can=permission=>ctx.session.status==='signed-in'&&ctx.session.profile.active!==false&&ctx.session.profile.access!==false&&ctx.session.profile.permissions?.[permission]===true;
  let helpers=source.slice(source.indexOf('// Report state is transient'),source.indexOf('const preloadedDataUsers ='));
  helpers=helpers.replace('subscribe: subscribeLiveReport,','subscribe: fakeSubscribe,');
  vm.runInContext(helpers+'\nglobalThis.testReports={liveReports,reportStates,reportPayloads,reportWaiters,reportPaintKeys,setContext:value=>checklistReportContext=value,setResponsibility:value=>checklistResponsibilityLive=value,getContext:()=>checklistReportContext};',ctx);
  const sessions=source.slice(source.indexOf('function sessionChanged('),source.indexOf("window.addEventListener('hashchange'"));
  vm.runInContext(sessions.replaceAll("await import('./data-lite.js')",'mockLite'),ctx);
  const next=(data,{index=subscriptions.length-1,sourceKey='report',...metadata}={})=>subscriptions[index].hooks.next(sourceKey,{data,complete:true,fromCache:false,hasPendingWrites:false,...metadata});
  const payload=(id,fields={})=>({records:id?[{id,date:'2026-10-02',active:true,version:1,createdByUid:'user-a',...fields}]:[],nextCursor:null});
  const close=()=>ctx.testReports.liveReports.clear('test-end');
  return {ctx,nodes,subscriptions,paints,stops,pendingReads,next,payload,close,route:value=>{route=value;},renders:()=>renders};
}

test('integração main: dia A → B descarta A atrasado e encerra o listener antes de consultar B',async()=>{
  const h=await harness();
  const a=h.ctx.startReportLive('events'); await settle();
  h.nodes.get('#event-report-day').value='2026-10-01';
  const b=h.ctx.startReportLive('events'); await settle();
  assert.deepEqual(h.stops,[0]); assert.equal(h.subscriptions[1].scope.from,'2026-10-01');
  h.next(h.payload('B',{date:'2026-10-01'}),{index:1}); assert.equal(await b,true); assert.equal(await a,false);
  h.next(h.payload('A'),{index:0});
  assert.equal(h.paints.at(-1).records[0].id,'B'); assert.equal(h.paints.some(p=>p.records?.[0]?.id==='A'),false);
  h.close();
});

test('integração main: saída da rota, troca de usuário e revogação invalidam snapshots do dono anterior',async()=>{
  for(const mutation of [h=>h.route('labels'),h=>{h.ctx.session.user.uid='user-b';},h=>{h.ctx.session.profile.permissions.eventsRead=false;h.ctx.session.profile.permissions.eventsWrite=false;}]) {
    const h=await harness(); const open=h.ctx.startReportLive('events');await settle();
    const scope=h.subscriptions[0].scope;mutation(h); assert.equal(h.ctx.reportScopeCurrent(scope),false);
    h.next(h.payload('privado'));assert.equal(h.paints.length,0); assert.deepEqual(h.stops,[0]);h.close();
    // A closed scope settles through closeReportLive without leaking stale data.
    h.ctx.closeReportLive('events');assert.equal(await open,false);
  }
});

test('integração main: mês escolhido governa período mensal de Eventos, Etiquetas e Checklist',async()=>{
  for(const kind of ['events','labels','checklist']) {
    const h=await harness({kind});h.ctx[kind==='events'?'eventReportMode':kind==='labels'?'labelReportMode':'checklistReportMode']='monthly';
    const scope=h.ctx.makeReportScope(kind);assert.equal(scope.from,'2026-09-01');assert.equal(scope.to,'2026-09-30');assert.equal(scope.month,'2026-09');
    assert.equal(h.ctx.reportScopeCurrent(scope),true);h.close();
  }
});

test('integração main: confirmação verde aguarda servidor e leitura da fila offline',async()=>{
  const pending=deferred(),h=await harness({pendingRead:pending});const open=h.ctx.startReportLive('events');await settle();
  const indicator=h.nodes.get('#event-report-sync');
  h.next(h.payload('item'));assert.equal(indicator.classList.values.has('label-report-sync--synced'),false);
  assert.match(indicator.textContent,/pendentes|Atualizando/);
  pending.resolve([]);await settle();assert.equal(await open,true);
  assert.equal(indicator.classList.values.has('label-report-sync--synced'),true);assert.match(indicator.textContent,/Confirmado pelo servidor/);
  h.next(h.payload('item'),{fromCache:true});assert.equal(indicator.classList.values.has('label-report-sync--synced'),false);
  h.next(h.payload('item',{hasPendingWrites:true}),{hasPendingWrites:true});assert.equal(indicator.classList.values.has('label-report-sync--synced'),false);assert.match(indicator.textContent,/pendentes/);
  h.ctx.testReports.liveReports.setOnline(false);assert.match(indicator.textContent,/Sem conexão/);h.close();
});

test('integração main: Checklist incompleto ou catálogo pendente nunca confirma nem permite assinatura',async()=>{
  const h=await harness({kind:'checklist'});const open=h.ctx.startReportLive('checklist');await settle();
  const catalog={records:[{id:'arsenal',order:1}],truncated:false},report={records:[],priorRecords:[],nextCursor:null,historyIncomplete:true,truncated:false};
  h.next(catalog,{sourceKey:'catalog'});h.next(report);await open;
  const scope=h.subscriptions[0].scope,indicator=h.nodes.get('#checklist-report-sync');
  h.ctx.testReports.setContext({fingerprint:'current'});h.ctx.testReports.setResponsibility({key:scope.key,confirmed:true,responsible:{name:'Pessoa fictícia'}});
  assert.equal(indicator.classList.values.has('label-report-sync--synced'),false);assert.equal(h.ctx.checklistSignatureCurrent(scope,'current'),false);
  h.next({...report,historyIncomplete:false});assert.equal(indicator.classList.values.has('label-report-sync--synced'),true);assert.equal(h.ctx.checklistSignatureCurrent(scope,'current'),true);
  h.next(catalog,{sourceKey:'catalog',hasPendingWrites:true});assert.equal(indicator.classList.values.has('label-report-sync--synced'),false);assert.equal(h.ctx.checklistSignatureCurrent(scope,'current'),false);
  h.next({...catalog,truncated:true},{sourceKey:'catalog'});assert.equal(h.ctx.checklistSignatureCurrent(scope,'current'),false);h.close();
});

test('integração main: ciência preparada exige o mesmo conteúdo, sem depender do nome do rodízio',async()=>{
  const h=await harness({kind:'checklist'});const open=h.ctx.startReportLive('checklist');await settle();
  h.next({records:[],truncated:false},{sourceKey:'catalog'});h.next({records:[],priorRecords:[],historyIncomplete:false,truncated:false});await open;
  const scope=h.subscriptions[0].scope, responsible={name:'Pessoa fictícia A'};
  h.ctx.testReports.setContext({fingerprint:'before'});h.ctx.testReports.setResponsibility({key:scope.key,confirmed:true,responsible});
  const signature=h.ctx.reportFingerprint(responsible);assert.equal(h.ctx.checklistSignatureCurrent(scope,'before',signature),true);
  h.ctx.testReports.setContext({fingerprint:'after'});assert.equal(h.ctx.checklistSignatureCurrent(scope,'before',signature),false);
  h.ctx.testReports.setContext({fingerprint:'before'});h.ctx.testReports.setResponsibility({key:scope.key,confirmed:true,responsible:{name:'Pessoa fictícia B'}});
  assert.equal(h.ctx.checklistSignatureCurrent(scope,'before',signature),true);h.close();
});

test('integração main: append aumenta janela sem apagar cartões; reload mantém tamanho já carregado',async()=>{
  const h=await harness();const a=h.ctx.startReportLive('events');await settle();h.next({...h.payload('first'),nextCursor:{nextLimit:200}});await a;
  const target=h.nodes.get('#event-report-results');target.innerHTML='cartões preservados';
  const b=h.ctx.startReportLive('events',{append:true});await settle();
  assert.equal(h.subscriptions[1].scope.loadedLimit,200);assert.equal(target.innerHTML,'cartões preservados');
  h.next({...h.payload('second'),nextCursor:{nextLimit:300}});await b;
  assert.equal(h.ctx.makeReportScope('events').loadedLimit,200);assert.equal(h.ctx.makeReportScope('events',{append:true}).loadedLimit,300);h.close();
});

test('integração main: snapshots idênticos não refazem cartões e exclusão remove o item da projeção',async()=>{
  const h=await harness();const a=h.ctx.startReportLive('events');await settle();h.next(h.payload('item'));await a;
  const count=h.paints.length;h.next(h.payload('item'));assert.equal(h.paints.length,count);
  h.next(h.payload(null));assert.equal(h.paints.at(-1).records.length,0);h.close();
});

test('integração main: primeiro perfil idêntico e configuração repetida preservam a tela e o listener',async()=>{
  const h=await harness();const a=h.ctx.startReportLive('events');await settle();h.next(h.payload('item'));await a;
  const before=h.renders(),session=JSON.parse(JSON.stringify(h.ctx.session));
  h.ctx.sessionChanged(session);await h.ctx.refreshAppFeatures('user-a',true);
  assert.equal(h.renders(),before);assert.equal(h.subscriptions.length,1);assert.deepEqual(h.stops,[]);
  const revoked=JSON.parse(JSON.stringify(h.ctx.session));revoked.profile.permissions.eventsRead=false;revoked.profile.permissions.eventsWrite=false;
  h.ctx.sessionChanged(revoked);assert.equal(h.renders(),before+1);assert.equal(h.ctx.reportScopeCurrent(h.subscriptions[0].scope),false);
  h.ctx.testReports.liveReports.get('events');assert.deepEqual(h.stops,[0]);h.close();
});

test('integração main: pré-carga do dia atual transfere o mesmo listener ao relatório sem consulta duplicada',async()=>{
  const h=await harness(); const warm=h.ctx.makeReportScope('events',{warm:true});
  const lease=h.ctx.testReports.liveReports.warm('events',warm);await settle();h.next(h.payload('pré-carregado'));
  assert.equal(h.paints.length,0);assert.equal(h.subscriptions.length,1);
  const open=h.ctx.startReportLive('events');assert.equal(h.subscriptions.length,1);assert.equal(await open,true);
  assert.equal(h.subscriptions.length,1);assert.equal(h.pendingReads.length,1);assert.equal(h.paints.at(-1).records[0].id,'pré-carregado');
  lease.close();assert.deepEqual(h.stops,[]);h.close();
});

async function signatureHarness() {
  const h=await harness({kind:'checklist'}),waiting=deferred();
  const open=h.ctx.startReportLive('checklist');await settle();
  const stations=[{id:'arsenal-fictício',name:'Arsenal fictício',active:true,order:1}],result={records:[],priorRecords:[],historyIncomplete:false,truncated:false};
  h.next({records:stations,truncated:false},{sourceKey:'catalog'});h.next(result);await open;
  const scope=h.subscriptions[0].scope;
  h.ctx.testReports.setResponsibility({key:scope.key,confirmed:true,responsible:{name:'Responsável fictício'}});
  const small=()=>({isConnected:true,disabled:false,textContent:'',innerHTML:'',focus(){},querySelector:()=>null,addEventListener(){}});
  for(const selector of ['#checklist-signature-prepare','#checklist-signature-status','#checklist-signature-preview','#checklist-responsible-name','#checklist-confirmation-title']) h.nodes.set(selector,small());
  const dialog=small();dialog.open=false;dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};h.nodes.set('#checklist-confirmation-dialog',dialog);
  const content=h.nodes.get('#module-content');content.querySelector=selector=>h.nodes.get(selector)||null;content.querySelectorAll=()=>[];
  Object.assign(h.ctx,{checklistDayMode:()=> 'today', stationIsInDateRange:()=>true,stationIsValidOn:()=>true,summarizeChecklistDay:()=>({}),resolveChecklistDayRecord:()=>null,sortChecklistStationsForDisplay:value=>[...value],
    checklistArsenalFunction:()=>'',checklistArsenalButtonLabel:station=>station.name,interactionDateTime:String,formatRecordDate:String,reconcileReportMarkup:(target,html)=>{target.innerHTML=html;},
    mockSignature:{getChecklistSignaturePreview:()=>waiting.promise}});
  const daily=source.slice(source.indexOf('async function loadDailyChecklist('),source.indexOf('function revealChecklistStation(')).replaceAll("await import('./checklist-signature.js')",'mockSignature');
  vm.runInContext(daily,h.ctx);await h.ctx.loadDailyChecklist(stations,scope.day,result,scope);
  return {...h,scope,waiting,prepare:h.nodes.get('#checklist-signature-prepare'),status:h.nodes.get('#checklist-signature-status'),preview:h.nodes.get('#checklist-signature-preview'),dialog};
}

test('integração main: erro tardio de preview não apaga rascunho nem aviso da revisão nova',async()=>{
  const h=await signatureHarness();const pending=h.prepare.onclick();
  h.preview.innerHTML='Justificativa preservada';h.ctx.testReports.setContext({fingerprint:'outra revisão'});
  h.ctx.invalidateChecklistSignature('O relatório mudou. Revise a revisão nova.');
  h.waiting.reject(new Error('Falha da consulta antiga'));await pending;
  assert.equal(h.status.textContent,'O relatório mudou. Revise a revisão nova.');assert.equal(h.preview.innerHTML,'Justificativa preservada');assert.equal(h.prepare.disabled,true);h.close();
});

test('integração main: preview sem ownership não substitui rascunho mesmo na mesma revisão',async()=>{
  const h=await signatureHarness();const pending=h.prepare.onclick();
  h.dialog._checklistSignatureRequest={};h.preview.innerHTML='Rascunho da consulta nova';h.status.textContent='Consulta nova';
  h.waiting.resolve({requestStatus:'PENDING_VALIDATION'});await pending;
  assert.equal(h.preview.innerHTML,'Rascunho da consulta nova');assert.equal(h.status.textContent,'Consulta nova');h.close();
});

function catalogAdapterHarness({catalogGate, scopeOwned=true}={}) {
  const stations=Array.from({length:28},(_,index)=>({id:'fictício-'+String(index+1).padStart(2,'0'),name:'Arsenal fictício '+(index+1),active:true,order:index+1}));
  const ids=stations.map(station=>station.id).sort(),initial={stationIds:ids,records:[{id:'safe-answer',stationId:ids[0],condition:'NAO',date:'2026-10-02'}],priorRecords:[]};
  const catalogs=[],reports=[],events=[],writes=[],reads=[],stops=[];let owned=scopeOwned;
  const ctx=vm.createContext({
    checklistCatalogLive:null,checklistResponsibilityLive:null,stationIsInDateRange:()=>true,can:()=>false,
    mockCatalog:{watchChecklistStations:async(next,error)=>{catalogs.push({next,error});return()=>stops.push('catalog');}},
    mockChecklist:{watchChecklistReport:async(options,next,error)=>{const index=reports.length;reports.push({options,next,error});return()=>stops.push('report:'+index);}},
    mockCache:{readSafeCache:async(uid,type,key)=>{reads.push({uid,type,key});return type==='stations'?(catalogGate?catalogGate.promise:{data:stations}):{data:initial};},writeSafeCache:async(uid,type,key,data)=>{writes.push({uid,type,key,data});}},
    reportFingerprint:JSON.stringify,invalidateChecklistSignature(){},updateChecklistResponsibilityUI(){}
  });
  let adapter=source.slice(source.indexOf('async function subscribeLiveReport('),source.indexOf('function receiveLiveReport('));
  adapter=adapter.replaceAll("import('./report-live-data.js')",'Promise.resolve(mockCatalog)').replaceAll("import('./checklist-report-listener.js')",'Promise.resolve(mockChecklist)').replaceAll("import('./outbox.js')",'Promise.resolve(mockCache)');
  vm.runInContext(adapter,ctx);
  const scope={kind:'checklist',module:'checklist',key:'checklist:user-a:today',uid:'user-a',day:'2026-10-02',mode:'daily',isAdmin:false,from:'2026-10-02',to:'2026-10-02',pageSize:1000};
  const subscribe=()=>ctx.subscribeLiveReport('checklist',scope,{isCurrent:()=>owned,next:(key,event)=>events.push({key,event}),error:error=>{throw error;}});
  const emit=(records=[],metadata={})=>catalogs[0].next({records,fromCache:true,hasPendingWrites:false,truncated:false,serverConfirmed:false,...metadata});
  return {ctx,scope,stations,ids,initial,catalogs,reports,events,writes,reads,stops,subscribe,emit,revoke:()=>{owned=false;},lastCatalog:()=>events.filter(item=>item.key==='catalog').at(-1)?.event};
}

test('adapter real Checklist: primeiro cache de memória vazio preserva os 28 arsenais e as respostas do cache seguro',async()=>{
  const h=catalogAdapterHarness(),close=await h.subscribe();h.emit();await settle();
  const catalog=h.lastCatalog();assert.equal(catalog.data.records.length,28);assert.equal(catalog.fromCache,true);assert.equal(catalog.data.serverConfirmed,false);
  assert.deepEqual(Array.from(h.reports[0].options.stationIds),h.ids);assert.equal(h.reports[0].options.initial.records[0].id,'safe-answer');
  assert.equal(h.writes.length,0);assert.deepEqual(h.reads,[{uid:'user-a',type:'stations',key:'all'},{uid:'user-a',type:'checklists',key:'2026-10-02'}]);close();
});

test('adapter real Checklist: catálogo vazio confirmado no servidor substitui baseline e encerra históricos antigos',async()=>{
  const h=catalogAdapterHarness(),close=await h.subscribe();h.emit();await settle();
  h.emit([],{fromCache:false,serverConfirmed:true});await settle();
  assert.equal(h.lastCatalog().data.records.length,0);assert.equal(h.lastCatalog().fromCache,false);
  assert.deepEqual(Array.from(h.reports.at(-1).options.stationIds),[]);assert.ok(h.stops.includes('report:0'));
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].data.length,0);close();
});

test('adapter real Checklist: grava cache seguro apenas de catálogo confirmado, completo e sem writes locais',async()=>{
  const h=catalogAdapterHarness(),close=await h.subscribe();
  h.emit(h.stations);await settle();assert.equal(h.writes.length,0);
  h.emit(h.stations,{fromCache:false,hasPendingWrites:true});await settle();assert.equal(h.writes.length,0);
  h.emit(h.stations,{fromCache:false,truncated:true});await settle();assert.equal(h.writes.length,0);
  h.emit(h.stations,{fromCache:false,serverConfirmed:true});await settle();assert.equal(h.writes.length,1);
  h.emit(h.stations,{fromCache:false,serverConfirmed:true});await settle();assert.equal(h.writes.length,1);
  close();h.emit([],{fromCache:false,serverConfirmed:true});await settle();assert.equal(h.writes.length,1);
});

test('adapter real Checklist: fechamento enquanto cache seguro aguarda não instala consultas da sessão antiga',async()=>{
  const gate=deferred(),h=catalogAdapterHarness({catalogGate:gate});const attaching=h.subscribe();await settle();
  h.revoke();gate.resolve({data:h.stations});const close=await attaching;
  assert.equal(h.catalogs.length,0);assert.equal(h.reports.length,0);assert.equal(h.events.length,0);assert.equal(h.writes.length,0);close();
});

test('integração main: render ao sair de Etiquetas elimina dados transitórios mesmo se runtime já encerrou o listener',async()=>{
  const h=await harness({kind:'labels'}),opening=h.ctx.startReportLive('labels');await settle();
  h.next(h.payload('etiqueta-fictícia',{patientName:'Pessoa fictícia sem dados reais'}));await opening;
  h.ctx.loadedLabelRecords=[{patientName:'Pessoa fictícia sem dados reais'}];assert.equal(h.ctx.testReports.reportPayloads.has('labels'),true);
  h.route('checklist');h.ctx.testReports.liveReports.get('labels');assert.deepEqual(h.stops,[0]);
  const start=source.indexOf('async function render() {'),end=source.indexOf('  labelReportLoad++;',start);
  vm.runInContext(source.slice(start,end)+'\n}',h.ctx);await h.ctx.render();
  assert.equal(h.ctx.testReports.reportPayloads.has('labels'),false);assert.equal(h.ctx.testReports.reportPaintKeys.has('labels'),false);assert.equal(h.ctx.testReports.reportStates.has('labels'),false);assert.equal(h.ctx.loadedLabelRecords.length,0);h.close();
});


test('Checklist: indicador fica na faixa da data sem ocupar a linha expansível dos arsenais',()=>{
  const shell=source.slice(source.indexOf('function shellView()'),source.indexOf('async function loadHome()')).replaceAll('import.meta.env.BASE_URL',"'/SAHMT-V2.0.github.io/'");
  for(const mode of ['daily','monthly'])for(const write of [true,false]) {
    const context=vm.createContext({currentRoute:()=> 'checklist',session:{profile:{displayName:'Pessoa fictícia'},user:{uid:'fixture',displayName:'Pessoa fictícia'}},labels:{checklist:['Checklist','']},can:permission=>permission!=='checklistWrite'||write,todayInputValue:()=> '2026-10-02',escapeHtml:String,checklistReportMode:mode,notice:''});
    vm.runInContext(shell,context);const html=context.shellView();
    const dialog=html.slice(html.indexOf('<dialog class="checklist-report-dialog"'),html.indexOf('</dialog>',html.indexOf('<dialog class="checklist-report-dialog"'))+9);
    const root={children:[]},stack=[root],voidTags=new Set(['input','img','br','hr','meta','link']);let indicator;
    for(const match of dialog.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi)) {
      const [,close,tag,attrs]=match;
      if(close){stack.pop();continue;}
      const node={tag,attrs,children:[],parent:stack.at(-1)};node.parent.children.push(node);
      if(attrs.includes('id="checklist-report-sync"'))indicator=node;
      if(!voidTags.has(tag)&&!attrs.endsWith('/'))stack.push(node);
    }
    assert.deepEqual(root.children[0].children.map(node=>node.tag),['header','div','div','footer']);
    assert.match(indicator.parent.attrs,/class="checklist-report-periods"/);
    assert.doesNotMatch(indicator.parent.attrs,/\bhidden\b/);
    const direct=root.children[0].children;
    assert.match(direct[2].attrs,/id="module-content"/);
    assert.equal((html.match(/data-checklist-report-launch="/g)||[]).length,2);
    assert.equal(html.includes('id="checklist-scan-qr"'),write);
  }
});

 test('ciência permite qualquer elegível sem aguardar responsável ou rodízio', async()=>{
 const h=await harness({kind:'checklist'}),open=h.ctx.startReportLive('checklist');await settle();
 h.next({records:[],truncated:false},{sourceKey:'catalog'});h.next({records:[],priorRecords:[],historyIncomplete:false,truncated:false});await open;
 const scope=h.subscriptions[0].scope;h.ctx.testReports.setContext({fingerprint:'current'});h.ctx.testReports.setResponsibility(null);
 assert.equal(h.ctx.checklistSignatureCurrent(scope,'current'),true);
 h.ctx.session.profile.permissions.checklistSign=false;
 assert.equal(h.ctx.checklistSignatureCurrent(scope,'current'),false);h.close();
 });
