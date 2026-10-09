import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createManagementBrokerFirestoreAdapter} from '../scripts/lib/management-broker-firestore-adapter.js';
import {createManagementAuthBroker} from '../scripts/lib/management-auth-broker.js';

// Everything below is synthetic. fetchImpl is an in-memory REST double;
// there are no emulators, credentials, project API calls or production records.
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',UID='synthetic-member-a',BASE=Date.parse('2026-10-09T12:00:00Z');
const permissionNames=['admin','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead',
  'managementIndicatorsWrite','managementPlansManage','documentsManage','equipmentManage','qualityManage','trainingsManage','financeRead','financeWrite','financeManage'];
const clone=value=>JSON.parse(JSON.stringify(value));
const canon=value=>Array.isArray(value)?'['+value.map(canon).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}':JSON.stringify(value);
const digest=value=>createHash('sha256').update(canon(value)).digest('hex');
const name=(project,collection,uid=UID)=>'projects/'+project+'/databases/(default)/documents/'+collection+'/'+uid;
const leaseName=name(FB,'managementAuthorizationLeases'),sourceName=name(FA,'managementSourceContexts');
const fenceName=grant=>name(FB,'managementAuthorizationFences',digest([UID,grant]));
const iso=time=>new Date(time).toISOString();
const revision=n=>iso(BASE).replace('.000Z','.000000'+String(n).padStart(3,'0')+'Z');
const fields=value=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key, item===null?{nullValue:null}:typeof item==='boolean'?{booleanValue:item}
  :typeof item==='number'?{integerValue:String(item)}:typeof item==='string'?{stringValue:item}:Array.isArray(item)?{arrayValue:{values:item.map(encode)}}:{mapValue:{fields:fields(item)}}]));
const encode=item=>item===null?{nullValue:null}:typeof item==='boolean'?{booleanValue:item}:typeof item==='number'?{integerValue:String(item)}
  :typeof item==='string'?{stringValue:item}:Array.isArray(item)?{arrayValue:{values:item.map(encode)}}:{mapValue:{fields:fields(item)}};
const decode=item=>Object.hasOwn(item,'stringValue')?item.stringValue:Object.hasOwn(item,'integerValue')?Number(item.integerValue)
  :Object.hasOwn(item,'booleanValue')?item.booleanValue:Object.hasOwn(item,'nullValue')?null:Object.hasOwn(item,'arrayValue')
    ?(item.arrayValue.values??[]).map(decode):decodeFields(item.mapValue.fields??{});
const decodeFields=map=>Object.fromEntries(Object.entries(map).map(([key,item])=>[key,decode(item)]));
const permissions=()=>Object.fromEntries(permissionNames.map(key=>[key,key==='managementRead']));
const policy=()=>({schemaVersion:1,policyVersion:'synthetic-policy-v1',operationTimeoutMs:1000,maxResponseBytes:1048576,maxResponseChunks:100,
  maxSnapshotAgeMs:5000,maxFutureSkewMs:0,sourceMaxAgeMs:5000,sourceMaxLeaseMs:10000,leaseMaxDurationMs:10000,
  maxReservationRecords:100,maxSourceVersions:100,readBudget:{dailyLimits:{[FA]:45000,[FB]:35000},limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',
    quotaTimezone:'America/Los_Angeles',maxMeasurementAgeMs:5000,applicationReserveReads:100,metricLagReserveReads:100,
    operationReadBounds:{readFaAuthorization:1,readFbLease:1,writeFbLease:2,invalidateFbLease:2}}});
const lease=()=>({schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,faUid:UID,fbUid:UID,memberId:'synthetic-stable-a',leaseVersion:1,
  grantId:'synthetic-grant-a',sourceVersion:7,policyVersion:'synthetic-policy-v1',sourceHash:'a'.repeat(64),active:true,revoked:false,
  managementAllowed:true,role:'profissional',permissions:permissions(),memberAreaIds:[],managerAreaIds:[],documentGroups:['GENERAL'],
  sourceAuthValidAfterTimeMs:0,confirmedAtMs:BASE-100,validUntilMs:BASE+5000});
