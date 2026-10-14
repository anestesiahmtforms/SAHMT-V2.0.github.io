import test from 'node:test';import assert from 'node:assert/strict';
import {createManagementLeaseAccess} from '../src/management-lease-access.js';
function fixture(){let time=1000000,reads=0,connects=0;const faAuth={currentUser:{uid:'u'}},secondaryAuth={currentUser:{uid:'u'}};
 const lease=()=>({sourceProjectId:'sahmt-17a16',destinationProjectId:'sahmt-gestao-5ae66',faUid:'u',fbUid:'u',active:true,revoked:false,managementAllowed:true,confirmedAtMs:time,validUntilMs:time+300000});
 const args={uid:'u',faAuth,secondaryAuth,readLease:async()=>{reads++;return lease();},connect:async()=>{connects++;return {targets:{FB:{status:'ready'}}};}};
 return {args,lease,service:createManagementLeaseAccess({now:()=>time}),advance:ms=>time+=ms,counts:()=>({reads,connects})};}
test('on demand lease access caches until expiry margin without polling',async()=>{const f=fixture();await f.service.ensure(f.args);await f.service.ensure(f.args);assert.deepEqual(f.counts(),{reads:1,connects:0});f.advance(280000);await f.service.ensure(f.args);assert.equal(f.counts().reads,2);});
test('concurrent accesses share one lease read',async()=>{const f=fixture();await Promise.all([f.service.ensure(f.args),f.service.ensure(f.args),f.service.ensure(f.args)]);assert.equal(f.counts().reads,1);});
test('expired lease is renewed once and checked before returning',async()=>{const f=fixture();let n=0;f.args.readLease=async()=>{if(++n===1)throw Object.assign(Error('denied'),{code:'permission-denied'});return f.lease();};await f.service.ensure(f.args);assert.equal(n,2);assert.equal(f.counts().connects,1);});
test('network failure does not trigger a renewal loop or change FA',async()=>{const f=fixture(),user=f.args.faAuth.currentUser;f.args.readLease=async()=>{throw Object.assign(Error('offline'),{code:'unavailable'});};await assert.rejects(()=>f.service.ensure(f.args),/offline/);assert.equal(f.counts().connects,0);assert.equal(f.args.faAuth.currentUser,user);});
test('falha do broker mostra somente código sanitizado para diagnosticar renovação',async()=>{
 const f=fixture();f.args.readLease=async()=>null;
 f.args.connect=async()=>({status:'partial',targets:{FB:{status:'unavailable',code:'CONNECT_TIMEOUT'}}});
 await assert.rejects(()=>f.service.ensure(f.args),/MANAGEMENT_LEASE_RENEWAL_FAILED: CONNECT_TIMEOUT/);
 const unsafe=fixture();unsafe.args.readLease=async()=>null;
 unsafe.args.connect=async()=>({status:'unavailable',code:'token privado',targets:{}});
 await assert.rejects(()=>unsafe.service.ensure(unsafe.args),error=>error.message==='MANAGEMENT_LEASE_RENEWAL_FAILED');
});
test('revoked lease or UID mismatch remains denied after one renewal',async()=>{for(const patch of [{revoked:true},{fbUid:'other'},{validUntilMs:999999}]){const f=fixture();f.args.readLease=async()=>({...f.lease(),...patch});await assert.rejects(()=>f.service.ensure(f.args),/INVALID/);assert.equal(f.counts().connects,1);}});
test('late read after user switch cannot cache the previous lease',async()=>{const f=fixture();f.args.readLease=async()=>{f.args.faAuth.currentUser={uid:'other'};return f.lease();};await assert.rejects(()=>f.service.ensure(f.args),/SESSION_CHANGED/);assert.equal(f.counts().connects,0);});
