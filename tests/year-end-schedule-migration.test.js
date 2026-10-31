import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFields,decodeFields} from '../worker-training/firestore.js';
import {migrateYearEndTotals} from '../scripts/lib/year-end-totals-migration.js';
const projectId='demo-sahmt-year-end',base='yearEndSchedules/2026-2027';
function fixture(hasRecord=true){
  const docs=new Map(),transactions=new Map(),calls=[];let revision=0,transactionId=0;
  const put=(path,data)=>docs.set(path,{name:`projects/${projectId}/databases/(default)/documents/${path}`,fields:encodeFields(data),updateTime:'revision-'+ ++revision});
  put(base+'/policy/participation',{schemaVersion:1,cycle:'2026-2027',siglasByUid:{one:'AB',fr:'FR'},excludedUids:[]});
  const record=()=>({uid:'one',sigla:'AB',position:1,plantao:'natal',grupo:'reveillon',createdAt:1,updatedAt:1});
  if(hasRecord){put(base+'/registrations/one',record());put(base+'/control/order',{lastPosition:1,lastParticipantUid:'one',updatedAt:1});}
  const copy=x=>x?structuredClone(x):null;
  const request=async(path,body)=>{
    calls.push({path,body});
    if(path===':beginTransaction'){const transaction='tx-'+ ++transactionId;transactions.set(transaction,new Map());return {transaction};}
    if(path===':rollback'){transactions.delete(body.transaction);return {};}
    if(path===':commit'){
      for(const [key,version] of transactions.get(body.transaction)||[])if(docs.get(key)?.updateTime!==version)throw Object.assign(Error('ABORTED'),{code:'ABORTED'});
      for(const write of body.writes){const key=write.update.name.split('/documents/')[1],prior=docs.get(key),data=decodeFields(write.update.fields||{});
        if(write.currentDocument?.exists===false&&prior||write.currentDocument?.updateTime&&prior?.updateTime!==write.currentDocument.updateTime)throw Object.assign(Error('ABORTED'),{code:'ABORTED'});
        put(key,write.updateMask?{...decodeFields(prior?.fields||{}),...data}:data);
      }
      transactions.delete(body.transaction);return {};
    }
    const url=new URL('http://emulator'+path),key=url.pathname.slice(1),tx=url.searchParams.get('transaction');
    if(key.endsWith(':runQuery')){
      const rows=[...docs].filter(([key])=>key.startsWith(base+'/registrations/'));
      if(body.transaction)for(const [key,value] of rows)transactions.get(body.transaction).set(key,value.updateTime);
      return rows.map(([,document])=>({document:copy(document)}));
    }
    if(tx)transactions.get(tx).set(key,docs.get(key)?.updateTime);
    return copy(docs.get(key));
  };
  return {request,put,docs,calls,record};
}

test('migration includes an in-flight legacy edit even when the old counter does not change',async()=>{
  const f=fixture();let edited=false;
  const report=await migrateYearEndTotals({request:f.request,projectId,apply:true,onPlan:()=>{if(!edited){edited=true;f.put(base+'/registrations/one',{...f.record(),plantao:'reveillon'});}}});
  assert.equal(report.totals.plantaoNatal,0);assert.equal(report.totals.plantaoReveillon,1);
  assert.ok(f.calls.filter(c=>c.path===':commit').every(c=>c.body.transaction));
  assert.equal(decodeFields(f.docs.get(base+'/registrations/one').fields).plantao,'reveillon');
});

test('migration tracks a missing legacy counter and retries a concurrent first registration',async()=>{
  const f=fixture(false);let created=false;
  const report=await migrateYearEndTotals({request:f.request,projectId,apply:true,onPlan:()=>{if(!created){created=true;f.put(base+'/registrations/one',f.record());f.put(base+'/control/order',{lastPosition:1,lastParticipantUid:'one'});}}});
  assert.equal(report.registrations,1);assert.equal(report.totals.plantaoNatal,1);
  assert.equal(decodeFields(f.docs.get(base+'/summary/totals').fields).totalRegistrations,1);
  assert.ok(f.calls.some(c=>c.path.startsWith('/'+base+'/control/order?transaction=')));
});

test('legacy migration never downgrades an active Carnival revision or reopens a paused reset',async()=>{
 const f=fixture(false);f.put(base+'/policy/participation',{schemaVersion:1,cycle:'2026-2027',siglasByUid:{one:'AB'},summaryVersion:2,resetId:'carnaval-2027-v2'});
 f.put(base+'/summary/totals',{plantaoNatal:0,plantaoReveillon:0,plantaoCarnaval:0,grupoNatal:0,grupoReveillon:0,totalRegistrations:0});
 await migrateYearEndTotals({request:f.request,projectId,apply:true});assert.equal(decodeFields(f.docs.get(base+'/policy/participation').fields).summaryVersion,2);assert.equal(f.calls.filter(c=>c.path===':commit').length,0);
 f.put(base+'/policy/participation',{schemaVersion:1,cycle:'2026-2027',siglasByUid:{one:'AB'},summaryVersion:0,resetId:'carnaval-2027-v2'});
 await assert.rejects(migrateYearEndTotals({request:f.request,projectId,apply:true}),/RESET_REQUIRES_ACTIVATION/);
});
