import test from 'node:test';import assert from 'node:assert/strict';
import {restoreTypedSnapshotInEmulator} from '../scripts/lib/fa-consolidation-restore.js';
const time='2026-10-15T10:00:00.123456Z';
const snapshot={schemaVersion:1,projectId:'sahmt-gestao-5ae66',databaseId:'(default)',readTime:time,coverage:{complete:true,consistent:true,rootCollections:['trainings']},
 documents:[{path:'trainings/synthetic',fields:{integer:{integerValue:'9223372036854775807'},stamp:{timestampValue:time},bytes:{bytesValue:'AAE='},ref:{referenceValue:'projects/sahmt-gestao-5ae66/databases/(default)/documents/trainings/synthetic'},nested:{mapValue:{fields:{values:{arrayValue:{values:[{booleanValue:true},{doubleValue:'NaN'}]}}}}}},createTime:time,updateTime:time}]};
test('restore rejects production hosts and non-demo projects before any request',async()=>{
 for(const patch of [{host:'firestore.googleapis.com:443'},{host:'127.0.0.1:8080',projectId:'sahmt-17a16'}])await assert.rejects(()=>restoreTypedSnapshotInEmulator({snapshot,...patch,fetchImpl:()=>{throw Error('called');}}),/EMULATOR_REQUIRED/);
});
test('typed Firestore values survive a real emulator restoration', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const result=await restoreTypedSnapshotInEmulator({snapshot});assert.equal(result.verified,1);assert.equal(result.productionWrites,0);
});
