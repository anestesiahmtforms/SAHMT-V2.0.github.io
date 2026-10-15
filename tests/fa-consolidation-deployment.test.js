import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeConsolidationScript,consolidationControlWrites,assertConsolidationDeployments} from '../scripts/lib/fa-consolidation-deployment.js';
const file=(name,source)=>({name,type:'SERVER_JS',source});
test('deployment merge preserves private remote files and refuses unrelated or stale edits',()=>{
 const remote={files:[file('EvaluationLedger','old'),file('PrivateInstaller','private'),{name:'appsscript',type:'JSON',source:'{}'}]};
 const result=mergeConsolidationScript({remote,baseFiles:{'EvaluationLedger.gs':'old'},localFiles:{'EvaluationLedger.gs':'new'}});
 assert.equal(result.files.find(x=>x.name==='PrivateInstaller').source,'private');
 assert.equal(result.files.find(x=>x.name==='appsscript').source,'{}');
 assert.equal(result.files.find(x=>x.name==='EvaluationLedger').source,'new');
 assert.equal(remote.files[0].source,'old');
 for(const patch of [{baseFiles:{'EvaluationLedger.gs':'stale'}},{localFiles:{'Config.gs':'invented'}}])
  assert.throws(()=>mergeConsolidationScript({remote,baseFiles:{'EvaluationLedger.gs':'old'},localFiles:{'EvaluationLedger.gs':'new'},...patch}));
});
test('saved source cannot disguise a Web App that still points to the old FB writer',()=>{
 const before={deployments:[{deploymentId:'synthetic-a',deploymentConfig:{versionNumber:3}},{deploymentId:'synthetic-head',deploymentConfig:{}}]};
 const current=structuredClone(before);current.deployments[0].deploymentConfig.versionNumber=4;
 assert.equal(assertConsolidationDeployments({before,current,versionNumber:4}),true);
 for(const mutate of [x=>x.deployments[0].deploymentConfig.versionNumber=3,x=>x.deployments.pop(),x=>x.deployments.push(x.deployments[0]),x=>x.deployments[0].deploymentId='different']){
  const changed=structuredClone(current);mutate(changed);assert.throws(()=>assertConsolidationDeployments({before,current:changed,versionNumber:4}));
 }
});
test('control writes require versioned evidence and cannot touch identities or delete data',()=>{
 const input={phase:'BLOCK',planSha256:'a'.repeat(64),verifiedDocuments:0};
 const blocked=consolidationControlWrites(input);
 assert.ok(blocked.every(x=>x.path.startsWith('managementRuntime/')&&!x.delete));
 assert.equal(blocked.find(x=>x.projectId==='sahmt-17a16'&&x.path.endsWith('faConsolidation')).fields.status.stringValue,'PREPARING');
 assert.throws(()=>consolidationControlWrites({...input,phase:'ACTIVATE'}));
 const evidence={plan:{ready:true,planSha256:input.planSha256,operations:Array(424).fill({})},
  verification:{code:'FA_CONSOLIDATION_VERIFIED',planSha256:input.planSha256,plannedDocuments:424,verified:424,sourcePreserved:true}};
 const active=consolidationControlWrites({...input,...evidence,phase:'ACTIVATE',verifiedDocuments:424});
 assert.equal(active.find(x=>x.path.endsWith('faConsolidation')).fields.status.stringValue,'ACTIVE');
 assert.equal(active.find(x=>x.projectId==='sahmt-gestao-5ae66').fields.evaluationEnabled.booleanValue,false);
 for(const phase of ['DELETE','ROLLBACK',''])assert.throws(()=>consolidationControlWrites({...input,phase}));
 for(const patch of [{verifiedDocuments:50},{verification:{...evidence.verification,code:'FA_CONSOLIDATION_PARTIAL'}},
  {verification:{...evidence.verification,planSha256:'b'.repeat(64)}},
  {verification:{...evidence.verification,verified:50}}])assert.throws(()=>consolidationControlWrites({...input,...evidence,phase:'ACTIVATE',verifiedDocuments:424,...patch}));
});
