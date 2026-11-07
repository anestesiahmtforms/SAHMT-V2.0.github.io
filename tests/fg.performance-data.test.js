import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFgPerformance} from '../src/fg-performance-data.js';
import {fgPerformanceMarkup} from '../src/fg-performance-ui.js';
function fixture({active=true,incomplete=false}={}){
  const database={station:'FG'},reads=[];
  const rows=values=>({docs:values.map(value=>({id:value.uid||value.id,data:()=>value}))});
  const sdk={doc:(db,path,id)=>{assert.equal(db,database);return {path,id};},collection:(db,path)=>{assert.equal(db,database);return {path};},query:(ref,...filters)=>({...ref,filters}),where:(...args)=>args,orderBy:(...args)=>args,limit:n=>n,
    getDoc:async ref=>{reads.push(ref.path);return {exists:()=>active,data:()=>({status:'ACTIVE',projectId:'sahmt-checklist-fg',rule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2',activatedAt:'2026-11-07T19:00:00Z'})};},getDocs:async ref=>{reads.push(ref.path);if(ref.path==='users')return rows([{uid:'u',id:'u',displayName:'Member <script>',active:true,access:true},...(incomplete?Array.from({length:400},(_,n)=>({uid:'extra'+n,id:'extra'+n,active:true,access:true})):[])]);if(ref.path==='fgPerformanceSummaries')return rows([]);if(ref.path==='fgPerformanceLedger')return rows([]);throw Error('UNEXPECTED_COLLECTION');}};
  return {database,sdk,reads};
}
test('inactive FG never invents a confirmed zero or loads identities',async()=>{
  const f=fixture({active:false});await assert.rejects(loadFgPerformance({...f,uid:'u'}),/aguardando confirmação/);assert.deepEqual(f.reads,['fgPerformanceRuntime']);
});
test('active FG reads its own ledger and preserves a confirmed zero without source fallback',async()=>{
  const f=fixture(),data=await loadFgPerformance({...f,uid:'u'});assert.equal(data.summary.total,0);assert.equal(data.ledger.length,0);assert.ok(f.reads.every(path=>!path.startsWith('faPerformance')));
  const html=fgPerformanceMarkup(data);assert.match(html,/Desempenho FG/);assert.match(html,/Member &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/sábados, domingos e feriados nacionais/);
});
test('incomplete directories and changed sessions reject the result',async()=>{
  await assert.rejects(loadFgPerformance({...fixture({incomplete:true}),uid:'u'}),/aguardando confirmação/);
  let calls=0;await assert.rejects(loadFgPerformance({...fixture(),uid:'u',isCurrent:()=>++calls===1}),/aguardando confirmação/);
});
