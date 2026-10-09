import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const PROJECT='1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD';
const TIME=Date.parse('2026-10-09T15:00:00.000Z');
const sources=readdirSync(new URL('../apps-script-v2/',import.meta.url)).filter(name=>name.endsWith('.gs')).sort()
  .map(name=>({name,source:readFileSync(new URL('../apps-script-v2/'+name,import.meta.url),'utf8')}));
const helper=readFileSync(new URL('../apps-script/ManagementMigrationInventory.gs',import.meta.url),'utf8');
const forbidden=()=>{throw Error('SYNTHETIC_FORBIDDEN_SIDE_EFFECT');};
const trigger=(handler,source='CLOCK',event='CLOCK')=>({getHandlerFunction:()=>handler,getTriggerSource:()=>source,
  getEventType:()=>event,getUniqueId:forbidden,getTriggerSourceId:forbidden});
const clean=value=>JSON.parse(JSON.stringify(value));
function harness({triggers=[],properties={},changeSource=(_name,source)=>source,projectId=PROJECT,
  scriptOverrides={},propertyOverrides={},clock=()=>TIME,omit=[]}={}) {
  const logs=[],reads=[],calls={network:0,triggerWrites:0,propertyWrites:0,token:0};
  const script={getScriptId:()=>projectId,getProjectTriggers:()=>triggers,
    getOAuthToken:()=>{calls.token++;return forbidden();},newTrigger:()=>{calls.triggerWrites++;return forbidden();},
    deleteTrigger:()=>{calls.triggerWrites++;return forbidden();},TriggerSource:{CLOCK:'CLOCK',FORMS:'FORMS'},
    EventType:{CLOCK:'CLOCK',ON_FORM_SUBMIT:'ON_FORM_SUBMIT'},...scriptOverrides};
  class Clock extends Date {static now(){return clock();}}
  const context=vm.createContext({Date:Clock,ScriptApp:script,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>{reads.push(key);return Object.hasOwn(properties,key)?properties[key]:null;},
      getProperties:forbidden,setProperty:()=>{calls.propertyWrites++;return forbidden();},deleteProperty:()=>{calls.propertyWrites++;return forbidden();},...propertyOverrides})},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(algorithm,text,charset)=>{
      assert.equal(algorithm,'SHA_256');assert.equal(typeof text,'string');assert.equal(charset,'UTF_8');
      return Array.from(createHash('sha256').update(text).digest(),byte=>byte>127?byte-256:byte);
    }},
    UrlFetchApp:{fetch:()=>{calls.network++;return forbidden();},fetchAll:()=>{calls.network++;return forbidden();}},
    SpreadsheetApp:new Proxy({}, {get:()=>forbidden}),DriveApp:new Proxy({}, {get:()=>forbidden}),
    FormApp:new Proxy({}, {get:()=>forbidden}),Session:new Proxy({}, {get:()=>forbidden}),
    Logger:{log:message=>logs.push(message)}});
  for(const {name,source} of sources)if(!omit.includes(name))vm.runInContext(changeSource(name,source),context,{filename:name});
  vm.runInContext(helper,context,{filename:'ManagementMigrationInventory.gs'});
  const run=()=>clean(context.consultarInventarioMigracaoGestaoSahmtV2());
  return {context,run,logs,reads,calls};
}
function zeroEffects(h,result) {
  assert.deepEqual(h.calls,{network:0,triggerWrites:0,propertyWrites:0,token:0});
  for(const key of ['firestoreDocumentReadsIssued','firestoreWritesIssued','metricsRequestsIssued','authReadsIssued',
    'authWritesIssued','propertyWrites','triggerWrites','financialWrites','externalRequestsIssued','allSideEffects'])assert.equal(result[key],0,key);
}

