import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {resolveChecklistRotationCore} from '../src/checklist-rotation-core.js';
import {weekdayForDate, resolveScheduleSiglas} from '../src/schedule-view.js';

const source = await readFile(new URL('../src/checklist-rotation-core.js', import.meta.url), 'utf8');
const generated = await readFile(new URL('../apps-script-v2/ChecklistRotationCore.gs', import.meta.url), 'utf8');

test('Apps Script rotation code is generated exactly from the PWA shared source', () => {
  assert.equal(generated, source.replace(/^export function /gm, 'function '));
});

test('same rotation calculation in PWA and Apps Script covers events, vacations, aliases and malformed sources', () => {
  const context = vm.createContext({Intl, Date, Object, Array, Number, String, RegExp, Set, Map});
  vm.runInContext(generated, context);
  const cases = [
    {day:'2026-10-12',schedule:{date:'2026-10-12',positions:[{position:1,sigla:'AA'},{position:2,sigla:'BB'}],highlights:{events:[]}},vacations:[]},
    {day:'2026-10-12',schedule:{date:'2026-10-12',positions:[{position:1,sigla:'AA'},{position:2,sigla:'BB'}],highlights:{events:['EVENTO:AA:AA:event-fixture']}},vacations:[]},
    {day:'2026-10-12',schedule:{date:'2026-10-12',positions:[{position:1,sigla:'AA'},{position:2,sigla:'BB'}],highlights:{events:[]}},vacations:[{active:true,start:'2026-10-12',end:'2026-10-12',siglas:['AA']}]},
    {day:'2026-10-12',schedule:{date:'2026-10-12',positions:[{position:1,sigla:'DC'},{position:2,sigla:'BB'}],highlights:{events:[]}},vacations:[]},
    {day:'2026-10-12',schedule:{date:'2026-10-12',positions:[{position:2,sigla:'AA'}],highlights:{events:[]}},vacations:[]},
    {day:'2026-10-12',schedule:{date:'2026-10-12',positions:[{position:1,sigla:'AA'}],highlights:{events:['EVENTO:AA:AA:bad event!']}},vacations:[]}
  ];
  for (const input of cases) assert.deepEqual(JSON.parse(JSON.stringify(context.resolveChecklistRotationCore(input))), resolveChecklistRotationCore(input));
  assert.equal(weekdayForDate('2026-10-12'),'segunda');
  assert.deepEqual(resolveScheduleSiglas('DC','segunda'),['CR','LH']);
});

test('primeira pessoa disponível assume a posição efetiva 1 após férias ou evento em posições anteriores', () => {
  const schedule={date:'2026-10-12',positions:[
    {position:1,sigla:'AA'},{position:2,sigla:'BB'},{position:3,sigla:'CC'},{position:4,sigla:'DD'}
  ],highlights:{events:[]}};
  const cases=[
    {vacations:[{active:true,start:'2026-10-12',end:'2026-10-12',siglas:['AA']}], expected:'BB'},
    {vacations:[{active:true,start:'2026-10-12',end:'2026-10-12',siglas:['AA','BB']}], expected:'CC'},
    {vacations:[],schedule:{...schedule,highlights:{events:['EVENTO:AA:AA:event-a','EVENTO:BB:BB:event-b']}},expected:'CC'}
  ];
  for(const input of cases){
    const result=resolveChecklistRotationCore({day:'2026-10-12',schedule:input.schedule||schedule,vacations:input.vacations});
    assert.equal(result.sigla,input.expected);assert.equal(result.position,1);assert.equal(result.complete,true);
  }
});
