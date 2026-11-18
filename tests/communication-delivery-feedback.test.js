import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {escapeNoticeHtml as escapeHtml, linkedNoticeText} from '../src/communication-notice-text.js';
import {localDateKey} from '../src/schedule-date.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function homeHarness(request,{enable,refreshPushRegistration,storage=new Map(),uid='fixture-rl',displayMode='browser'}={}){
 const rootEvents=new Map(),documentEvents=new Map(),windowEvents=new Map(),workerEvents=new Map();let clock=10000;
 const root={isConnected:true,innerHTML:'',contains:()=>true,addEventListener:(n,fn)=>rootEvents.set(n,fn),removeEventListener:n=>rootEvents.delete(n),replaceChildren(){this.innerHTML='';}};
 const document={visibilityState:'visible',addEventListener:(n,fn)=>documentEvents.set(n,fn),removeEventListener:n=>documentEvents.delete(n)};
 const window={addEventListener:(n,fn)=>windowEvents.set(n,fn),removeEventListener:n=>windowEvents.delete(n)};
 const serviceWorker={addEventListener:(n,fn)=>workerEvents.set(n,fn),removeEventListener:n=>workerEvents.delete(n)};
 let disposed=false;
 const source=readFileSync(new URL('../src/communication-home-banners.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace('export function mountCommunicationHomeBanners','function mountCommunicationHomeBanners');
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const mount=vm.runInNewContext(source+'\nmountCommunicationHomeBanners;',{document,window,navigator:{serviceWorker},localStorage,Date:class extends Date{static now(){return clock;}},appDisplayMode:()=>displayMode,escapeHtml,linkedNoticeText,activateCommunicationPush:client=>client.enable(),pushActivationMessage:()=> 'Permita as notificações nos ajustes.'});
 const cleanup=mount(root,{uid,client:{request,enable,refreshPushRegistration,dispose(){disposed=true;}}});
 return {root,rootEvents,document,documentEvents,windowEvents,workerEvents,cleanup,get disposed(){return disposed;},advance:()=>clock+=3000};
}
const notice={id:`event-checklist-conference-${localDateKey()}`,status:'published',title:'Conferência do Checklist',message:'Não se esqueça da conferência de hoje.',category:'EVENTO',publishAt:Date.now()};

test('o pedido de Push permanece até o registro confirmado do aparelho',async()=>{
 let attempts=0;
 const h=homeHarness(async()=>({items:[],pushEnrollment:true}),{enable:async()=>{
  if(++attempts===1)throw Error('permission denied');
  return {registered:true};
 }});
 await tick();
 assert.match(h.root.innerHTML,/Ative para receber mensagens do SAHMT/);
 assert.match(h.root.innerHTML,/Ativar notificações neste aparelho/);
 assert.doesNotMatch(h.root.innerHTML,/data-dismiss-comm/);
 const activate=()=>h.rootEvents.get('click')({target:{closest:selector=>selector==='[data-activate-team-push]'?{}:null}});
 activate();await tick();assert.match(h.root.innerHTML,/Permita as notificações/);
 activate();await tick();assert.equal(h.root.innerHTML,'');
 h.cleanup();
});

test('o pedido fica no aparelho até o toque mesmo depois de renovação, reabertura e falha de rede',async()=>{
 const storage=new Map();
 const initial=homeHarness(async()=>({items:[],pushEnrollment:true}),{storage,refreshPushRegistration:async()=>({registered:true})});
 await tick();
 assert.match(initial.root.innerHTML,/data-activate-team-push/);
 initial.cleanup();
 let calls=0;
 const reopened=homeHarness(async()=>{
  if(++calls===1)throw Error('offline');
  return {items:[notice],pushEnrollment:false};
 },{storage,enable:async()=>({registered:true})});
 assert.match(reopened.root.innerHTML,/data-activate-team-push/);
 await tick();
 assert.match(reopened.root.innerHTML,/data-activate-team-push/);
 reopened.advance();
 reopened.windowEvents.get('focus')();
 await tick();
 assert.match(reopened.root.innerHTML,/data-activate-team-push/);
 assert.match(reopened.root.innerHTML,/Conferência do Checklist/);
 for(const options of [{uid:'another-user'},{displayMode:'standalone'}]){
  const other=homeHarness(async()=>({items:[],pushEnrollment:false}),{storage,...options});
  await tick();
  assert.equal(other.root.innerHTML,'');
  other.cleanup();
 }
 reopened.rootEvents.get('click')({target:{closest:selector=>selector==='[data-activate-team-push]'?{}:null}});
 await tick();
 assert.doesNotMatch(reopened.root.innerHTML,/data-activate-team-push/);
 assert.match(reopened.root.innerHTML,/Conferência do Checklist/);
 reopened.cleanup();
 const confirmed=homeHarness(async()=>({items:[],pushEnrollment:false}),{storage});
 await tick();
 assert.equal(confirmed.root.innerHTML,'');
 confirmed.cleanup();
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
