import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as checklist from '../src/checklist-display.js';

test('checklist identifies all requested rooms and keeps the existing titles', () => {
  const rooms = {17:'Sala 14',24:'Sala 13',12:'Sala 12',31:'Sala 11',21:'Sala Híbrida',33:'Sala 10',29:'Sala 09',28:'Sala 08',32:'Sala 17',23:'Sala 16',22:'Sala 07',27:'Sala 06',19:'Sala Robótica',16:'Sala 02',13:'Sala 03',20:'Sala 04',25:'Sala 05',10:'Endoscopia',14:'Bloco2 sl.1',3:'Bloco2 sl.2',30:'Hemod sl.1',5:'Hemod sl.2',15:'Ressonância'};
  for (const [suffix, title] of Object.entries(rooms)) assert.equal(checklist.checklistArsenalFunction({id:`10017${suffix.padStart(4,'0')}`}), title);
});

test('saved title overrides the default without changing the arsenal number', () => {
  const station = {id:'100170010', name:'Arsenal 100170010', functionLabel:'Sala de Endoscopia'};
  assert.equal(checklist.checklistArsenalFunction(station), 'Sala de Endoscopia');
  assert.equal(checklist.checklistArsenalButtonLabel(station), '100170010');
});

const manager = {active:true,access:true,permissions:{checklistManage:true}};
const user = {uid:'manager',email:'wx2064@gmail.com',emailVerified:true};
test('designated managers and five verified owners with arsenal management can edit titles', () => {
  for (const email of ['wx2064@gmail.com','marcio.henrique82@gmail.com','WX2064@gmail.com',...Array.from({length:5},(_,i)=>`anestesiahmtforms${i?i+1:''}@gmail.com`)]) assert.equal(checklist.canEditChecklistStationTitle({...user,email}, manager), true);
  for (const other of [{...user,email:'other@example.com'}, {...user,emailVerified:false}, {...user,uid:''}, null]) assert.equal(checklist.canEditChecklistStationTitle(other, manager), false);
  for (const profile of [{...manager,access:false},{...manager,active:false},{...manager,permissions:{}},null]) assert.equal(checklist.canEditChecklistStationTitle(user,profile),false);
  assert.equal(checklist.canEditChecklistStationTitle({...user,email:'other@example.com'}, {...manager,role:'administrador_app'}),false);
});

test('title validation normalizes whitespace and rejects empty, oversized or control text', () => {
  assert.equal(checklist.normalizeChecklistStationTitle('  Sala   Híbrida  '),'Sala Híbrida');
  assert.equal(checklist.normalizeChecklistStationTitle('x'.repeat(120)).length,120);
  for (const value of ['', '   ', 'x'.repeat(121), 'Sala\u0000 1',null,12]) assert.throws(()=>checklist.normalizeChecklistStationTitle(value),/título/i);
});

test('title transaction preserves QR, maintenance, identity, dates and current catalog fields', async () => {
  const source = readFileSync(new URL('../src/data.js',import.meta.url),'utf8');
  const start = source.indexOf('export async function saveChecklistStationTitle(');
  assert.notEqual(start,-1);
  const end = source.indexOf('\n}',start)+2;
  let stored = {id:'100170010',name:'Arsenal 100170010',qrCode:'QR-1',order:4,active:true,maintenance:{preventiveAnnual:'2027-01-01'},start:'2026-01-01',createdByUid:'creator',createdAt:'CREATED',version:5};
  const original = structuredClone(stored);
  let writes=0;
  const ctx = {navigator:{onLine:true},normalizeChecklistStationTitle:checklist.normalizeChecklistStationTitle,db:{},doc:(_db,collection,id)=>({collection,id}),serverTimestamp:()=>'SERVER',runTransaction:async(_db,task)=>task({get:async()=>({exists:()=>true,data:()=>structuredClone(stored)}),update:(_ref,update)=>{stored={...stored,...update};writes++;}})};
  vm.runInNewContext(source.slice(start,end).replace('export ',''),ctx);
  const saved = await ctx.saveChecklistStationTitle(original.id,' Sala 14 ','manager');
  assert.deepEqual(stored,{...original,functionLabel:'Sala 14',updatedByUid:'manager',updatedAt:'SERVER',version:6});
  assert.equal(saved.functionLabel,'Sala 14');
  await assert.rejects(ctx.saveChecklistStationTitle(original.id,'','manager'),/título/i);
  await assert.rejects(ctx.saveChecklistStationTitle('bad/id','Sala 1','manager'),/arsenal/i);
  await assert.rejects(ctx.saveChecklistStationTitle(original.id,'Sala 1',''),/sessão/i);
  ctx.navigator.onLine=false;
  await assert.rejects(ctx.saveChecklistStationTitle(original.id,'Sala 1','manager'),/Conecte-se/);
  assert.equal(writes,1);
});
