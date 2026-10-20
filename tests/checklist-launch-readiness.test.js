import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('relatórios do checklist não oferecem um botão clicável antes da vinculação',()=>{
 for(const mode of ['daily','monthly'])assert.ok(new RegExp('data-checklist-report-launch="'+mode+'" disabled').test(source),'O botão precisa aguardar a vinculação.');
});
test('vincular a ação habilita o botão somente após instalar o listener',()=>{
 const start=source.indexOf("      document.querySelectorAll('[data-checklist-report-launch]')"),end=source.indexOf("      reportDay?.addEventListener",start);
 assert.ok(start>=0&&end>start);
 const order=[],button={dataset:{checklistReportLaunch:'daily'},addEventListener:()=>order.push('listener')};
 Object.defineProperty(button,'disabled',{set:value=>order.push(value?'disabled':'enabled')});
 const context=vm.createContext({document:{querySelectorAll:()=>[button]}});
 vm.runInContext(source.slice(start,end),context);assert.deepEqual(order,['listener','enabled']);
});
