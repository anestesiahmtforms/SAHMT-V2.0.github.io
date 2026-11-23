import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {escapeNoticeHtml as escapeHtml, linkedNoticeText} from '../src/communication-notice-text.js';
import {localDateKey} from '../src/schedule-date.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function homeHarness(request,{refreshPushRegistration,storage=new Map(),uid='fixture-rl'}={}){
 const rootEvents=new Map(),documentEvents=new Map(),windowEvents=new Map(),workerEvents=new Map();let clock=10000;
 const root={isConnected:true,innerHTML:'',contains:()=>true,addEventListener:(n,fn)=>rootEvents.set(n,fn),removeEventListener:n=>rootEvents.delete(n),replaceChildren(){this.innerHTML='';}};
 const document={visibilityState:'visible',addEventListener:(n,fn)=>documentEvents.set(n,fn),removeEventListener:n=>documentEvents.delete(n)};
 const window={addEventListener:(n,fn)=>windowEvents.set(n,fn),removeEventListener:n=>windowEvents.delete(n)};
 const serviceWorker={addEventListener:(n,fn)=>workerEvents.set(n,fn),removeEventListener:n=>workerEvents.delete(n)};
 let disposed=false;
 const source=readFileSync(new URL('../src/communication-home-banners.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace('export function mountCommunicationHomeBanners','function mountCommunicationHomeBanners');
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const mount=vm.runInNewContext(source+'\nmountCommunicationHomeBanners;',{document,window,navigator:{serviceWorker},localStorage,Date:class extends Date{static now(){return clock;}},escapeHtml,linkedNoticeText});
 const cleanup=mount(root,{user:{uid},client:{request,refreshPushRegistration,dispose(){disposed=true;}}});
 return {root,rootEvents,document,documentEvents,windowEvents,workerEvents,cleanup,get disposed(){return disposed;},advance:()=>clock+=3000};
}
const notice={id:`event-checklist-conference-${localDateKey()}`,status:'published',title:'Conferência do Checklist',message:'Não se esqueça da conferência de hoje.',category:'EVENTO',publishAt:Date.now()};

test('a Home ignora pedidos antigos de Push e mantém a conferência quando a renovação falha',async()=>{
 for(const mode of ['browser','standalone']){
  const uid='fixture-rl',storage=new Map([[`sahmt-communication-push-request-v2:${mode}:${uid}`,'pending']]);
  let loaded=false,refreshes=0;
  const home=homeHarness(async()=>({items:loaded?[notice]:[]}),{
   uid,storage,refreshPushRegistration:async()=>{refreshes++;throw Error('COMM_SESSION_INVALID');}
  });
  assert.equal(home.root.innerHTML,'');
  await tick();
  assert.equal(home.root.innerHTML,'');
  loaded=true;
  home.advance();
  home.windowEvents.get('focus')();
  await tick();
  assert.equal(refreshes,2);
  assert.match(home.root.innerHTML,/Conferência do Checklist/);
  assert.doesNotMatch(home.root.innerHTML,/data-activate-team-push|Ativar notificações|COMM_SESSION_INVALID/);
  home.cleanup();
 }
});

test('links colados na descrição chegam clicáveis na Home com parâmetros preservados',async()=>{
 const h=homeHarness(async()=>({items:[{...notice,message:'Veja #/home ou (https://example.test/watch?v=abc&list=xyz). <img src=x>'}],cursor:null}));
 await tick();
 assert.match(h.root.innerHTML,/<a href="#\/home">#\/home<\/a>/);
 assert.match(h.root.innerHTML,/<a href="https:\/\/example\.test\/watch\?v=abc&amp;list=xyz" target="_blank" rel="noopener noreferrer">/);
 assert.doesNotMatch(h.root.innerHTML,/<img/);
 h.cleanup();
});

test('o alerta de checklist aparece antes de terminar a leitura de páginas antigas',async()=>{
 let complete;let calls=0;
 const h=homeHarness(async()=>++calls===1?{items:[notice],cursor:'older'}:new Promise(resolve=>complete=resolve));
 await tick();assert.match(h.root.innerHTML,/Conferência do Checklist/);assert.equal(calls,2);
 complete({items:[],cursor:null});await tick();assert.match(h.root.innerHTML,/Conferência do Checklist/);h.cleanup();
});

test('voltar ao app atualiza avisos; falhas ficam silenciosas sem apagar o aviso existente',async()=>{
 let calls=0;
 const h=homeHarness(async()=>{calls++;if(calls===1)throw Object.assign(Error(),{code:'COMM_SESSION_INVALID'});if(calls===2)return {items:[notice],cursor:null};throw Error('offline');});
 await tick();assert.equal(h.root.innerHTML,'');
 h.advance();h.document.visibilityState='hidden';h.documentEvents.get('visibilitychange')();await tick();assert.equal(calls,1);
 h.document.visibilityState='visible';h.documentEvents.get('visibilitychange')();h.windowEvents.get('focus')();await tick();assert.equal(calls,2);assert.match(h.root.innerHTML,/Conferência do Checklist/);
 h.advance();h.windowEvents.get('focus')();await tick();assert.match(h.root.innerHTML,/Conferência do Checklist/);assert.doesNotMatch(h.root.innerHTML,/Não foi possível atualizar|Conecte sua conta|ABRIR CENTRAL DE COMUNICAÇÃO/);
 h.cleanup();assert.equal(h.disposed,true);assert.equal(h.documentEvents.size,0);assert.equal(h.windowEvents.size,0);assert.equal(h.workerEvents.size,0);
});

test('uma atualização concluída sem alerta limpa o banner de checklist encerrado',async()=>{
 let calls=0;const h=homeHarness(async()=>({items:++calls===1?[notice]:[],cursor:null}));
 await tick();assert.match(h.root.innerHTML,/Conferência do Checklist/);h.advance();h.windowEvents.get('focus')();await tick();assert.equal(h.root.innerHTML,'');h.cleanup();
});

test('falha ou bloqueio da notificação do sistema não impede o aviso para a Home aberta',async()=>{
 const source=readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8');
 for(const synchronous of [false,true]){
  const handlers=new Map(),messages=[];
  const self={location:{origin:'https://app.example'},addEventListener:(n,fn)=>handlers.set(n,fn),registration:{showNotification(){if(synchronous)throw Error('blocked');return Promise.reject(Error('blocked'));}},clients:{matchAll:async()=>[{postMessage:data=>messages.push(data)}]}};
  vm.runInNewContext(source,{self,URL,Request});let completion;
  handlers.get('push')({data:{json:()=>({data:{source:'SAHMT_FF',communicationId:notice.id,title:notice.title,body:notice.message,route:'home'}})},waitUntil:promise=>completion=promise});
  await completion;assert.equal(messages.length,1);assert.equal(messages[0].type,'NEW_COMMUNICATION');assert.equal(messages[0].communicationId,notice.id);
 }
});