const source=()=>{
  const value={schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,productionAuthorized:true,coverageComplete:true,authorizationVersion:7,
    sourceVersion:7,sourceHash:'',policyVersion:'synthetic-policy-v1',confirmedAtMs:BASE-100,validUntilMs:BASE+5000,
    profile:{uid:UID,memberId:'synthetic-stable-a',active:true,access:true,role:'profissional',permissions:permissions()},
    binding:{sourceProjectId:FA,destinationProjectId:FB,faUid:UID,fbUid:UID,memberId:'synthetic-stable-a'},
    areas:[],documentAccess:{active:true,groups:['GENERAL'],googleUid:'synthetic-google-a'},managementAllowed:true,sourceAuthValidAfterTimeMs:0};
  value.sourceHash=digest({sourceProjectId:FA,destinationProjectId:FB,faUid:UID,fbUid:UID,memberId:'synthetic-stable-a',authorizationVersion:7,
    active:true,managementAllowed:true,role:'profissional',permissions:value.profile.permissions,memberAreaIds:[],managerAreaIds:[],documentGroups:['GENERAL'],
    sourceAuthValidAfterTimeMs:0,googleUid:'synthetic-google-a'});return value;
};
const fence=()=>({schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,uid:UID,grantId:'synthetic-grant-a',leaseVersion:1,fencedAtMs:BASE,reasonCode:'SYNTHETIC_CANCELLED'});
const response=(url,data,status=200,extra={})=>{const value=new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...extra}});
  Object.defineProperty(value,'url',{value:url});return value;};
