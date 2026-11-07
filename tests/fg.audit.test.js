import test from 'node:test';
import assert from 'node:assert/strict';
import {continuityRequestSignature,importContinuitySnapshot} from '../worker-operational-channel/continuity.js';
const now=1800000000000,secret='synthetic-fg-audit-'.repeat(3);
async function request(body){const encoded=JSON.stringify(body),time=String(now),nonce='synthetic-nonce-for-fg-audit';return new Request('https://worker.test/import',{method:'POST',body:encoded,headers:{'Content-Type':'application/json','X-Continuity-Time':time,'X-Continuity-Nonce':nonce,'X-Continuity-Signature':await continuityRequestSignature(secret,encoded,time,nonce)}});}
test('temporary FG audit credential permits only the exact read-only Checklist queue audit',async()=>{
 const calls=[],env={CONTINUITY_IMPORT_SECRET:'different-existing-native-secret'.repeat(2),FG_MIGRATION_AUDIT_SECRET:secret,OPERATIONAL_CHANNEL_STATE:{idFromName:n=>n,get:()=>({fetch:async req=>{calls.push(new URL(req.url).pathname);return Response.json({code:'CONTINUITY_MODULE_AUDIT',pendingChecklists:0,pendingMigrated:0});}})}};
 const r=await importContinuitySnapshot(await request({schemaVersion:1,action:'module-audit',station:'FG'}),env,now);assert.equal(r.status,200);assert.deepEqual(calls,['/continuity-import-nonce','/continuity-module-audit']);
 for(const body of [{schemaVersion:1,action:'drain',station:'FG'},{schemaVersion:1,action:'module-audit',station:'FG',resources:[]}])await assert.rejects(importContinuitySnapshot(await request(body),env,now),e=>e.code==='CONTINUITY_IMPORT_DENIED');
 delete env.FG_MIGRATION_AUDIT_SECRET;await assert.rejects(importContinuitySnapshot(await request({schemaVersion:1,action:'module-audit',station:'FG'}),env,now),e=>e.code==='CONTINUITY_IMPORT_NOT_CONFIGURED');
});
