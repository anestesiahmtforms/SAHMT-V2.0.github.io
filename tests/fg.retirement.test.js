import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {retiredChannelCollection,retiredContinuityKind} from '../worker-operational-channel/module-retirement.js';
import {continuityStateAction} from '../worker-operational-channel/continuity.js';
test('FG legacy closure applies only after its own flag and leaves the central identity directory intact',()=>{
  const env={FI_FJ_MODULES_RETIRED:'true',FH_MODULE_RETIRED:'true',FG_MODULE_RETIRED:'true'};
  assert.equal(retiredChannelCollection(env,'checklists'),true);assert.equal(retiredContinuityKind(env,'stations'),true);
  for(const kind of ['users','contacts','appConfig'])assert.equal(retiredContinuityKind(env,kind),false);
  assert.equal(retiredChannelCollection({...env,FG_MODULE_RETIRED:'false'},'checklists'),false);
});
test('retired Checklist queue entries are excluded before bounded drain and remain countable for reconciliation',async()=>{
  const statements=[],sql={exec:query=>{statements.push(query);return {toArray:()=>query.includes('GROUP BY')?[{collection:'checklists',count:2}]:[]};}};
  await continuityStateAction(sql,'/continuity-drain',{excludeFgChecklist:true});assert.match(statements[0],/NOT IN \('checklists'\).*LIMIT 10/);
  const result=await (await continuityStateAction(sql,'/continuity-module-audit',{})).json();assert.equal(result.pendingChecklists,2);assert.equal(result.pendingLabels,0);
});
test('FA native guard blocks Checklist writes while preserving reads, other modules and historical performance',async()=>{
  const source=(await readFile(new URL('../apps-script-v2/FgMigration.gs',import.meta.url),'utf8')).replace('SAHMT_FG_PUBLICATION_EPOCH = 0','SAHMT_FG_PUBLICATION_EPOCH = 1'),context=vm.createContext({});vm.runInContext(source,context);
  const root='https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents';
  for(const collection of ['stations','checklists','checklistSignatureRequests','checklistSignatures','checklistResponsibilities']){
    assert.throws(()=>context.sahmtFgGuardWrite_(root+':commit',{method:'post',payload:JSON.stringify({writes:[{update:{name:root.replace('https://firestore.googleapis.com/v1/','')+'/'+collection+'/r'}}]})}),/FG_SOURCE_MOVED/);
    assert.doesNotThrow(()=>context.sahmtFgGuardWrite_(root+'/'+collection+'/r',{method:'get'}));
  }
  for(const collection of ['faPerformanceAwards','faPerformanceLedger','users','contacts'])assert.doesNotThrow(()=>context.sahmtFgGuardWrite_(root+'/'+collection+'/r',{method:'patch'}));
});