const readRequest={projectId:FB,uid:UID},writeRequest=()=>({...readRequest,expectedRevision:null,lease:lease()});
const cleanupRequest=()=>({...readRequest,expectedGrantId:'synthetic-grant-a',expectedLeaseVersion:1,reasonCode:'SYNTHETIC_CANCELLED'});
function harness(options={}){
  let time=BASE,seq=1,reservation=0;const docs=new Map(),txs=new Map(),calls=[],totals=new Map();
  const put=(path,value)=>docs.set(path,{data:clone(value),revision:revision(++seq)});
  const get=path=>docs.has(path)?clone(docs.get(path).data):null;
  const control={put,get,docs,calls,advance:amount=>{time+=amount;},time:()=>time};
  const fetchImpl=async(url,init)=>{
    const operation=url.split(':').at(-1),body=JSON.parse(init.body);calls.push({operation,body:clone(body)});
    assert.equal(new URL(url).host,'firestore.googleapis.com');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
    assert.match(init.headers.Authorization,/^Bearer synthetic-oauth-token$/);
    if(options.beforeRpc)await options.beforeRpc(operation,body,control);
    if(options.rpc){const replaced=await options.rpc(operation,body,url,control);if(replaced)return replaced;}
    if(operation==='beginTransaction'){const transaction=Buffer.from('synthetic-tx-'+(++seq)).toString('base64');txs.set(transaction,new Map());return response(url,{transaction});}
    if(operation==='batchGet'){
      return response(url,body.documents.map(path=>{
        const record=docs.get(path);if(body.transaction)txs.get(body.transaction).set(path,record?.revision??null);
        return record?{found:{name:path,fields:fields(record.data),createTime:iso(BASE-1000),updateTime:record.revision},readTime:time===BASE?revision(999):iso(time)}
          :{missing:path,readTime:time===BASE?revision(999):iso(time)};
      }));
    }
    if(operation==='commit'){
      const observed=txs.get(body.transaction);assert.ok(observed,'known transaction');
      if([...observed].some(([path,old])=>(docs.get(path)?.revision??null)!==old))return response(url,{error:{status:'ABORTED'}},409);
      for(const write of body.writes){assert.equal('delete' in write,false);assert.equal('updateMask' in write,false);
        const prior=docs.get(write.update.name);if(write.currentDocument.exists===false?prior:prior?.revision!==write.currentDocument.updateTime)
          return response(url,{error:{status:'FAILED_PRECONDITION'}},409);}
      const writeResults=body.writes.map(write=>{put(write.update.name,decodeFields(write.update.fields));return {updateTime:docs.get(write.update.name).revision};});
      return response(url,{writeResults,commitTime:time===BASE?revision(999):iso(time)});
    }
    if(operation==='rollback'){txs.delete(body.transaction);return response(url,{});}
    throw new Error('unlisted synthetic method');
  };
  const budget=async(request,context)=>{
    calls.push({operation:'reserve',request:clone(request)});assert.ok(context.deadlineMs>time);
    if(options.reserve)return options.reserve(request,control);
    const total=(totals.get(request.projectId)??0)+request.maximumReads;totals.set(request.projectId,total);
    return {schemaVersion:1,projectId:request.projectId,operation:request.operation,reservationId:'synthetic-reservation-'+(++reservation),quotaTimezone:'America/Los_Angeles',
      quotaDay:'2026-10-09',dailyLimit:request.dailyLimit,pausedRequiresReview:false,metricsComplete:true,measurementTimeMs:time,expiresAtMs:time+5000,
      reservedReads:request.maximumReads,totalReadCount:1000,outstandingReservedReads:total,unreportedConsumedReads:0,applicationReserveReads:100,metricLagReserveReads:100};
  };
  const adapter=createManagementBrokerFirestoreAdapter({enabled:options.enabled??true,policy:options.policy??policy(),fetchImpl,
    getAdminAccessToken:options.credential??(async()=>{calls.push({operation:'credential'});return {credentialType:'google-oauth2',accessToken:'synthetic-oauth-token',
      expiresAtMs:time+60000,scopes:['https://www.googleapis.com/auth/datastore']};}),
    readFaAuthUser:options.auth??(async()=>{calls.push({operation:'auth'});return {schemaVersion:1,projectId:FA,fromCache:false,hasPendingWrites:false,readTimeMs:time,
      user:{uid:UID,disabled:false,emailVerified:true,googleUid:'synthetic-google-a',tokensValidAfterTimeMs:0,providerData:[{providerId:'google.com',uid:'synthetic-google-a'}]}};}),
    reserveFirestoreReads:budget,clock:()=>time});
  return {...control,adapter,reserveFirestoreReads:budget};
}
const count=(h,operation)=>h.calls.filter(value=>value.operation===operation).length;
const code=expected=>error=>error.code===expected && !error.message.includes('synthetic-oauth-token');
test('disabled: no budget, credentials, Auth or REST',async()=>{
  const h=harness({enabled:false});await assert.rejects(h.adapter.readFbLease(readRequest),code('FIRESTORE_ADAPTER_DISABLED'));assert.equal(h.calls.length,0);
});
test('budget pause denies before credentials/REST',async()=>{
  const h=harness({reserve:async()=>({pausedRequiresReview:true})});await assert.rejects(h.adapter.readFbLease(readRequest),code('FIRESTORE_RESERVATION_DENIED'));
  assert.equal(count(h,'reserve'),1);assert.equal(count(h,'credential'),0);assert.equal(count(h,'batchGet'),0);
});
test('FA45k cannot authorize FB45k or omit the approval pin',async t=>{
  for(const change of [p=>{p.readBudget.dailyLimits[FB]=45000;},p=>{delete p.readBudget.limitApprovalEvidence;},p=>{p.readBudget.operationReadBounds.writeFbLease=1;}])await t.test('closed policy',async()=>{
    const p=policy();change(p);const h=harness({policy:p});await assert.rejects(h.adapter.readFbLease(readRequest));assert.equal(h.calls.length,0);
  });
});
test('missing lease has explicit null revision and server readTime',async()=>{
  const h=harness(),result=await h.adapter.readFbLease(readRequest);assert.equal(result.exists,false);assert.equal(result.revision,null);
  assert.equal(result.lease,null);assert.equal(result.readTimeMs,BASE);assert.equal(h.calls[0].operation,'reserve');
});
test('lease revision preserves nanoseconds rather than a millisecond surrogate',async()=>{
  const h=harness();h.put(leaseName,lease());const result=await h.adapter.readFbLease(readRequest);
  assert.equal(result.revision,h.docs.get(leaseName).revision);assert.match(result.revision,/\.\d{9}Z$/);assert.equal(result.lease.grantId,'synthetic-grant-a');
});
test('create lease transaction reads lease and grant fence; whole-document replace only',async()=>{
  const h=harness(),result=await h.adapter.writeFbLease(writeRequest());assert.equal(result.applied,true);assert.equal(result.projectId,FB);
  assert.equal(result.revision,h.docs.get(leaseName).revision);assert.deepEqual(h.get(leaseName),lease());
  const batch=h.calls.find(value=>value.operation==='batchGet');assert.deepEqual(batch.body.documents,[leaseName,fenceName('synthetic-grant-a')]);
  assert.ok(batch.body.transaction);const commit=h.calls.find(value=>value.operation==='commit');assert.equal(commit.body.writes.length,1);
  assert.deepEqual(commit.body.writes[0].currentDocument,{exists:false});assert.equal('updateMask' in commit.body.writes[0],false);
});
test('CAS update removes prior financial permissions instead of merging grants',async()=>{
  const h=harness(),old=lease();old.permissions.financeWrite=true;h.put(leaseName,old);const oldRevision=h.docs.get(leaseName).revision;
  const next=lease();next.leaseVersion=2;next.sourceVersion=8;next.grantId='synthetic-grant-b';next.sourceHash='b'.repeat(64);
  const result=await h.adapter.writeFbLease({...readRequest,expectedRevision:oldRevision,lease:next});assert.equal(result.applied,true);
  assert.equal(h.get(leaseName).permissions.financeWrite,false);assert.deepEqual(h.calls.find(value=>value.operation==='commit').body.writes[0].currentDocument,{updateTime:oldRevision});
});
test('wrong revision rejects and rolls back without a commit',async()=>{
  const h=harness();h.put(leaseName,lease());const next=lease();next.leaseVersion=2;next.grantId='synthetic-grant-b';
  const result=await h.adapter.writeFbLease({...readRequest,expectedRevision:revision(999),lease:next});assert.equal(result.applied,false);
  assert.equal(count(h,'commit'),0);assert.equal(count(h,'rollback'),1);assert.equal(h.get(leaseName).grantId,'synthetic-grant-a');
});
test('existing fence denies canceled grant even when lease is absent',async()=>{
  const h=harness();h.put(fenceName('synthetic-grant-a'),fence());const result=await h.adapter.writeFbLease(writeRequest());
  assert.equal(result.applied,false);assert.equal(result.fenced,true);assert.equal(count(h,'commit'),0);assert.equal(h.get(leaseName),null);
});
test('cleanup writes a durable fence when no lease exists',async()=>{
  const h=harness(),result=await h.adapter.invalidateFbLease(cleanupRequest());assert.deepEqual(result,{applied:false,matched:false,fenced:true,projectId:FB});
  assert.deepEqual(h.get(fenceName('synthetic-grant-a')),fence());assert.equal(h.get(leaseName),null);
  const attempted=await h.adapter.writeFbLease(writeRequest());assert.equal(attempted.applied,false);assert.equal(attempted.fenced,true);
});
test('cleanup atomically fences and revokes only the matching grant',async()=>{
  const h=harness();h.put(leaseName,lease());const result=await h.adapter.invalidateFbLease(cleanupRequest());assert.equal(result.applied,true);assert.equal(result.fenced,true);
  assert.equal(h.get(leaseName).active,false);assert.equal(h.get(leaseName).revoked,true);assert.equal(h.get(leaseName).managementAllowed,false);
  assert.equal(h.get(leaseName).validUntilMs,BASE);assert.equal(h.calls.find(value=>value.operation==='commit').body.writes.length,2);
});
test('cleanup preserves a newer grant and fences the old attempt',async()=>{
  const h=harness(),newer=lease();newer.grantId='synthetic-newer-grant';newer.leaseVersion=2;h.put(leaseName,newer);
  const result=await h.adapter.invalidateFbLease(cleanupRequest());assert.equal(result.applied,false);assert.equal(result.fenced,true);
  assert.deepEqual(h.get(leaseName),newer);assert.equal(h.calls.find(value=>value.operation==='commit').body.writes.length,1);
});
test('an existing matching fence and no matching lease are confirmed without another write',async()=>{
  const h=harness();h.put(fenceName('synthetic-grant-a'),fence());const result=await h.adapter.invalidateFbLease(cleanupRequest());
  assert.equal(result.fenced,true);assert.equal(count(h,'commit'),0);assert.equal(count(h,'rollback'),1);
});
test('concurrent cleanup after CAS read prevents the late CAS commit',async()=>{
  let changed=false;const h=harness({beforeRpc:(operation,body,c)=>{if(operation==='commit'&&!changed){changed=true;c.put(fenceName('synthetic-grant-a'),fence());}}});
  const result=await h.adapter.writeFbLease(writeRequest());assert.equal(result.applied,false);assert.equal(h.get(leaseName),null);
  assert.equal(count(h,'commit'),1);assert.equal(count(h,'beginTransaction'),1);
});
test('commit transport failure is uncertain, sanitized and never retried',async()=>{
  const h=harness({rpc:operation=>{if(operation==='commit')throw new Error('synthetic-oauth-token private server failure');}});
  await assert.rejects(h.adapter.writeFbLease(writeRequest()),error=>error.requiresReconciliation===true&&!error.message.includes('synthetic-oauth-token'));
  assert.equal(count(h,'commit'),1);assert.equal(count(h,'rollback'),0);assert.equal(count(h,'beginTransaction'),1);
});
test('cleanup commit conflict never reports fenced true',async()=>{
  const h=harness({rpc:(operation,body,url)=>operation==='commit'?response(url,{error:{status:'ABORTED'}},409):null});
  const result=await h.adapter.invalidateFbLease(cleanupRequest());assert.equal(result.fenced,false);assert.equal(count(h,'commit'),1);
});
test('HTTP503 commit remains uncertain rather than a known CAS conflict',async()=>{
  const h=harness({rpc:(operation,body,url)=>operation==='commit'?response(url,{error:{status:'UNAVAILABLE',message:'synthetic-oauth-token'}},503):null});
  await assert.rejects(h.adapter.writeFbLease(writeRequest()),error=>error.code==='FIRESTORE_COMMIT_UNCONFIRMED'&&error.requiresReconciliation);
  assert.equal(count(h,'commit'),1);
});
test('late commit completion cannot deliver a grant',async()=>{
  const h=harness({beforeRpc:(operation,body,c)=>{if(operation==='commit')c.advance(1100);}});
  await assert.rejects(h.adapter.writeFbLease(writeRequest()),error=>error.requiresReconciliation===true&&error.code==='FIRESTORE_DEADLINE_EXCEEDED');
  assert.equal(count(h,'commit'),1);
});
test('fresh production source and current Auth are normalized for the broker',async()=>{
  const h=harness();h.put(sourceName,source());const result=await h.adapter.readFaAuthorization({projectId:FA,uid:UID});
  assert.equal(result.productionAuthorized,true);assert.equal(result.consistentRead,true);assert.equal(result.authorizationVersion,7);
  assert.equal(result.authUser.googleUid,'synthetic-google-a');assert.equal(result.sourceRevision,h.docs.get(sourceName).revision);
  assert.equal('accessToken' in result,false);assert.equal(count(h,'auth'),1);assert.equal(count(h,'batchGet'),1);
  assert.equal(h.calls[0].request.dailyLimit,45000);
});
test('preview, stale, incomplete, wrong version/hash/binding or private source fields are denied',async t=>{
  const cases=[
    s=>{s.productionAuthorized=false;},s=>{s.coverageComplete=false;},s=>{s.confirmedAtMs=BASE-6000;},s=>{s.validUntilMs=BASE;},
    s=>{s.sourceVersion=6;},s=>{s.sourceHash='b'.repeat(64);},s=>{s.binding.fbUid='synthetic-other';},s=>{s.profile.permissions.admin='true';},
    s=>{s.policyVersion='other';},s=>{s.email='synthetic-private';},s=>{s.documentAccess.googleUid='synthetic-other';},
    s=>{s.sourceAuthValidAfterTimeMs=1;},s=>{s.areas=[{id:'a',active:true,version:1,memberUids:[UID,UID],managerUids:[]}];}
  ];
  for(const change of cases)await t.test('source denied',async()=>{const h=harness(),value=source();change(value);h.put(sourceName,value);
    await assert.rejects(h.adapter.readFaAuthorization({projectId:FA,uid:UID}));assert.equal(count(h,'commit'),0);});
});
test('source missing never substitutes legacy profile or offline preview',async()=>{
  const h=harness();await assert.rejects(h.adapter.readFaAuthorization({projectId:FA,uid:UID}),code('FA_SOURCE_CONTEXT_MISSING'));assert.equal(count(h,'auth'),0);
});
test('source revision cannot regress or change rights under the same source version',async()=>{
  const h=harness();h.put(sourceName,source());await h.adapter.readFaAuthorization({projectId:FA,uid:UID});
  const value=source();value.authorizationVersion=6;value.sourceVersion=6;value.sourceHash=digest({...{
    sourceProjectId:FA,destinationProjectId:FB,faUid:UID,fbUid:UID,memberId:'synthetic-stable-a',authorizationVersion:6,active:true,
    managementAllowed:true,role:'profissional',permissions:value.profile.permissions,memberAreaIds:[],managerAreaIds:[],documentGroups:['GENERAL'],
    sourceAuthValidAfterTimeMs:0,googleUid:'synthetic-google-a'}});h.put(sourceName,value);
  await assert.rejects(h.adapter.readFaAuthorization({projectId:FA,uid:UID}),code('FA_SOURCE_VERSION_REGRESSED'));
});
test('wrong project/path and request extras never reach REST',async t=>{
  for(const request of [{uid:UID,projectId:FA},{uid:'../other',projectId:FB},{...readRequest,path:'users/admin'},{...readRequest,role:'admin'}])await t.test('closed request',async()=>{
    const h=harness();await assert.rejects(h.adapter.readFbLease(request),code('FIRESTORE_REQUEST_INVALID'));assert.equal(count(h,'credential'),0);assert.equal(count(h,'batchGet'),0);});
});
test('malformed/duplicate/wrong document response denies instead of inferring absent lease',async t=>{
  for(const data of [[],[{missing:sourceName,readTime:iso(BASE)}],[{missing:leaseName,readTime:iso(BASE)},{missing:leaseName,readTime:iso(BASE)}],
    [{missing:leaseName,readTime:'invalid'}],[{missing:leaseName,readTime:iso(BASE-6000)}]])await t.test('batch denied',async()=>{
    const h=harness({rpc:(operation,body,url)=>operation==='batchGet'?response(url,data):null});await assert.rejects(h.adapter.readFbLease(readRequest));});
});
test('cached, redirected and oversized responses deny',async t=>{
  for(const headers of [{'age':'1'},{'content-length':'1048577'}])await t.test('headers denied',async()=>{
    const h=harness({rpc:(operation,body,url)=>operation==='batchGet'?response(url,[],200,headers):null});await assert.rejects(h.adapter.readFbLease(readRequest));});
  const h=harness({rpc:(operation,body,url)=>{if(operation!=='batchGet')return null;const res=response(url,[]);Object.defineProperty(res,'redirected',{value:true});return res;}});
  await assert.rejects(h.adapter.readFbLease(readRequest),code('FIRESTORE_RESPONSE_INVALID'));
});
test('budget IDs cannot be reused even after an earlier request completed',async()=>{
  let receipt;const normal=harness();await normal.adapter.readFbLease(readRequest);
  const h=harness({reserve:request=>{receipt??={schemaVersion:1,projectId:FB,operation:'readFbLease',reservationId:'same',quotaTimezone:'America/Los_Angeles',quotaDay:'2026-10-09',
    dailyLimit:35000,pausedRequiresReview:false,metricsComplete:true,measurementTimeMs:BASE,expiresAtMs:BASE+5000,reservedReads:1,totalReadCount:1000,
    outstandingReservedReads:20,unreportedConsumedReads:0,applicationReserveReads:100,metricLagReserveReads:100};return receipt;}});
  await h.adapter.readFbLease(readRequest);await assert.rejects(h.adapter.readFbLease(readRequest),code('FIRESTORE_RESERVATION_REUSED'));assert.equal(count(h,'batchGet'),1);
});
test('fixed deadline bounds a credential provider that never resolves',async()=>{
  const p=policy();p.operationTimeoutMs=30;const h=harness({policy:p,credential:()=>new Promise(()=>{})});
  await assert.rejects(h.adapter.readFbLease(readRequest),code('FIRESTORE_DEADLINE_EXCEEDED'));assert.equal(count(h,'batchGet'),0);
});
test('already aborted context and dispose deny before the next REST request',async()=>{
  const h=harness(),controller=new AbortController();controller.abort();await assert.rejects(h.adapter.readFbLease(readRequest,{signal:controller.signal}),code('FIRESTORE_CANCELLED'));
  assert.equal(h.calls.length,0);h.adapter.dispose();await assert.rejects(h.adapter.readFbLease(readRequest),code('FIRESTORE_ADAPTER_DISABLED'));
});


