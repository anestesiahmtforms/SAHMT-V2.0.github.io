import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/data-lite.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
function setup({enabled=true,deny=false}={}){
 const calls=[],reads=[];
 const ctx=vm.createContext({db:{project:'FA'},operationalModuleEnabled:station=>station==='FI'&&enabled,
  getOperationalModuleDatabase:async(station,uid)=>{calls.push({station,uid});if(deny)throw Error('MODULE_ACCESS_DENIED');return {project:'FI'};},
  readThroughSafeCache:async options=>options.fetchOnline(),readSafeCache(){},writeSafeCache(){},readFreshSafeCache(){},listUnsettledOperations:async()=>[],
  collection:(database,name)=>({database,name}),query:(collection,...clauses)=>({collection,clauses}),where(){},orderBy(){},limit:n=>({limit:n}),
  getDocs:async value=>{reads.push(value);return {docs:[{id:'AA',data:()=>({active:true})}]};}});
 vm.runInContext(source,ctx);return {ctx,calls,reads};
}
test('opening migrated Escala reads its contacts catalog from FI, not FA',async()=>{const f=setup();const result=await f.ctx.listActiveContacts({uid:'u1',independent:true});assert.deepEqual(f.calls,[{station:'FI',uid:'u1'}]);assert.equal(f.reads[0].collection.database.project,'FI');assert.deepEqual(JSON.parse(JSON.stringify(result)),[{id:'AA',active:true}]);});
test('unavailable FI fails closed without falling back to the FA contacts collection',async()=>{for(const config of [{enabled:false},{deny:true}]){const f=setup(config);await assert.rejects(f.ctx.listActiveContacts({uid:'u1',independent:true}));assert.equal(f.reads.length,0);}});
