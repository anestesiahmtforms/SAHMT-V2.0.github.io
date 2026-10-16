import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {emptyInputs,initialDefinitions} from '../src/qmentum-catalog.js';import {historicalImportTransaction,encodeFirestore,decodeFirestore} from '../scripts/lib/qmentum-history-transaction.js';
const host=process.env.FIRESTORE_EMULATOR_HOST;if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
async function fixture(){
 const baseName='projects/demo-sahmt-qhist-'+randomBytes(4).toString('hex')+'/databases/(default)/documents',base='http://'+host+'/v1/'+baseName,uid='synthetic-admin';
 const call=async(suffix,method='POST',body)=>{const r=await fetch(base+suffix,{method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('EMULATOR_HTTP_'+r.status);return r.json();};
 for(const [path,data] of [['users/'+uid,{uid,active:true,access:true}],['qmentumAccess/'+uid,{uid,active:true,role:'manager',units:['sahmt']}],['qmentumConfig/current',{enabled:true,definitionVersion:1}],['qmentumUnits/sahmt',{unitId:'sahmt',active:true}],['qmentumDefinitions/1',initialDefinitions()]])await call('/'+path,'PATCH',{fields:encodeFirestore(data).mapValue.fields});
 const preview={year:2026,unitId:'sahmt',hash:'a'.repeat(64),sourceSheetNames:['Synthetic'],months:Array.from({length:6},(_,i)=>{const inputs=emptyInputs();Object.assign(inputs.counts,{surgical:100,toxicity:0,effectiveToxicity:0,eventEpisodes:1});inputs.legacyRates={QM03:{value:1},QM14:{value:.99}};return{month:i+1,hasInput:true,inputs};}),divergences:[]};
 return{baseName,uid,preview,operator:{kind:'GOOGLE_OAUTH',email:'synthetic@example.invalid'},sourceCells:[{sheet:'Synthetic',address:'A1',value:0}],request:(suffix,body)=>call(suffix,'POST',body),get:path=>call('/'+path,'GET')};
}
test('actual REST historical import atomically creates six months and history and is idempotent',async()=>{
 const f=await fixture();let backups=0;const r=await historicalImportTransaction({...f,apply:true,beforeCommit:async snapshot=>{assert.equal(snapshot.plannedPaths.length,15);backups++;}});assert.equal(r.committed,true);assert.equal(r.writes.length,15);assert.equal(backups,1);
 for(let m=1;m<=6;m++){const path='qmentumUnits/sahmt/months/2026-'+String(m).padStart(2,'0'),data=decodeFirestore({mapValue:{fields:(await f.get(path)).fields}}),history=decodeFirestore({mapValue:{fields:(await f.get(path+'/history/1')).fields}});assert.equal(data.results.QM03.status,'NOT_APPLICABLE');assert.equal(data.results.QM14.status,'INFORMED');assert.equal(data.createdAt.toISOString(),history.createdAt.toISOString());assert.deepEqual(data.inputs,history.inputs);}
 const second=await historicalImportTransaction({...f,apply:true});assert.equal(second.committed,false);assert.equal(second.writes.length,0);
});
test('dry-run and failed protected backup persist no historical month',async()=>{
 const f=await fixture();assert.equal((await historicalImportTransaction(f)).committed,false);await assert.rejects(()=>f.get('qmentumUnits/sahmt/months/2026-01'),/EMULATOR_HTTP_404/);
 await assert.rejects(()=>historicalImportTransaction({...f,apply:true,beforeCommit:async()=>{throw Error('SYNTHETIC_BACKUP_FAILURE');}}),/SYNTHETIC_BACKUP_FAILURE/);await assert.rejects(()=>f.get('qmentumUnits/sahmt/months/2026-06'),/EMULATOR_HTTP_404/);
});
