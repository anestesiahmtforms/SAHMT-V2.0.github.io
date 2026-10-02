const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
// Optional candidate is used only before the isolated integration script is applied.
const main = readFileSync(process.env.SAHMT_LABEL_REALTIME_CANDIDATE || join(__dirname, '../src/main.js'), 'utf8');
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function flush() {return new Promise(resolve => setImmediate(resolve));}
function element(dataset = {}) {
  return {dataset, isConnected:true, hidden:true, innerHTML:'', textContent:'', disabled:false, attributes:{},
    setAttribute(name,value) {this.attributes[name]=String(value);}, getAttribute(name) {return this.attributes[name] ?? null;}};
}
function setup({online = true, mode = 'daily', history = async () => []} = {}) {
  const cards = new Map(), edit = new Map(), panels = new Map(), historyButtons = new Map();
  const target = element(); const pdf=element(), csv=element(); const sync={confirmed:false};
  const morphs=[], edits=[], starts=[], queries=[], syncCalls=[];
  let current=true, coordinatorState={confirmed:false,state:'awaiting'};
  const targetSelector = (selector) => {
    if (selector === '#label-report-more') return target.more || null;
    const match=/^\[data-label-(history-content|history|record|edit)="([^"]+)"\]$/.exec(selector);
    if (!match) return null;
    return ({'history-content':panels, history:historyButtons, record:cards, edit})[match[1]].get(match[2]) || null;
  };
  target.querySelector=targetSelector;
  target.querySelectorAll=selector => selector === '[data-label-record]' ? [...cards.values()] : selector === '[data-label-edit]' ? [...edit.values()] : selector === '[data-label-history]' ? [...historyButtons.values()] : selector === '[data-label-history-content]' ? [...panels.values()] : [];
  const reconcile=(node,html,options) => {
    morphs.push({node,html,options}); node.innerHTML=html;
    const found=new Set();
    for (const match of html.matchAll(/<li\b[^>]*data-label-record="([^"]+)"[^>]*data-record-version="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)) {
      const [,id,version,body]=match; found.add(id);
      const card=cards.get(id) || element({labelRecord:id}); card.dataset.recordVersion=version; cards.set(id,card);
      if (body.includes('data-label-edit=')) {edit.set(id,edit.get(id) || element({labelEdit:id}));}
      else {if (edit.has(id)) edit.get(id).isConnected=false; edit.delete(id);}
      if (body.includes('data-label-history=')) {
        const button=historyButtons.get(id) || element({labelHistory:id});
        const panel=panels.get(id) || element({labelHistoryContent:id});
        if (!options.preserveSelectors.length) {panel.innerHTML='';panel.hidden=true;button.setAttribute('aria-expanded','false');button.textContent='Histórico';}
        else if (button.getAttribute('aria-expanded') !== 'true') {button.setAttribute('aria-expanded','false');button.textContent='Histórico';}
        panels.set(id,panel);historyButtons.set(id,button);
      } else {
        if (panels.has(id)) panels.get(id).isConnected=false;
        if (historyButtons.has(id)) historyButtons.get(id).isConnected=false;
        panels.delete(id);historyButtons.delete(id);
      }
    }
    for (const map of [cards,edit,panels,historyButtons]) for (const [id,item] of map) if (!found.has(id)) {item.isConnected=false;map.delete(id);}
    const hasMore=html.includes('id="label-report-more"');
    if (hasMore) {target.more ||= element();target.more.disabled=!online;} else {if(target.more)target.more.isConnected=false;target.more=null;}
  };
  const scope={key:'labels:user-1:2026-10-01:read',uid:'user-1',mode,day:'2026-10-01',month:'2026-10',from:'2026-10-01',to:'2026-10-01',sigla:'FA',canWrite:true,canManage:false,isAdmin:false,targetNode:target};
  const ctx=vm.createContext({
    Promise,Error,Map,Set,navigator:{onLine:online},CSS:{escape:String},
    labelReportState:'synced',labelReportLoad:0,labelReportMode:mode,labelReportCursor:null,labelReportLoadingMore:false,loadedLabelRecords:[],
    session:{user:{uid:'user-1'},profile:{sigla:'FA'}},
    document:{querySelector:selector => selector === '#label-report-results' ? target : selector === '#share-labels-pdf' ? pdf : selector === '#export-labels' ? csv : null},
    escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),formatRecordDate:String,
    reportTimestamp:value=>Number(value)||0,reconcileReportMarkup:reconcile,
    reportScopeCurrent:value=>current && value.uid===ctx.session.user?.uid && value.key===scope.key,
    startReportLive:(kind,options)=>{starts.push({kind,options});return Promise.resolve(true);},
    updateReportSync:kind=>{syncCalls.push(kind);sync.confirmed=coordinatorState.confirmed;sync.state=coordinatorState.state;},
    beginLabelEdit:item=>edits.push(item),renderRecordEditHistory:value=>JSON.stringify(value),
    mockData:{listLabelHistory:id=>{queries.push(id);return history(id);}}
  });
  const start=main.indexOf('function updateLabelReportSync() {'), end=main.indexOf('function beginLabelEdit',start);
  const block=main.slice(start,end).replaceAll("await import('./data.js')",'mockData');
  assert.match(block,/function renderLiveLabelReport\(result, scope\)/,'Etiquetas precisa ser integrado pelo script isolado antes desta regressão.');
  vm.runInContext(block,ctx);
  return {ctx,target,pdf,csv,sync,scope,cards,edit,panels,historyButtons,morphs,edits,starts,queries,syncCalls,
    render:(records=[],extra={},override=scope)=>ctx.renderLiveLabelReport({records,nextCursor:null,...extra},override),
    load:options=>ctx.loadLabelReport(options),setCurrent:value=>current=value,setState:value=>coordinatorState=value};
}
function record(id='fictional-1',extra={}) {return {id,date:'2026-10-01',patientName:'PACIENTE FICTÍCIO',createdByUid:'user-1',createdByName:'Pessoa Fictícia',staffSiglas:['FA'],version:1,createdAt:10,...extra};}

