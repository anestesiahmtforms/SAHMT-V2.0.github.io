import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureReportReadScope} from '../src/report-read-scope.js';
import {resolveChecklistResponsibility} from '../src/checklist-responsible.js';
import {getChecklistDayResponsible} from '../src/checklist-responsibility-reader.js';

const day = '2026-09-22';
const contacts = [
 {sigla:'AD',name:'Ana Dias',active:true}, {sigla:'CR',name:'Caio Ramos',active:true},
 {sigla:'LH',name:'Lia Horta',active:true}, {sigla:'MG',name:'Marta Gomes',active:true}
];
function sources(overrides = {}) {
 return {
  readSchedule: async () => ({positions:['AD','CR','LH','MG']}),
  listVacationsForDate: async () => [],
  listContactCatalog: async () => contacts,
  listEventRecords: async () => ({records:[],nextCursor:null,stale:false}),
  remotePreview: async () => ({responsible:{name:'Ana Dias',uid:'u-ad'}}),
  ...overrides
 };
}
test('nome segue posição 1 e pula férias e substituições até a próxima posição', async () => {
 const a = await getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources());
 assert.equal(a.name,'Ana Dias'); assert.equal(a.position,1);
 const b = await getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  listVacationsForDate: async () => [{active:true,start:day,end:day,siglas:['AD']}],
  listEventRecords: async () => ({records:[{date:day,active:true,eventType:'Pessoal',memberStatus:'Caio Ramos',substitute:'Lia Horta'}],nextCursor:null})
 }));
 assert.equal(b.name,'Lia Horta'); assert.equal(b.position,3);
 const c = await getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  listVacationsForDate: async () => [{active:true,start:day,end:day,siglas:['AD','CR']}],
  listEventRecords: async () => ({records:[{date:day,active:true,eventType:'Outros',memberStatus:'Lia Horta',substitute:'Marta Gomes'}],nextCursor:null})
 }));
 assert.equal(c.name,'Marta Gomes'); assert.equal(c.position,4);
});
test('confere todas as páginas de eventos e não usa operações locais pendentes', async () => {
 const calls=[];
 const result=await getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  listEventRecords: async (input) => {
   calls.push(input);
   return input.cursor ? {records:[{date:day,active:true,eventType:'Pessoal',memberStatus:'Ana Dias',substitute:'Caio Ramos'}],nextCursor:null}
    : {records:[],nextCursor:'next'};
  }
 }));
 assert.equal(result.name,'Caio Ramos');assert.equal(calls.length,2);
 assert.equal(calls[0].includePending,false);
});
test('não administradores usam consulta autorizada sem tentar ler todos os eventos', async () => {
 const result=await getChecklistDayResponsible({day,uid:'eligible'},sources({
  readSchedule: async () => {throw new Error('Não deve consultar como admin');},
  listEventRecords: async () => {throw new Error('Não deve consultar como admin');}
 }));
 assert.equal(result.name,'Ana Dias');
});
test('não inventa responsável quando escala ou eventos estão incompletos/sem conexão', async () => {
 await assert.rejects(getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  readSchedule: async () => ({positions:['AD'],stale:true})
 })),/online/);
 await assert.rejects(getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  listEventRecords: async () => ({records:[],stale:true})
 })),/online/);
 await assert.rejects(getChecklistDayResponsible({day,uid:'eligible'},sources({
  remotePreview: async () => ({responsible:null})
 })),/não confirmado/);
});
test('rodapé contém somente um botão com título e nome, e revisão fica em modal separado', () => {
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const footer=source.match(/<footer class="checklist-confirmation-footer">([\s\S]*?)<\/footer>/)?.[1];
 assert.ok(footer);
 assert.equal((footer.match(/<button\b/g)||[]).length,1);
 assert.match(footer,/<span>Confirmação do Checklist<\/span><small id="checklist-responsible-name">/);
 assert.doesNotMatch(footer,/checklist-signature-status|checklist-signature-preview|Revisar e assinar|Assinatura do responsável/);
 assert.match(source,/confirmationDialog\.showModal\(\)/);
 assert.match(source,/const responsibleIsAdmin = reportScope\.permissions\.admin === true;/);
 assert.match(source,/getChecklistDayResponsible\(\{day, uid, isAdmin: responsibleIsAdmin, assertCurrent: \(\) => \{/);
});

function deferred() {
 let resolve;
 const promise = new Promise(done => {resolve = done;});
 return {promise,resolve};
}
function readerScope() {
 let selectedDay = day;
 let session = {status:'signed-in',user:{uid:'fictional-signer'},profile:{active:true,access:true,
  role:'anestesiologista',sigla:'FX',permissions:{checklistSign:true,admin:true}}};
 const scope = captureReportReadScope({getSession:()=>session,
  getPermissions:current=>current.profile.permissions,
  isAllowed:current=>current.profile.permissions.checklistSign===true,
  isContextCurrent:()=>selectedDay===day});
 return {scope,invalidate(change) {
  if(change==='day') selectedDay='2026-09-23';
  else if(change==='permission') session={...session,profile:{...session.profile,permissions:{...session.profile.permissions,checklistSign:false}}};
  else session={...session,user:{uid:'fictional-other'}};
 }};
}
function readerWithImports(fixtureImport) {
 const source=readFileSync(new URL('../src/checklist-responsibility-reader.js',import.meta.url),'utf8')
  .replace(/^import [^\n]+\n/,'').replace('export async function','async function')
  .replaceAll("import('./data.js')","fixtureImport('data')")
  .replaceAll("import('firebase/functions')","fixtureImport('functions')")
  .replaceAll("import('./firebase-app.js')","fixtureImport('app')");
 const context=vm.createContext({resolveChecklistResponsibility,fixtureImport});
 vm.runInContext(source,context);
 return context.getChecklistDayResponsible;
}

test('sessão já revogada bloqueia a consulta antes de qualquer fonte',async()=>{
 const current=readerScope();current.invalidate('permission');
 let calls=0;
 await assert.rejects(getChecklistDayResponsible({day,uid:'fictional-signer',isAdmin:true,
  assertCurrent:current.scope.assertCurrent},sources({readSchedule:async()=>{calls++;return {positions:['AD']};}})),{code:'session-changed'});
 assert.equal(calls,0);
});

test('escala atrasada não habilita responsável nem inicia eventos após troca de data, UID ou permissão', {timeout:2000},async()=>{
 for(const change of ['day','uid','permission']) {
  const current=readerScope();const schedule=deferred();const started=deferred();let pages=0;
  const pending=getChecklistDayResponsible({day,uid:'fictional-signer',isAdmin:true,assertCurrent:current.scope.assertCurrent},sources({
   readSchedule:()=>{started.resolve();return schedule.promise;},
   listEventRecords:async()=>{pages++;return {records:[],nextCursor:null};}
  }));
  await started.promise;current.invalidate(change);schedule.resolve({positions:['AD']});
  await assert.rejects(pending,{code:'session-changed'});assert.equal(pages,0,change);
 }
});

test('cada página tardia revalida o escopo antes de consumir resultado ou buscar a próxima', {timeout:2000},async()=>{
 for(const delayedPage of [1,2]) {
  const current=readerScope();const page=deferred();const started=deferred();let calls=0;
  const pending=getChecklistDayResponsible({day,uid:'fictional-signer',isAdmin:true,assertCurrent:current.scope.assertCurrent},sources({
   listEventRecords:()=>{
    calls++;if(calls===delayedPage){started.resolve();return page.promise;}
    return Promise.resolve({records:[],nextCursor:'next'});
   }
  }));
  await started.promise;current.invalidate('permission');page.resolve({records:[],nextCursor:'unread-next'});
  await assert.rejects(pending,{code:'session-changed'});assert.equal(calls,delayedPage);
 }
});

test('prévia remota atrasada não retorna nome do escopo anterior', {timeout:2000},async()=>{
 for(const change of ['day','uid','permission']) {
  const current=readerScope();const preview=deferred();const started=deferred();
  const pending=getChecklistDayResponsible({day,uid:'fictional-signer',assertCurrent:current.scope.assertCurrent},sources({
   remotePreview:()=>{started.resolve();return preview.promise;}
  }));
  await started.promise;current.invalidate(change);preview.resolve({responsible:{name:'Nome antigo TESTE'}});
  await assert.rejects(pending,{code:'session-changed'});
 }
});

test('import tardio de data bloqueia a chamada remota com sessão revogada', {timeout:2000},async()=>{
 const current=readerScope();const imported=deferred();const started=deferred();const calls=[];
 const read=readerWithImports(module=>{
  calls.push(module);if(module==='data'){started.resolve();return imported.promise;}
  throw new Error('Não deve importar Firebase depois da revogação');
 });
 const pending=read({day,uid:'fictional-signer',assertCurrent:current.scope.assertCurrent});
 await started.promise;current.invalidate('uid');imported.resolve(sources());
 await assert.rejects(pending,{code:'session-changed'});assert.deepEqual(calls,['data']);
});

test('imports tardios do Firebase bloqueiam callable depois de troca de data', {timeout:2000},async()=>{
 const current=readerScope();const imported=deferred();const started=deferred();let calls=0;
 const read=readerWithImports(async module=>{
  if(module==='data')return sources();
  if(module==='app')return {app:{}};
  started.resolve();return imported.promise;
 });
 const pending=read({day,uid:'fictional-signer',assertCurrent:current.scope.assertCurrent});
 await started.promise;current.invalidate('day');imported.resolve({getFunctions:()=>({}),
  httpsCallable:()=>async()=>{calls++;return {data:{responsible:{name:'Nome antigo TESTE'}}};}});
 await assert.rejects(pending,{code:'session-changed'});assert.equal(calls,0);
});

test('resposta tardia do callable também valida o escopo antes de retornar dados', {timeout:2000},async()=>{
 const current=readerScope();const response=deferred();const started=deferred();const requests=[];
 const read=readerWithImports(async module=>{
  if(module==='data')return sources();
  if(module==='app')return {app:{}};
  return {getFunctions:()=>({}),httpsCallable:()=>async input=>{
   requests.push(JSON.parse(JSON.stringify(input)));started.resolve();return response.promise;
  }};
 });
 const pending=read({day,uid:'fictional-signer',assertCurrent:current.scope.assertCurrent});
 await started.promise;current.invalidate('permission');response.resolve({data:{responsible:{name:'Nome antigo TESTE'}}});
 await assert.rejects(pending,{code:'session-changed'});assert.deepEqual(requests,[{day,mode:'preview'}]);
});

test('relatório diário tem Voltar no final do modal, sem botão de fechar no cabeçalho', () => {
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const dialog=source.slice(source.indexOf('const checklistReportDialog ='),source.indexOf('  const labelReport =',source.indexOf('const checklistReportDialog =')));
 const header=dialog.match(/<header class="checklist-report-dialog__header">([\s\S]*?)<\/header>/)?.[1];
 assert.ok(header);
 assert.doesNotMatch(header,/<button/);
 assert.match(dialog,/<footer class="checklist-report-footer"><form method="dialog"><button class="secondary-button" type="submit">Voltar<\/button><\/form><\/footer><\/dialog>/);
 assert.ok(dialog.indexOf('class="checklist-report-footer"') > dialog.indexOf('class="module-content checklist-report-content"'));
});
