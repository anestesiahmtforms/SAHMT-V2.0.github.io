import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/data-lite.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
function fixture({enabled=true,deny=false}={}){
 const calls=[],reads=[];
 const ctx=vm.createContext({assertOperationalContentAllowed(){},db:{project:'FA'},operationalModuleEnabled:()=>enabled,
  getOperationalModuleDatabase:async(station,uid)=>{calls.push({station,uid});if(deny)throw Error('MODULE_ACCESS_DENIED');return {project:station};},
  readThroughSafeCache:async options=>options.fetchOnline(),readSafeCache(){},writeSafeCache(){},readFreshSafeCache(){},listUnsettledOperations:async()=>[],
  projectPendingSchedule:value=>value,doc:(database,...path)=>({database,path}),collection:(database,...path)=>({database,path}),query:(ref,...clauses)=>ref,where(){},orderBy(){},limit(){},
  getDoc:async ref=>{reads.push(ref);return {exists:()=>true,id:'2026-11-08',data:()=>({positions:[]})};},getDocs:async ref=>{reads.push(ref);return {docs:[]};}});
 vm.runInContext(source,ctx);return {ctx,calls,reads};
}
test('explicit Escala reads schedule and vacations only in FJ for the current identity',async()=>{const f=fixture();await f.ctx.readSchedule('2026-11-08','u1',{independent:true});await f.ctx.listVacationsForDate('2026-11-08',{uid:'u1',independent:true});assert.deepEqual(f.calls,[{station:'FJ',uid:'u1'},{station:'FJ',uid:'u1'}]);assert.ok(f.reads.every(ref=>ref.database.project==='FJ'));assert.deepEqual(f.reads.map(ref=>ref.path[0]),['scheduleDays','vacations']);});
for(const options of [{enabled:false},{deny:true}])test(`unavailable Escala cannot fall back to FA: ${JSON.stringify(options)}`,async()=>{const f=fixture(options);await assert.rejects(f.ctx.readSchedule('2026-11-08','u1',{independent:true}));await assert.rejects(f.ctx.listVacationsForDate('2026-11-08',{uid:'u1',independent:true}));assert.equal(f.reads.length,0);});

test("disabled content stops before cache, exchange or Firestore reads",async()=>{const f=fixture();f.ctx.assertOperationalContentAllowed=()=>{throw Error("FOLDER_DISABLED");};await assert.rejects(f.ctx.readSchedule("2026-11-08","u1"),/FOLDER_DISABLED/);assert.equal(f.calls.length,0);assert.equal(f.reads.length,0);});