test('observes pinned current FA producer code without executing any writer',()=>{
  const h=harness({triggers:[trigger('validatePendingManagementScoreReviews'),trigger('syncSparkReportsPeriodically'),
    trigger('onEvaluationFormSubmit','FORMS','ON_FORM_SUBMIT')]});
  const result=h.run();assert.equal(result.status,'KNOWN_NATIVE_SOURCE_OBSERVED');
  assert.equal(result.knownSourceCoverageVerified,true);assert.equal(result.writerState,'RUNNING_FA_ONLY');
  assert.equal(result.configuredFirestoreProjectId,'sahmt-17a16');assert.equal(result.databaseId,'(default)');
  assert.match(result.configurationSha256,/^[a-f0-9]{64}$/);assert.match(result.sourceBasisSha256,/^[a-f0-9]{64}$/);
  assert.equal(result.sourceVerification.reviewedModuleCount,12);assert.equal(result.sourceVerification.reviewedFunctionCount,228);
  assert.equal(result.sourceVerification.verifiedFunctionCount,228);assert.deepEqual(result.blockers,[]);
  assert.equal(result.observedAt,new Date(TIME).toISOString());assert.equal(result.native.visibleCurrentUserTriggerCount,3);
  assert.ok(result.native.knownJobs.every(job=>job.firestoreProjectId==='sahmt-17a16'&&job.potentiallyExecutable===true));
  assert.ok(result.native.knownJobs.every(job=>job.executionState==='UNVERIFIED'&&!Object.hasOwn(job,'enabled')));
  assert.equal(result.native.knownJobs.some(job=>job.firestoreProjectId==='sahmt-gestao-5ae66'),false);
  zeroEffects(h,result);assert.equal(h.logs.length,1);assert.deepEqual(JSON.parse(h.logs[0]),result);
});

test('never certifies other users, a global inventory or stopped writers from an empty trigger list',()=>{
  const h=harness();const result=h.run();assert.equal(result.complete,false);
  assert.equal(result.scope,'APPS_SCRIPT_CURRENT_PROJECT_ONLY');assert.equal(result.triggerVisibility,'CURRENT_USER_ONLY');
  assert.equal(result.otherTriggerOwnersInventoried,false);assert.equal(result.unknownManualOrSimpleProducersInventoried,false);
  assert.equal(result.globalNativeProducerAbsenceCertified,false);assert.equal(result.destinationNativeTriggersAbsent,false);
  assert.equal(result.writerState,'RUNNING_FA_ONLY');assert.equal(result.native.knownJobs.length,0);zeroEffects(h,result);
});

test('reads only three declared keys and exposes only safe state enums',()=>{
  const properties={SAHMT_V2_EVALUATION_ENABLED:'false',SAHMT_V2_EVALUATION_HOMOLOGATED:'true',
    SAHMT_V2_TRAINING_RELEASE_JOB:JSON.stringify({schemaVersion:2,status:'CONFIGURATION_PENDING',actorEmail:'SYNTHETIC_PRIVATE_EMAIL',triggerId:'SYNTHETIC_NATIVE_ID',token:'SYNTHETIC_SECRET'})};
  const h=harness({properties});const result=h.run();
  assert.deepEqual(h.reads,['SAHMT_V2_EVALUATION_ENABLED','SAHMT_V2_EVALUATION_HOMOLOGATED','SAHMT_V2_TRAINING_RELEASE_JOB']);
  assert.deepEqual(result.safeProperties,{evaluationEnabled:'EXPLICIT_FALSE',evaluationHomologated:'EXPLICIT_TRUE',trainingReleaseState:'CONFIGURATION_PENDING'});
  assert.doesNotMatch(h.logs[0],/SYNTHETIC_(PRIVATE|NATIVE|SECRET)/);zeroEffects(h,result);
});

for(const state of ['RUNNING','COMPLETED','CONFIGURATION_PENDING'])test('reports existing training checkpoint '+state+' without modifying it',()=>{
  const h=harness({properties:{SAHMT_V2_TRAINING_RELEASE_JOB:JSON.stringify({schemaVersion:2,status:state})}});
  const result=h.run();assert.equal(result.safeProperties.trainingReleaseState,state);zeroEffects(h,result);
});

