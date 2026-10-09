import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps-script/ManagementMigrationInventoryNative.gs',import.meta.url),'utf8');
const original=readFileSync(new URL('../apps-script/ManagementMigrationInventory.gs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/management-native-legacy-shape.gs',import.meta.url),'utf8');
const names=text=>Array.from(text.matchAll(/^(?:function|class|const|var|let)\s+([A-Za-z_$][\w$]*)/gm),m=>m[1]);
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const sha=value=>createHash('sha256').update(value).digest('hex');
function harness(){
 const calls={network:0,writes:0,tokens:0},logs=[];
 const deny=()=>{calls.writes++;throw Error('SYNTHETIC_FORBIDDEN_OPERATION');};
 const context=vm.createContext({Logger:{log:text=>logs.push(text)},
  ScriptApp:{getScriptId:()=> '1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD',getProjectTriggers:()=>[],
   getOAuthToken:()=>{calls.tokens++;return deny();},newTrigger:deny,deleteTrigger:deny,
   TriggerSource:{CLOCK:'CLOCK',FORMS:'FORMS'},EventType:{CLOCK:'CLOCK',ON_FORM_SUBMIT:'ON_FORM_SUBMIT'}},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty:deny,deleteProperty:deny,getProperties:deny})},
  Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(_algorithm,text)=>Array.from(createHash('sha256').update(text).digest(),b=>b>127?b-256:b)},
  UrlFetchApp:{fetch:()=>{calls.network++;return deny();},fetchAll:()=>{calls.network++;return deny();}}});
 const directory=new URL('../apps-script-v2/',import.meta.url);
 for(const name of readdirSync(directory).filter(n=>n.endsWith('.gs')).sort())vm.runInContext(readFileSync(new URL(name,directory),'utf8'),context);
 vm.runInContext(fixture,context);vm.runInContext(source,context);
 return {context,calls,logs,run:()=>JSON.parse(JSON.stringify(context.consultarInventarioMigracaoGestaoNativaSahmtV2()))};
}

test('native and local variants have distinct public/private declaration names',()=>{
 const old=new Set(names(original));assert.deepEqual(names(source).filter(name=>old.has(name)),[]);
 assert.ok(names(source).includes('consultarInventarioMigracaoGestaoNativaSahmtV2'));
});

test('native pinset is internally coherent with 232 functions and 13 constants',()=>{
 const h=harness(),review=vm.runInContext('SAHMT_MIGRATION_NATIVE_INVENTORY_REVIEW_',h.context);
 assert.equal(review.functions.length,232);assert.equal(review.constants.length,13);assert.equal(review.reviewedModules.length,12);
 const basis={schemaVersion:1,reviewedModules:Array.from(review.reviewedModules),
  functions:Array.from(review.functions,row=>({name:row.name,sha256:row.sha256})),constants:Array.from(review.constants,row=>({name:row.name,sha256:row.sha256})),scriptProjectSha256:review.scriptProjectSha256};
 assert.equal(sha(canonical(basis)),review.sourceBasisSha256);assert.match(review.evidencePlaintextSha256,/^[a-f0-9]{64}$/);
});

test('a minimal public legacy shape cannot substitute for the observed native source',()=>{
 const h=harness(),r=h.run();assert.equal(r.knownSourceCoverageVerified,false);assert.equal(r.writerState,'UNKNOWN');
 assert.equal(r.configurationSha256,null);assert.ok(r.blockers.includes('MMI_SOURCE_NOT_PINNED_TO_REVIEW'));
 assert.ok(r.sourceVerification.changedFunctionCount>=4);assert.ok(r.sourceVerification.missingFunctionCount>=4);
 assert.deepEqual(h.calls,{network:0,writes:0,tokens:0});assert.equal(h.logs.length,1);
});

test('native variant never certifies global completeness or stopped writers',()=>{
 const h=harness(),r=h.run();assert.equal(r.complete,false);assert.equal(r.globalNativeProducerAbsenceCertified,false);
 assert.equal(r.otherTriggerOwnersInventoried,false);assert.equal(r.destinationNativeTriggersAbsent,false);
 assert.equal(r.triggerVisibility,'CURRENT_USER_ONLY');assert.equal(r.firestoreDocumentReadsIssued,0);
 assert.equal(r.allSideEffects,0);assert.notEqual(r.writerState,'STOPPED');
});
