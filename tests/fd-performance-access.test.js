import test from 'node:test';
import assert from 'node:assert/strict';
import {fdPerformanceIdentityCanEnter} from '../src/fd-performance-data.js';

const user={uid:'same-uid',email:'admin@example.invalid',emailVerified:true};
const profile={uid:user.uid,email:user.email,active:true,access:true,role:'administrador_app'};

test('FD performance menu eligibility requires the current active FA administrator identity',()=>{
 assert.equal(fdPerformanceIdentityCanEnter({status:'signed-in',user,profile}),true);
 assert.equal(fdPerformanceIdentityCanEnter({status:'signed-in',user,profile:{...profile,role:'usuario',permissions:{managementIndicatorsRead:true}}}),false);
 assert.equal(fdPerformanceIdentityCanEnter({status:'signed-in',user:{...user,uid:'other'},profile}),false);
 assert.equal(fdPerformanceIdentityCanEnter({status:'signed-in',user,profile:{...profile,active:false}}),false);
 assert.equal(fdPerformanceIdentityCanEnter({status:'loading',user,profile}),false);
});
