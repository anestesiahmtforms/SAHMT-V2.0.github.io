import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isChecklistScienceOpen} from '../src/checklist-science-clock.js';
const source=(await Promise.all(['Performance.gs','ScoringClock.gs'].map(name=>readFile(new URL('../apps-script-fg/'+name,import.meta.url),'utf8')))).join('\n');
function fixture(time){
  let now=new Date(time).getTime(),sequence=0;const props=new Map(),triggers=new Map();
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const c=vm.createContext({Date:ClockDate,Map,fgNativeOwner_(){},sahmtV2Properties_:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)}),Utilities:{formatDate:(date,zone,format)=>{assert.equal(zone,'America/Sao_Paulo');const local=new Date(date.getTime()-3*3600000).toISOString();return format==='yyyy-MM-dd'?local.slice(0,10):local.slice(11,19);},parseDate:(text,zone)=>{assert.equal(zone,'America/Sao_Paulo');return new ClockDate(text.replace(' ','T')+'-03:00');}},ScriptApp:{getProjectTriggers:()=>[...triggers.values()],deleteTrigger:trigger=>triggers.delete(trigger.getUniqueId()),newTrigger:handler=>({timeBased(){return this;},at(due){this.due=due;return this;},everyMinutes(){assert.fail('Scoring cannot use a periodic five-minute task');},create(){const id=String(++sequence),trigger={getUniqueId:()=>id,getHandlerFunction:()=>handler,due:this.due};triggers.set(id,trigger);return trigger;}})}});
  vm.runInContext(source,c);return {c,props,triggers,setNow:time=>{now=new Date(time).getTime();}};
}
test('science is allowed before 23:59 and closes exactly at 23:59 São Paulo, including the UTC date boundary',()=>{
  assert.equal(isChecklistScienceOpen('2026-11-07',new Date('2026-11-08T02:58:59.999Z')),true);
  assert.equal(isChecklistScienceOpen('2026-11-07',new Date('2026-11-08T02:59:00Z')),false);
  assert.equal(isChecklistScienceOpen('2026-11-07',new Date('2026-11-08T03:00:00Z')),false);
});
test('native scoring installs only one daily 23:59 trigger, never 11:59 or every five minutes',()=>{
  const f=fixture('2026-11-07T15:00:00Z'),scheduled=f.c.instalarApuracaoChecklistFG_();
  assert.equal(scheduled.dueAt,'2026-11-08T02:59:00.000Z');assert.equal(f.triggers.size,1);
  assert.equal(f.c.fgClaimScoringClock_(null),null);assert.equal(f.triggers.size,1);
  f.setNow('2026-11-08T02:59:00Z');assert.equal(f.c.fgClaimScoringClock_({triggerUid:scheduled.triggerUid}).toISOString(),scheduled.dueAt);
  assert.equal(f.triggers.size,1);assert.equal([...f.triggers.values()][0].due.toISOString(),'2026-11-09T02:59:00.000Z');
  assert.equal(f.c.fgClaimScoringClock_({triggerUid:scheduled.triggerUid}),null);
});
test('an early delivery reschedules the deadline and cannot score before closing',()=>{
  const f=fixture('2026-11-07T15:00:00Z'),scheduled=f.c.instalarApuracaoChecklistFG_();
  assert.equal(f.c.fgClaimScoringClock_({triggerUid:scheduled.triggerUid}),null);assert.equal(f.triggers.size,1);
  assert.equal([...f.triggers.values()][0].due.toISOString(),scheduled.dueAt);
});