test('abertura e paginação delegam ao coordenador sem criar consulta paralela',async()=>{
  const {load,starts}=setup();const options={append:true};
  assert.equal(await load(),true);assert.equal(await load(options),true);
  assert.equal(starts.length,2);assert.equal(starts[0].kind,'labels');assert.equal(starts[1].options,options);
  const block=main.slice(main.indexOf('async function loadLabelReport'),main.indexOf('function beginLabelEdit'));
  assert.doesNotMatch(block,/listLabelRecords|startupReports\.take|withLabelReportDeadline|labelReportState\s*=\s*'synced'/);
});

test('wrapper preserva retorno false do coordenador e retry explícito',async()=>{
  const {ctx,load}=setup();const calls=[];ctx.startReportLive=(kind,options)=>{calls.push({kind,options});return Promise.resolve(false);};
  const options={retry:true};assert.equal(await load(options),false);assert.equal(calls[0].options,options);
});

test('renderer não transforma estado legado synced em confirmação antes de metadata servidor',()=>{
  const {render,sync,setState,syncCalls}=setup();render([]);assert.equal(sync.confirmed,false);
  setState({confirmed:true,state:'server'});render([]);assert.equal(sync.confirmed,true);
  setState({confirmed:false,state:'pending'});render([]);assert.equal(sync.confirmed,false);
  assert.deepEqual(syncCalls,['labels','labels','labels']);
});

