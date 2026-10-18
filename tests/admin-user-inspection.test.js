import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectionActivitiesForUser} from '../src/admin-user-inspection.js';
const activities=[{id:'general',active:true,eligibleGroups:['GENERAL']},{id:'restricted',active:true,eligibleGroups:['RESTRICTED']},{id:'individual',active:true,eligibleUids:['person']},{id:'inactive',active:false,eligibleGroups:['GENERAL']}];
test('inspection shows the subjects eligibility, not the administrators entire catalog',()=>{
 const profile={uid:'person',active:true,access:true,documentGroups:['GENERAL']};
 assert.deepEqual(inspectionActivitiesForUser(activities,profile).map(row=>row.id),['general','individual']);
});
test('blocked subjects do not obtain an active preview through an administrators session',()=>{
 for(const profile of [{active:false,access:true},{active:true,access:false}])assert.deepEqual(inspectionActivitiesForUser(activities,profile),[]);
});
test('administrative subjects retain their existing catalog access without being granted a role',()=>{
 const profile={uid:'person',role:'administrador_app',active:true,access:true,permissions:{}};
 assert.equal(inspectionActivitiesForUser(activities,profile).length,3);assert.deepEqual(profile.permissions,{});
});
