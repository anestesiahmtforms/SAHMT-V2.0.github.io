import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {staleModuleFailure} from '../src/app-repair.js';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=main.indexOf('async function loadManagementAreaActivities(area) {');
const end=main.indexOf('  detail.innerHTML = `<header',start);
assert.ok(start>=0&&end>start);
const source=main.slice(start,end).replace("await import('./html-training.js')",'await loadTrainingModule()')+'\n}';
const area={id:'area-gestao-de-documentos'};
function harness({failure,automatic=true}={}){
  const repairs=[],handlers=new Map();
  const detail={isConnected:true,innerHTML:'',querySelector:selector=>({addEventListener:(event,fn)=>handlers.set(selector,fn)})};
  const session={user:{uid:'user-1'},profile:{}};
  const ctx=vm.createContext({cleanupDocumentTraining:null,managementActivityLoad:0,document:{querySelector:()=>detail},session,deployment:{target:'FB'},staleModuleFailure,
    repairAppFiles:options=>{repairs.push(options);return options.automatic?automatic:true;},
    loadTrainingModule:async()=>{if(failure)throw failure;return {mountHtmlTrainings:()=>()=>{}};}});
  vm.runInContext(source,ctx);
  return {detail,repairs,handlers,session,ctx,open:()=>ctx.loadManagementAreaActivities(area)};
}
test('a missing training chunk recovers FB files once and preserves the document route',async()=>{
  const h=harness({failure:Error('Importing a module script failed.')});await h.open();
  assert.equal(h.repairs.length,1);assert.equal(h.repairs[0].automatic,true);
  assert.equal(h.repairs[0].target,'FB');assert.equal(h.repairs[0].hash,'#/management/area-gestao-de-documentos');
  assert.match(h.detail.innerHTML,/Atualizando os arquivos/);
});
test('when automatic recovery is throttled the user can retry or update explicitly',async()=>{
  const h=harness({failure:Error('Failed to fetch dynamically imported module'),automatic:false});await h.open();
  assert.match(h.detail.innerHTML,/Tentar novamente/);assert.match(h.detail.innerHTML,/Atualizar arquivos do app/);
  h.handlers.get('[data-repair-document-training]')();assert.equal(h.repairs.length,2);assert.equal(h.repairs[1].automatic,undefined);
  h.ctx.loadTrainingModule=async()=>({mountHtmlTrainings:()=>()=>{}});
  h.handlers.get('[data-retry-document-training]')();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof h.ctx.cleanupDocumentTraining,'function');
});
test('permission failures do not trigger automatic file recovery',async()=>{
  const h=harness({failure:Error('Missing or insufficient permissions')});await h.open();
  assert.equal(h.repairs.length,0);assert.match(h.detail.innerHTML,/Tentar novamente/);
});
test('a failed import after a session change cannot redirect the next user',async()=>{
  const h=harness();h.ctx.loadTrainingModule=async()=>{h.session.user.uid='user-2';throw Error('Importing a module script failed.');};
  await h.open();assert.equal(h.repairs.length,0);
});
test('a successful import mounts the training controller normally',async()=>{
  const h=harness();await h.open();assert.equal(typeof h.ctx.cleanupDocumentTraining,'function');assert.equal(h.repairs.length,0);
});