test('resposta antiga não altera registros, cursor ou DOM após mudar UID, período ou container',()=>{
  const fixture=setup();fixture.render([record('new')],{nextCursor:{nextLimit:100}});const count=fixture.morphs.length;
  fixture.setCurrent(false);assert.equal(fixture.render([record('old')]),false);
  fixture.setCurrent(true);fixture.ctx.session.user.uid='other';assert.equal(fixture.render([record('old')]),false);
  fixture.ctx.session.user.uid='user-1';assert.equal(fixture.render([record('old')],{}, {...fixture.scope,targetNode:element()}),false);
  fixture.target.isConnected=false;assert.equal(fixture.render([record('old')]),false);
  assert.equal(fixture.morphs.length,count);assert.equal(fixture.ctx.loadedLabelRecords[0].id,'new');assert.equal(fixture.ctx.labelReportCursor.nextLimit,100);
});

test('registros exibidos possuem keys estáveis nos modos diário e mensal',()=>{
  for(const mode of ['daily','monthly']){const {render,target}=setup({mode});render([record()]);assert.match(target.innerHTML,/data-label-record="fictional-1"/);assert.match(target.innerHTML,/data-record-version="1"/);}
});

test('PDF e CSV excluem pendências, recusas e metadata de gravação não confirmada',()=>{
  const {render,ctx,pdf,csv,target}=setup();
  render([record('good'),record('queued',{pendingFirestore:true}),record('pending-edit',{pendingEdit:true}),record('failed',{syncFailed:true}),record('local',{hasPendingWrites:true})]);
  assert.equal(ctx.loadedLabelRecords.length,1);assert.equal(ctx.loadedLabelRecords[0].id,'good');assert.equal(pdf.disabled,false);assert.equal(csv.disabled,false);
  assert.match(target.innerHTML,/Aguardando confirmação do Firestore/);assert.match(target.innerHTML,/Registro não confirmado/);
  render([record('queued',{pendingFirestore:true})]);assert.equal(pdf.disabled,true);assert.equal(csv.disabled,true);
});

test('edição mantém autorização por autor, plantonista ou labelsManage sem exigir admin',()=>{
  const f=setup();f.render([record('own',{staffSiglas:[]}),record('staff',{createdByUid:'another'}),record('other',{createdByUid:'another',staffSiglas:['DN']})]);
  assert.equal(f.edit.has('own'),true);assert.equal(f.edit.has('staff'),true);assert.equal(f.edit.has('other'),false);
  f.scope.canManage=true;f.render([record('other',{createdByUid:'another',staffSiglas:['DN']})]);assert.equal(f.edit.has('other'),true);
  f.scope.canManage=false;f.scope.canWrite=false;f.render([record('own')]);assert.equal(f.edit.has('own'),false);
});

test('metadata repetida atualiza onclick sem duplicar handlers e edição usa versão atual',()=>{
  const f=setup();f.render([record()]);const button=f.edit.get('fictional-1');const first=button.onclick;
  f.render([record('fictional-1',{version:2})]);assert.equal(f.edit.get('fictional-1'),button);assert.notEqual(button.onclick,first);
  button.onclick();assert.equal(f.edits.length,1);assert.equal(f.edits[0].version,2);
  f.setCurrent(false);button.onclick();assert.equal(f.edits.length,1);
});

test('botão carregar mais cresce listener por coordenador e ignora escopo antigo/offline',async()=>{
  const f=setup();f.render([record()],{nextCursor:{nextLimit:100}});const button=f.target.more;
  button.onclick();await flush();assert.equal(f.starts.length,1);assert.equal(f.starts[0].options.append,true);assert.equal(button.disabled,true);
  f.setCurrent(false);button.onclick();assert.equal(f.starts.length,1);
  f.setCurrent(true);f.ctx.navigator.onLine=false;button.onclick();assert.equal(f.starts.length,1);
});

