import test from 'node:test';import assert from 'node:assert/strict';
test('configuration validates explicit mappings and rejects ambiguous source identities before writes',async()=>{
 const {prepareSahmtConfiguration}=await import('../scripts/lib/sahmt-performance-configuration.js');
 const member={uid:'a',displayName:'Pessoa A',active:true,access:true,sourceUids:{FG:'fg-a',FI:'fi-a',FB:'fb-a',FC:'fc-a',FE:'fe-a'}};
 const config={members:[member],fiPolicy:{rule:'ATRASO_V1',effectiveFrom:'2026-11-01T00:00:00Z',cutoffDay:'2026-11-01'}};
 const plan=prepareSahmtConfiguration(config);assert.equal(plan.runtime.enabled,false);assert.equal(plan.runtime.projectId,'rotinas-8a617');assert.equal(plan.members[0].sourceUids.FG,'fg-a');assert.equal(plan.generation.length,64);
 assert.throws(()=>prepareSahmtConfiguration({...config,members:[member,{...member,uid:'b'}]}),/AMBIGUOUS/);
 assert.throws(()=>prepareSahmtConfiguration({...config,members:[{...member,sourceUids:{FG:'a'}}]}),/MAPPING/);
 assert.throws(()=>prepareSahmtConfiguration({...config,fiPolicy:{...config.fiPolicy,cutoffDay:'2026-02-31'}}),/POLICY/);
});
