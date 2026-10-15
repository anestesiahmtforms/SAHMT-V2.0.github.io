import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

test('failed unit, period and definition loads preserve the prior scope and draft',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});
 let browser;
 try {
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port,base=server.config.base;
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+base+'tests/fixtures/qmentum-runtime.html');
  await page.evaluate(async base=>{
   const {mountQmentumModule}=await import(base+'src/qmentum-ui.js'),{initialDefinitions,emptyInputs}=await import(base+'src/qmentum-catalog.js');
   const definitions=initialDefinitions(),now=new Date(),year=now.getFullYear(),month=now.getMonth()+1,period=year+'-'+String(month).padStart(2,'0');
   const state={year,month,period,failedUnit:null,failedYear:null,failedDefinition:false,writes:[],drafts:new Map(),definitionReads:0};
   const record={unitId:'unit-a',year,month,period,version:1,status:'DRAFT',definitionVersion:1,referenceDate:period+'-01',inputs:emptyInputs()};
   const repo={
    open:async()=>({access:{role:'manager'},units:[{unitId:'unit-a',name:'Unit A'},{unitId:'unit-b',name:'Unit B'}],definitions}),
    year:async(unit,y)=>{if(unit===state.failedUnit||y===state.failedYear)throw Error('synthetic offline');return [{...structuredClone(record),unitId:unit,year:y,definitionVersion:state.failedDefinition?2:1}];},
    definition:async version=>{state.definitionReads++;if(version===2)throw Error('synthetic definition failure');return structuredClone(definitions);},
    save:async input=>{state.writes.push(structuredClone(input));return {version:2};}
   };
   const key=s=>[s.uid,s.unitId,s.period].join(':');
   const drafts={read:s=>structuredClone(state.drafts.get(key(s))||null),save:(s,value)=>state.drafts.set(key(s),structuredClone(value)),remove:s=>state.drafts.delete(key(s))};
   window.runtime=state;window.runtime.cleanup=await mountQmentumModule(document.querySelector('#root'),{repository:repo,uid:'synthetic-runtime',drafts});
  },base);
  await page.locator('[data-qm-indicator="QM01"]').click();
  await page.locator('[data-count="techniqueChanges"]').fill('7');
  await page.locator('[data-qm-close]').click();
  const originalDate=await page.locator('#qm-date').inputValue();
  await page.evaluate(()=>window.runtime.failedUnit='unit-b');
  await page.locator('#qm-unit').selectOption('unit-b');
  await page.waitForFunction(()=>document.querySelector('.qm-module-status').textContent.includes('Não foi possível'));
  assert.equal(await page.locator('#qm-unit').inputValue(),'unit-a');
  await page.locator('[data-qm-indicator="QM01"]').click();
  assert.equal(await page.locator('[data-count="techniqueChanges"]').inputValue(),'7');
  await page.locator('[data-qm-action="save"]').click();
  await page.waitForFunction(()=>window.runtime.writes.length===1&&!document.querySelector('[data-qm-action="save"]').disabled);
  assert.equal(await page.evaluate(()=>window.runtime.writes[0].unitId),'unit-a');
  await page.locator('[data-count="techniqueChanges"]').fill('9');
  const nextYear=await page.evaluate(()=>{window.runtime.failedYear=window.runtime.year+1;return window.runtime.failedYear;});
  await page.locator('[data-date]').fill(nextYear+'-02-10');await page.locator('[data-date]').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('.qm-status').textContent.includes('Não foi possível'));
  assert.equal(await page.locator('[data-date]').inputValue(),originalDate);
  assert.equal(await page.locator('[data-count="techniqueChanges"]').inputValue(),'9');
  await page.locator('[data-qm-close]').click();
  await page.evaluate(()=>{window.runtime.failedYear=null;window.runtime.failedDefinition=true;});
  await page.locator('#qm-date').fill(nextYear+'-02-10');await page.locator('#qm-date').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('.qm-module-status').textContent.includes('Não foi possível'));
  assert.equal(await page.locator('#qm-date').inputValue(),originalDate);
  await page.locator('[data-qm-indicator="QM01"]').click();
  assert.equal(await page.locator('[data-count="techniqueChanges"]').inputValue(),'9');
  const draft=await page.evaluate(()=>[...window.runtime.drafts].map(([key,value])=>({key,count:value.inputs.counts.techniqueChanges})));
  assert.deepEqual(draft,[{key:'synthetic-runtime:unit-a:'+originalDate.slice(0,7),count:9}]);
  assert.equal(await page.evaluate(()=>window.runtime.writes.length),1);
  await page.evaluate(()=>window.runtime.cleanup());
 } finally {await browser?.close();await server.close();}
});