test('histórico fica preservado e metadata sem versão nova não repete GET',async()=>{
  const f=setup({history:async()=>[{actorName:'Pessoa Fictícia',changedFields:['amount']}]});f.render([record()]);
  const button=f.historyButtons.get('fictional-1'),panel=f.panels.get('fictional-1');button.onclick();await flush();
  assert.equal(f.queries.length,1);assert.equal(panel.hidden,false);assert.equal(panel.dataset.historyLoaded,'true');
  f.render([record()]);assert.equal(f.panels.get('fictional-1'),panel);assert.equal(panel.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(f.queries.length,1);
  assert.deepEqual(Array.from(f.morphs.at(-1).options.preserveSelectors),['[data-label-history-content]','[data-label-history][aria-expanded="true"]']);
  button.onclick();button.onclick();await flush();assert.equal(f.queries.length,1);
});

test('edição externa invalida apenas histórico daquele registro e recarrega painel aberto',async()=>{
  const f=setup();f.render([record('a'),record('b')]);f.historyButtons.get('a').onclick();f.historyButtons.get('b').onclick();await flush();assert.equal(f.queries.length,2);
  f.render([record('a',{version:2}),record('b')]);await flush();assert.deepEqual(f.queries,['a','b','a']);
  assert.equal(f.panels.get('a').hidden,false);assert.equal(f.panels.get('b').dataset.historyLoaded,'true');
});

test('histórico fechado não consulta novamente em edição externa até ser aberto',async()=>{
  const f=setup();f.render([record()]);f.historyButtons.get('fictional-1').onclick();await flush();f.historyButtons.get('fictional-1').onclick();
  f.render([record('fictional-1',{version:2})]);await flush();assert.equal(f.queries.length,1);
  f.historyButtons.get('fictional-1').onclick();await flush();assert.equal(f.queries.length,2);
});

test('histórico antigo não sobrescreve resposta de versão atual quando resolve por último',async()=>{
  const first=deferred(),second=deferred();let calls=0;const f=setup({history:()=>++calls===1?first.promise:second.promise});
  f.render([record()]);f.historyButtons.get('fictional-1').onclick();await flush();
  f.render([record('fictional-1',{version:2})]);await flush();
  second.resolve([{version:2}]);await flush();first.resolve([{version:1}]);await flush();
  assert.equal(f.panels.get('fictional-1').innerHTML,'[{"version":2}]');assert.equal(f.panels.get('fictional-1').dataset.historyLoaded,'true');
});

test('UID, permissão, data e remoção durante histórico impedem callback tardio',async()=>{
  for(const change of ['uid','scope','remove']){
    const pending=deferred();const f=setup({history:()=>pending.promise});f.render([record()]);f.historyButtons.get('fictional-1').onclick();await flush();const panel=f.panels.get('fictional-1');
    if(change==='uid')f.ctx.session.user.uid='other';if(change==='scope')f.setCurrent(false);if(change==='remove')f.render([]);
    const before=panel.innerHTML;pending.resolve([{private:'must not render'}]);await flush();assert.equal(panel.innerHTML,before);assert.notEqual(panel.dataset.historyLoaded,'true');
  }
});

test('erro de histórico mantém tentativa disponível e não contamina novo escopo',async()=>{
  let calls=0;const f=setup({history:async()=>{if(++calls===1)throw new Error('rede fictícia');return [{ok:true}];}});f.render([record()]);
  f.historyButtons.get('fictional-1').onclick();await flush();assert.match(f.panels.get('fictional-1').innerHTML,/rede fictícia/);
  f.historyButtons.get('fictional-1').onclick();f.historyButtons.get('fictional-1').onclick();await flush();assert.equal(calls,2);assert.equal(f.panels.get('fictional-1').dataset.historyLoaded,'true');
});

test('paginação troca a chave do listener sem limpar histórico do mesmo usuário/período',async()=>{
  const f=setup();f.render([record()]);f.historyButtons.get('fictional-1').onclick();await flush();
  const panel=f.panels.get('fictional-1');const before=panel.innerHTML;
  f.scope.key='labels:user-1:2026-10-01:read:limit100';f.render([record(),record('additional')],{nextCursor:{nextLimit:150}});
  assert.equal(panel.hidden,false);assert.equal(panel.innerHTML,before);assert.equal(f.queries.length,1);
});
test('paginação durante GET de histórico transfere ownership sem congelar carregamento',async()=>{
  const first=deferred(),second=deferred();let calls=0;const f=setup({history:()=>++calls===1?first.promise:second.promise});
  f.render([record()]);f.historyButtons.get('fictional-1').onclick();await flush();
  f.scope.key='labels:user-1:2026-10-01:read:limit100';f.render([record(),record('additional')]);await flush();
  assert.equal(f.queries.length,2);second.resolve([{current:true}]);await flush();first.resolve([{stale:true}]);await flush();
  assert.equal(f.panels.get('fictional-1').innerHTML,'[{"current":true}]');assert.equal(f.panels.get('fictional-1').dataset.historyLoading,'false');
});
test('mudança de período limpa histórico privado mesmo se ID existir novamente',async()=>{
  const f=setup({history:async()=>[{old:true}]});f.render([record()]);f.historyButtons.get('fictional-1').onclick();await flush();
  f.scope.key='labels:user-1:2026-10-02:read';f.scope.day='2026-10-02';f.render([record('fictional-1',{date:'2026-10-02'})]);
  assert.equal(f.panels.get('fictional-1').hidden,true);assert.equal(f.panels.get('fictional-1').innerHTML,'');assert.equal(f.panels.get('fictional-1').dataset.historyLoaded,undefined);
});

test('sincronização geral não força V do relatório e PDF não é pré-carregado na abertura',()=>{
  const outbox=main.slice(main.indexOf('async function updateOutboxStatus()'),main.indexOf('function scheduleOutboxRetry'));
  assert.doesNotMatch(outbox,/reportSync\.innerHTML/);assert.match(main.slice(main.indexOf('function updateLabelReportSync()'),main.indexOf('async function loadLabelReport')),/updateReportSync\('labels'\)/);
  const entry=main.slice(main.indexOf("if (route === 'labels') {",main.indexOf('async function loadModule')),main.indexOf("if (route === 'admin')",main.indexOf('async function loadModule')));
  assert.doesNotMatch(entry,/loadReportPdfModule/);
});

test('leitor leve preserva filtros, deduplicação e paginação, sem persistência',async()=>{
  const source=readFileSync(join(__dirname,'../src/label-report-reader.js'),'utf8');const captured=[];let count=0;
  const item={id:'label-1',data:()=>({date:'2026-09-30'})};
  const ctx=vm.createContext({db:{},collection:()=> 'labels',where:(...args)=>({where:args}),orderBy:(...args)=>({order:args}),startAfter:doc=>({cursor:doc}),limit:n=>({limit:n}),query:(...args)=>args,getDocs:async q=>{captured.push(q);count++;return {docs:[item]};}});
  vm.runInContext(source.split('\n').filter(line=>!line.startsWith('import ')).join('\n').replaceAll('export ',''),ctx);
  const result=await vm.runInContext("listLabelRecords({from:'2026-09-30',to:'2026-09-30',uid:'user-1',sigla:'FA'})",ctx);
  assert.equal(count,2);assert.equal(result.records.length,1);assert.ok(captured[0].some(x=>x.where?.[0]==='createdByUid'));assert.ok(captured[1].some(x=>x.where?.[0]==='staffSiglas'));
  assert.ok(captured.every(q=>q.some(x=>x.where?.[0]==='date'&&x.where[1]==='==')));assert.doesNotMatch(source,/writeSafeCache|localStorage|indexedDB|firebase\/firestore';/);
  const paged=await vm.runInContext("listLabelRecords({from:'2026-09-01',to:'2026-09-30',uid:'user-1',canManage:true,pageSize:1})",ctx);assert.equal(paged.nextCursor.mode,'admin');
});
