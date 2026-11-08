import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function loadHome()'),source.indexOf('async function loadSchedule()'));
function fixture(){
 let cache=null,reads=0;const handlers={},content={innerHTML:'',isConnected:true},date={value:'',addEventListener:(name,fn)=>handlers[name]=fn};
 const ctx=vm.createContext({session:{status:'signed-in',user:{uid:'one'}},cleanupCurrentModule:null,Date,
  document:{querySelector:id=>id==='#schedule-content'?content:id==='#schedule-date'?date:{addEventListener:(event,fn)=>handlers[id]=fn}},localDateKey:()=> '2026-11-08',shiftDateKey:()=> '2026-11-09',
  homeScheduleCache:{read:(uid,day)=>{assert.equal(uid,'one');reads++;return cache;}},escapeHtml:s=>s,
  buildScheduleView:()=>({positions:[{sigla:'AB'}]}),renderSchedulePositionGrid:(view,options)=>{assert.equal(options.eventsWritable,false);return '<div>AB</div>';},fitSchedulePositionGrid(){},
  fetch:()=>{throw Error('HOME_NETWORK_FORBIDDEN');}});
 vm.runInContext(code,ctx);return {ctx,content,date,handlers,setCache:value=>cache=value,reads:()=>reads};
}
test('entry without cache completes immediately with no remote module import or query',async()=>{
 const h=fixture();await h.ctx.loadHome();assert.match(h.content.innerHTML,/Sem cópia local/);assert.doesNotMatch(code,/import\(|fetch\(|readSchedule|listActiveContacts|listVacationsForDate/);
});
test('return from a module and foreground resume only reread the local preview',async()=>{
 const h=fixture();await h.ctx.loadHome();h.setCache({savedAt:1794139200000,schedule:{stale:true},vacations:[]});
 h.ctx.cleanupCurrentModule.suspend();h.ctx.cleanupCurrentModule.resume();assert.match(h.content.innerHTML,/Cópia deste aparelho/);assert.match(h.content.innerHTML,/AB/);
 h.ctx.cleanupCurrentModule.suspend();h.ctx.cleanupCurrentModule.resumeLocal();assert.equal(h.reads(),3);
 h.handlers['#schedule-next']();assert.equal(h.date.value,'2026-11-09');assert.equal(h.reads(),4);
});
test('disposed, revoked or another user cannot repaint the former preview',async()=>{
 for(const action of [h=>h.ctx.cleanupCurrentModule(),h=>h.ctx.session.status='blocked',h=>h.ctx.session.user.uid='other']){
  const h=fixture();await h.ctx.loadHome();action(h);h.content.innerHTML='new screen';h.ctx.cleanupCurrentModule.resume();assert.equal(h.content.innerHTML,'new screen');assert.equal(h.reads(),1);
 }
});