function brokerFor(h,change={}){
  return createManagementAuthBroker({enabled:true,policy:{schemaVersion:1,version:'synthetic-policy-v1',leaseDurationMs:5000,maxSnapshotAgeMs:5000,
    maxExecutionMs:1000,cleanupTimeoutMs:1000,maxFutureSkewMs:0,readBudget:policy().readBudget},clock:h.time,newGrantId:()=> 'synthetic-grant-a',
    adapters:{...h.adapter,reserveFirestoreReads:h.reserveFirestoreReads,
      verifyFaIdToken:async(token,revoked)=>{assert.equal(token,'synthetic-proof');assert.equal(revoked,true);
        return {uid:UID,sub:UID,aud:FA,iss:'https://securetoken.google.com/'+FA,auth_time:BASE/1000-2,iat:BASE/1000-1,exp:BASE/1000+60,
          email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['synthetic-google-a']}}};},
      getFbUser:async()=>({schemaVersion:1,projectId:FB,fromCache:false,hasPendingWrites:false,readTimeMs:h.time(),
        user:{uid:UID,disabled:false,emailVerified:true,providerData:[{providerId:'google.com',uid:'synthetic-google-a'}]}}),
      createFbCustomToken:async()=> 'synthetic-custom-token',...change}});
}
test('composition with real broker requires CAS/readback and both independent budgets',async()=>{
  const h=harness();h.put(sourceName,source());const result=await brokerFor(h).exchange({faIdToken:'synthetic-proof'});
  assert.equal(result.ok,true);assert.equal(result.faUid,UID);assert.equal(result.fbUid,UID);assert.equal(result.customToken,'synthetic-custom-token');
  assert.equal(count(h,'commit'),1);assert.equal(h.get(leaseName).active,true);assert.equal(count(h,'auth'),3);
  const projects=new Set(h.calls.filter(value=>value.operation==='reserve').map(value=>value.request.projectId));assert.deepEqual([...projects].sort(),[FA,FB].sort());
  assert.ok(h.calls.filter(value=>value.operation==='batchGet').length>=6);
});
test('composition rejects changed FA after a commit and fences only its own grant',async()=>{
  const h=harness({beforeRpc:(operation,body,c)=>{if(operation==='commit'&&body.writes.some(write=>write.update.name===leaseName)){
    const next=source();next.productionAuthorized=false;c.put(sourceName,next);
  }}});h.put(sourceName,source());const result=await brokerFor(h).exchange({faIdToken:'synthetic-proof'});
  assert.equal(result.ok,false);assert.equal('customToken' in result,false);assert.equal(h.get(leaseName).revoked,true);
  assert.equal(h.get(fenceName('synthetic-grant-a')).grantId,'synthetic-grant-a');
});
test('getters and sparse arrays are rejected before any server adapter is invoked',async()=>{
  const h=harness();let used=false;const request={uid:UID,projectId:FB};Object.defineProperty(request,'private',{get(){used=true;throw new Error('secret');},enumerable:true});
  await assert.rejects(h.adapter.readFbLease(request),code('FIRESTORE_DATA_INVALID'));assert.equal(used,false);assert.equal(h.calls.length,0);
  const next=writeRequest();next.lease.documentGroups=Array(1);await assert.rejects(h.adapter.writeFbLease(next),code('FIRESTORE_DATA_INVALID'));assert.equal(h.calls.length,0);
});
