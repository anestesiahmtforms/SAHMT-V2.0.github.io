import test from 'node:test';
import assert from 'node:assert/strict';
import {createInformationQueue} from '../src/information-banner.js';
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