test('invalid property values are unknown and never enable source verification',()=>{
  const h=harness({properties:{SAHMT_V2_EVALUATION_ENABLED:'SYNTHETIC_SECRET'}});const result=h.run();
  assert.equal(result.knownSourceCoverageVerified,false);assert.equal(result.writerState,'UNKNOWN');
  assert.ok(result.blockers.includes('MMI_PROPERTIES_UNKNOWN'));assert.doesNotMatch(h.logs[0],/SYNTHETIC_SECRET/);zeroEffects(h,result);
});

for(const job of ['{',JSON.stringify({schemaVersion:1,status:'RUNNING'}),JSON.stringify({schemaVersion:2,status:'SYNTHETIC_SECRET'}),'x'.repeat(16385)])
  test('malformed or unreviewed checkpoint is fail closed without raw state',()=>{
    const h=harness({properties:{SAHMT_V2_TRAINING_RELEASE_JOB:job}});const result=h.run();
    assert.equal(result.knownSourceCoverageVerified,false);assert.equal(result.writerState,'UNKNOWN');
    assert.equal(result.configurationSha256,null);assert.doesNotMatch(h.logs[0],/SYNTHETIC_SECRET/);zeroEffects(h,result);
  });

test('changed Firestore resolver is hashed but never invoked',()=>{
  const h=harness();h.context.firestoreDocumentsUrl_=()=>{h.calls.network++;throw Error('SYNTHETIC_SECRET');};
  const result=h.run();assert.equal(result.knownSourceCoverageVerified,false);assert.equal(result.writerState,'UNKNOWN');
  assert.ok(result.sourceVerification.changedFunctionCount>0);assert.ok(result.blockers.includes('MMI_SOURCE_NOT_PINNED_TO_REVIEW'));
  assert.doesNotMatch(h.logs[0],/SYNTHETIC_SECRET/);zeroEffects(h,result);
});

test('missing reviewed function fails closed even when no triggers are visible',()=>{
  const h=harness();h.context.validatePendingManagementScoreReviews=undefined;const result=h.run();
  assert.ok(result.sourceVerification.missingFunctionCount>0);assert.equal(result.knownSourceCoverageVerified,false);
  assert.equal(result.writerState,'UNKNOWN');zeroEffects(h,result);
});

test('FB routing is reported for review and never claims stopped or safe destination writers',()=>{
  const h=harness({changeSource:(name,source)=>name==='Config.gs'?source.replace("projectId: 'sahmt-17a16'","projectId: 'sahmt-gestao-5ae66'"):source,
    triggers:[trigger('validatePendingManagementScoreReviews')]});
  const result=h.run();assert.equal(result.configuredFirestoreProjectId,'sahmt-gestao-5ae66');
  assert.equal(result.knownSourceCoverageVerified,false);assert.equal(result.writerState,'UNKNOWN');
  assert.equal(result.configurationSha256,null);assert.equal(result.destinationNativeTriggersAbsent,false);
  assert.ok(result.blockers.includes('MMI_ROUTING_TARGET_NOT_REVIEWED_FA'));zeroEffects(h,result);
});

test('dynamic routing getter is rejected without invoking it',()=>{
  const h=harness({changeSource:(name,source)=>name==='Config.gs'?source.replace("projectId: 'sahmt-17a16'","get projectId() { throw Error('SYNTHETIC_SECRET'); }"):source});
  const result=h.run();assert.equal(result.knownSourceCoverageVerified,false);assert.equal(result.writerState,'UNKNOWN');
  assert.ok(result.blockers.includes('MMI_ROUTING_DYNAMIC_OR_MISSING'));assert.doesNotMatch(h.logs[0],/SYNTHETIC_SECRET/);zeroEffects(h,result);
});

test('missing config is never interpreted as stopped',()=>{
  const h=harness({omit:['Config.gs']});const result=h.run();assert.equal(result.knownSourceCoverageVerified,false);
  assert.equal(result.writerState,'UNKNOWN');assert.equal(result.configurationSha256,null);zeroEffects(h,result);
});

test('unreviewed project is rejected without exposing its native ID',()=>{
  const h=harness({projectId:'SYNTHETIC_PRIVATE_NATIVE_ID'});const result=h.run();assert.equal(result.knownSourceCoverageVerified,false);
  assert.ok(result.blockers.includes('MMI_SCRIPT_PROJECT_NOT_REVIEWED'));assert.doesNotMatch(h.logs[0],/SYNTHETIC_PRIVATE_NATIVE_ID/);zeroEffects(h,result);
});

