import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotIamPlan,exactPilotRole,mergePilotBindings,createPilotIamApi,inspectPilotIam,applyPilotIam,rollbackPilotIam} from '../scripts/management-pilot-iam.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const role=spec=>({name:spec.name,includedPermissions:[...spec.permissions],stage:'GA',etag:'ROLE_ETAG'});
const base=()=>({version:3,etag:'POLICY_ETAG',bindings:[{role:'roles/viewer',members:['user:unrelated@example.invalid']}],auditConfigs:[{service:'allServices'}]});
function harness(plan=pilotIamPlan('FB')) {
  let policy=base();const roles=new Map(),calls=[];let version=0;
  const api={getPolicy:async()=>{calls.push('getPolicy');return clone(policy);},getRole:async spec=>{calls.push('getRole');return roles.has(spec.name)?clone(roles.get(spec.name)):null;},
    createRole:async(_plan,spec)=>{calls.push('createRole');const value=role(spec);roles.set(spec.name,value);return clone(value);},
    setPolicy:async(_plan,value)=>{calls.push('setPolicy');assert.equal(value.etag,policy.etag);policy=clone(value);policy.etag='NEXT_'+(++version);return clone(policy);},
    deleteRole:async(spec,etag)=>{calls.push('deleteRole');assert.equal(etag,roles.get(spec.name).etag);roles.delete(spec.name);return {};}};
  return {plan,api,roles,calls,get policy(){return policy;},set policy(p){policy=p;}};
}
test('exact minimal permission sets and database condition',()=>{
  const fb=pilotIamPlan('FB'),fc=pilotIamPlan('FC');assert.equal(fb.roles.length,2);assert.equal(fc.roles.length,1);
  assert.deepEqual(fc.roles[0].permissions,['firebaseauth.users.get']);assert.equal(fb.roles[1].permissions.length,4);
  assert.equal(fb.roles[1].condition.expression,'resource.name == "projects/sahmt-gestao-5ae66/databases/(default)"');
  assert.ok(!fb.roles.flatMap(r=>r.permissions).some(p=>/delete|list|setIam|sign|updateUser|createUser/.test(p)));
  assert.equal(fb.roles[0].condition,undefined);assert.throws(()=>pilotIamPlan('FA'));
});
test('role reuse rejects extra permission, deletion and disabled stage',()=>{
  const s=pilotIamPlan('FC').roles[0],r=role(s);assert.equal(exactPilotRole(r,s),true);
  assert.equal(exactPilotRole({...r,includedPermissions:[...r.includedPermissions,'firebaseauth.users.create']},s),false);
  assert.equal(exactPilotRole({...r,deleted:true},s),false);assert.equal(exactPilotRole({...r,stage:'DISABLED'},s),false);
});
test('merge preserves etag, unrelated bindings and audit config',()=>{
  const p=base(),result=mergePilotBindings(p,pilotIamPlan('FB'));assert.equal(result.changed,true);assert.equal(result.policy.etag,p.etag);
  assert.deepEqual(result.policy.bindings[0],p.bindings[0]);assert.deepEqual(result.policy.auditConfigs,p.auditConfigs);assert.equal(p.bindings.length,1);
  assert.equal(mergePilotBindings(result.policy,pilotIamPlan('FB')).changed,false);
});
test('Google reordered condition keys do not duplicate an existing binding',()=>{
  const plan=pilotIamPlan('FB'),p=mergePilotBindings(base(),plan).policy;
  const b=p.bindings.find(b=>b.condition),c=b.condition;
  b.condition={expression:c.expression,title:c.title,description:c.description};
  assert.equal(mergePilotBindings(p,plan).changed,false);
});
test('rollback preserves previous grant and additional members',()=>{
  const plan=pilotIamPlan('FB'),before=mergePilotBindings(base(),{...plan,roles:[plan.roles[0]]}).policy;
  const current=mergePilotBindings(before,plan).policy;current.bindings[2].members.push('user:other@example.invalid');
  const reverted=mergePilotBindings(current,plan,{rollback:true,originalPolicy:before});
  assert.deepEqual(reverted.policy.bindings[1],before.bindings[1]);assert.deepEqual(reverted.policy.bindings[2].members,['user:other@example.invalid']);
});
test('malformed etag and duplicated binding fail closed',()=>{
  const plan=pilotIamPlan('FC');assert.throws(()=>mergePilotBindings({...base(),etag:''},plan));
  const p=mergePilotBindings(base(),plan).policy;p.bindings.push(clone(p.bindings[1]));assert.throws(()=>mergePilotBindings(p,plan));
});
test('HTTP adapter denies writes by default, without calling network',async()=>{
  let calls=0;const api=createPilotIamApi({token:'SYNTHETIC',fetchImpl:async()=>{calls++;throw Error('PRIVATE');}});const plan=pilotIamPlan('FB');
  await assert.rejects(api.createRole(plan,plan.roles[0]),/IAM_WRITE_NOT_AUTHORIZED/);await assert.rejects(api.setPolicy(plan,base()),/IAM_WRITE_NOT_AUTHORIZED/);assert.equal(calls,0);
});
test('HTTP error does not surface sensitive response or error message',async()=>{
  const api=createPilotIamApi({token:'SYNTHETIC',fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:{message:'PRIVATE'}})})});
  await assert.rejects(api.getPolicy(pilotIamPlan('FC')),e=>e.safeCode==='IAM_HTTP_ERROR'&&e.httpStatus===403&&!e.message.includes('PRIVATE'));
});
test('inspect invokes no mutation',async()=>{
  const h=harness();const s=await inspectPilotIam(h.api,h.plan);assert.equal(s.roles.length,2);assert.ok(!h.calls.some(c=>['setPolicy','createRole','deleteRole'].includes(c)));
});
test('inspect stops on existing role mismatch',async()=>{
  const h=harness();h.roles.set(h.plan.roles[0].name,{...role(h.plan.roles[0]),includedPermissions:['firebaseauth.users.delete']});
  await assert.rejects(inspectPilotIam(h.api,h.plan),/IAM_EXISTING_ROLE_MISMATCH/);
});
test('apply saves before mutation and preserves latest concurrent policy changes',async()=>{
  const h=harness(),s=await inspectPilotIam(h.api,h.plan);h.policy.bindings.push({role:'roles/browser',members:['user:concurrent@example.invalid']});
  const events=[];const result=await applyPilotIam(h.api,h.plan,s,async value=>events.push({calls:h.calls.slice(),state:clone(value)}));
  assert.equal(result.code,'PILOT_IAM_APPLIED');assert.ok(!events[0].calls.includes('createRole'));assert.equal(s.createdRoles.length,2);
  assert.ok(h.policy.bindings.some(b=>b.role==='roles/browser'));assert.equal(s.pendingBindingWrite,false);
});
test('apply does not overwrite existing exact roles or duplicate bindings',async()=>{
  const h=harness();for(const spec of h.plan.roles)h.roles.set(spec.name,role(spec));h.policy=mergePilotBindings(h.policy,h.plan).policy;
  const s=await inspectPilotIam(h.api,h.plan);await applyPilotIam(h.api,h.plan,s,async()=>{});assert.ok(!h.calls.includes('createRole'));assert.ok(!h.calls.includes('setPolicy'));
});
test('etag conflict is not retried',async()=>{
  const h=harness();h.api.setPolicy=async()=>{h.calls.push('setPolicy');throw Object.assign(Error('IAM_HTTP_ERROR'),{httpStatus:409});};
  const s=await inspectPilotIam(h.api,h.plan);await assert.rejects(applyPilotIam(h.api,h.plan,s,async()=>{}));assert.equal(h.calls.filter(c=>c==='setPolicy').length,1);
});
test('rollback removes only grants introduced and deletes unused new roles',async()=>{
  const h=harness(),s=await inspectPilotIam(h.api,h.plan);await applyPilotIam(h.api,h.plan,s,async()=>{});
  h.policy.bindings.push({role:'roles/browser',members:['user:later@example.invalid']});
  await rollbackPilotIam(h.api,h.plan,s,async()=>{});assert.equal(h.roles.size,0);assert.equal(h.policy.bindings.length,2);assert.equal(s.rolledBack,true);
});
test('rollback leaves role and concurrent grant used by another principal',async()=>{
  const h=harness(),s=await inspectPilotIam(h.api,h.plan);await applyPilotIam(h.api,h.plan,s,async()=>{});
  h.policy.bindings.find(b=>b.role===h.plan.roles[0].name).members.push('user:later@example.invalid');
  await rollbackPilotIam(h.api,h.plan,s,async()=>{});assert.equal(h.roles.size,1);assert.deepEqual(h.policy.bindings.find(b=>b.role===h.plan.roles[0].name).members,['user:later@example.invalid']);
});
test('uncertain role creation requires review before rollback',async()=>{
  const h=harness(),s=await inspectPilotIam(h.api,h.plan);s.pendingRoleCreate=h.plan.roles[0].name;
  await assert.rejects(rollbackPilotIam(h.api,h.plan,s,async()=>{}),/IAM_CREATE_OUTCOME_REVIEW_REQUIRED/);assert.ok(!h.calls.includes('deleteRole'));
});
