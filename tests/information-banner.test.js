import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createInformationQueue, INFORMATION_REFRESH_MS} from '../src/information-banner.js';
const profile = {uid:'test-user'};
test('mostra pendentes sequencialmente e só dispensa após salvar no servidor', async () => {
 let finish, shown; const writes=[];
 const q=createInformationQueue({list:async()=>[{id:'read',read:true},{id:'one'},{id:'two'}],acknowledge:(id,uid)=>{writes.push([id,uid]);return new Promise(resolve=>finish=resolve)},show:(item,state)=>shown={item,state}});
 q.setSession(profile); await q.refresh(); assert.equal(shown.item.id,'one');
 const pending=q.confirm(); assert.equal(shown.item.id,'one');assert.equal(shown.state.saving,true);
 finish();await pending; assert.equal(shown.item.id,'two');assert.deepEqual(writes,[['one','test-user']]);
 await q.refresh();assert.equal(shown.item.id,'two');
});
test('falha de gravação mantém o banner com opção de tentar novamente', async () => {
 let shown;const q=createInformationQueue({list:async()=>[{id:'one'}],acknowledge:async()=>{throw Error('offline')},show:(item,state)=>shown={item,state}});
 q.setSession(profile);await q.refresh();await q.confirm();assert.equal(shown.item.id,'one');assert.equal(shown.state.saving,false);assert.match(shown.state.error,/Não foi possível/);
});
test('resultado tardio de outro usuário não mostra comunicado nem registra ciência na nova sessão', async () => {
 let resolveList, shown;const q=createInformationQueue({list:()=>new Promise(resolve=>resolveList=resolve),acknowledge:async()=>{},show:item=>shown=item});
 q.setSession(profile);const pending=q.refresh();q.setSession({uid:'another-user'});resolveList([{id:'old'}]);await pending;assert.equal(shown,null);
});
test('consultas com falha mantêm o comunicado aberto e logout remove o banner', async () => {
 let fails=false,shown;const q=createInformationQueue({list:async()=>{if(fails)throw Error('offline');return [{id:'one'}]},acknowledge:async()=>{},show:item=>shown=item});
 q.setSession(profile);await q.refresh();fails=true;await q.refresh();assert.equal(shown.id,'one');q.setSession(null);assert.equal(shown,null);
});
test('navegação repetida não consulta antes de cinco minutos', async () => {
 let time=0, reads=0;
 const q=createInformationQueue({now:()=>time,list:async()=>{reads++;return [];},acknowledge:async()=>{},show:()=>{}});
 q.setSession(profile);await q.refresh();
 for(let i=0;i<100;i++){q.setSession({...profile});await q.refresh();}
 assert.equal(reads,1);time=INFORMATION_REFRESH_MS;await q.refresh();assert.equal(reads,2);
});
test('falhas aumentam espera e eventos de rede não contornam a pausa', async () => {
 let time=0,reads=0,fail=true;
 const q=createInformationQueue({now:()=>time,list:async()=>{reads++;if(fail)throw Error('quota');return [];},acknowledge:async()=>{},show:()=>{}});
 q.setSession(profile);await q.refresh();time=INFORMATION_REFRESH_MS;await q.refresh();assert.equal(reads,1);
 time=2*INFORMATION_REFRESH_MS;await q.refresh();assert.equal(reads,2);
 time=5*INFORMATION_REFRESH_MS;await q.refresh();assert.equal(reads,2);
 time=6*INFORMATION_REFRESH_MS;fail=false;await q.refresh();assert.equal(reads,3);
 time=7*INFORMATION_REFRESH_MS;await q.refresh();assert.equal(reads,4);
});
test('novo usuário não herda a pausa de outro e consulta inicial é coalescida', async () => {
 let reads=0,finish;
 const q=createInformationQueue({now:()=>0,list:()=>{reads++;return new Promise(resolve=>finish=resolve);},acknowledge:async()=>{},show:()=>{}});
 q.setSession(profile);const first=q.refresh();await q.refresh();assert.equal(reads,1);
 finish([]);await first;q.setSession({uid:'another-user'});const second=q.refresh();assert.equal(reads,2);finish([]);await second;
});
test('banner não agenda consultas periódicas nem relê a cada renderização',()=>{
 const source=readFileSync(new URL('../src/information-banner.js',import.meta.url),'utf8');
 const start=source.indexOf('export function updateInformationBanner(');
 let reads=0;const listeners=[];
 const context=vm.createContext({queue:null,dialog:null,timer:null,bannerSessionUid:null,INFORMATION_REFRESH_MS,present:()=>{},
  createInformationQueue:()=>({setSession:()=>{},refresh:()=>{reads++;}}),
  window:{addEventListener:(name,callback)=>listeners.push(name)},document:{addEventListener:()=>{},hidden:false},
  setInterval:()=>assert.fail('Não agendar leituras'),clearInterval:()=>{}});
 vm.runInContext(source.slice(start).replace('export function','function'),context);
 context.updateInformationBanner(profile);for(let i=0;i<100;i++)context.updateInformationBanner({...profile});
 assert.equal(reads,1);assert.ok(!listeners.includes('online'));
 context.updateInformationBanner(null);context.updateInformationBanner(profile);assert.equal(reads,2);
});