test('unknown handler is counted and sanitized without any private IDs or names',()=>{
  const h=harness({triggers:[trigger('SYNTHETIC_SECRET@example.invalid'),trigger('validatePendingManagementScoreReviews')]});
  const result=h.run();assert.equal(result.native.unknownHandlerCount,1);assert.equal(result.native.unknownJobs[0].handler,'UNKNOWN_HANDLER');
  assert.equal(result.knownSourceCoverageVerified,false);assert.equal(result.writerState,'UNKNOWN');
  assert.doesNotMatch(h.logs[0],/SYNTHETIC_SECRET|example\.invalid/);zeroEffects(h,result);
});

test('unreadable trigger methods stay unknown without raw exception',()=>{
  const h=harness({triggers:[{getHandlerFunction:()=>{throw Error('SYNTHETIC_SECRET');}}]});const result=h.run();
  assert.equal(result.native.unreadableTriggerCount,1);assert.equal(result.knownSourceCoverageVerified,false);
  assert.doesNotMatch(h.logs[0],/SYNTHETIC_SECRET/);zeroEffects(h,result);
});

test('unexpected handler event/source is unresolved rather than assumed disabled',()=>{
  const h=harness({triggers:[trigger('validatePendingManagementScoreReviews','FORMS','ON_FORM_SUBMIT')]});const result=h.run();
  assert.equal(result.native.knownJobs[0].shapeVerified,false);assert.equal(result.native.knownJobs[0].potentiallyExecutable,true);
  assert.equal(result.native.unreadableTriggerCount,1);assert.equal(result.knownSourceCoverageVerified,false);zeroEffects(h,result);
});

for(const scriptOverrides of [{getProjectTriggers:()=>{throw Error('SYNTHETIC_SECRET');}},{getProjectTriggers:()=>null},{getScriptId:()=>null}])
  test('unavailable native lookup never fabricates an empty verified inventory',()=>{
    const h=harness({scriptOverrides});const result=h.run();assert.equal(result.knownSourceCoverageVerified,false);
    assert.equal(result.writerState,'UNKNOWN');assert.equal(result.configurationSha256,null);assert.doesNotMatch(h.logs[0],/SYNTHETIC_SECRET/);zeroEffects(h,result);
  });

test('property read failure is sanitized and produces no side effects',()=>{
  const h=harness({propertyOverrides:{getProperty:()=>{throw Error('SYNTHETIC_SECRET');}}});const result=h.run();
  assert.equal(result.writerState,'UNKNOWN');assert.ok(result.blockers.includes('MMI_OBSERVATION_UNAVAILABLE'));
  assert.doesNotMatch(h.logs[0],/SYNTHETIC_SECRET/);zeroEffects(h,result);
});

for(const difference of [-1,30000])test('invalid observation duration remains fail closed',()=>{
  let calls=0;const h=harness({clock:()=>TIME+(calls++?difference:0)});const result=h.run();
  assert.equal(result.knownSourceCoverageVerified,false);assert.equal(result.writerState,'UNKNOWN');
  assert.ok(result.blockers.includes('MMI_CAPTURE_TIME_INVALID'));zeroEffects(h,result);
});

test('line-ending normalization preserves identical reviewed source without accepting content changes',()=>{
  const h=harness({changeSource:(_name,source)=>source.replace(/\r\n?/g,'\n')});assert.equal(h.run().knownSourceCoverageVerified,true);
});


test('native exceptions forged with a helper code cannot leak private provider content',()=>{
  const h=harness({propertyOverrides:{getProperty:()=>{throw Error('MMI_SYNTHETIC_PRIVATE_SECRET');}}});const result=h.run();
  assert.deepEqual(result.blockers,['MMI_OBSERVATION_UNAVAILABLE']);assert.doesNotMatch(h.logs[0],/MMI_SYNTHETIC_PRIVATE_SECRET/);zeroEffects(h,result);
});