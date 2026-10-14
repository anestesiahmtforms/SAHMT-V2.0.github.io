import test from 'node:test';
import assert from 'node:assert/strict';
import {planIndicatorsUserAccess,indicatorsIdentityImportRequest} from '../scripts/lib/indicators-user-access-plan.js';
const user=(uid,extra={})=>({uid,email:uid+'@example.invalid',disabled:false,emailVerified:true,providerData:[],...extra});
const profile=uid=>({uid,email:uid+'@example.invalid',active:true,access:true,permissions:{}});
test('FC provisions only approved active FA users without altering permissions',()=>{
 const p=planIndicatorsUserAccess({sourceUsers:['a','b','c','d'].map(x=>user(x)),destinationUsers:[],profiles:[profile('a'),{...profile('b'),active:false},profile('c')],excludedUids:['c']});
 assert.equal(p.counts.create,1);assert.equal(p.counts.inactive,1);assert.equal(p.counts.excluded,1);assert.equal(p.counts.review,1);
 const req=indicatorsIdentityImportRequest(p);assert.equal(req.allowOverwrite,false);assert.equal(req.users[0].localId,'a');assert.deepEqual(p.permissionUpdates,[]);assert.equal('customClaims'in req.users[0],false);
});
test('existing UID stays untouched and email or disabled conflicts block import',()=>{
 for(const dest of [user('a'),user('other',{email:'a@example.invalid'}),user('a',{disabled:true})]){
 const p=planIndicatorsUserAccess({sourceUsers:[user('a')],destinationUsers:[dest],profiles:[profile('a')]});
 if(dest.uid==='a'&&!dest.disabled)assert.equal(p.counts.existing,1);else assert.throws(()=>indicatorsIdentityImportRequest(p));}
});
test('profile mismatch and duplicate source identities never become authorized',()=>{
 assert.equal(planIndicatorsUserAccess({sourceUsers:[user('a')],destinationUsers:[],profiles:[{...profile('a'),email:'other@example.invalid'}]}).counts.create,0);
 assert.throws(()=>planIndicatorsUserAccess({sourceUsers:[user('a'),user('a')],destinationUsers:[],profiles:[profile('a')]}));
});
test('known UID-only custom-token account is preserved without filling email or provider',()=>{
 const existing=user('a',{email:'',providerData:[]});const p=planIndicatorsUserAccess({sourceUsers:[user('a')],destinationUsers:[existing],profiles:[profile('a')]});
 assert.equal(p.counts.uidOnly,1);assert.equal(p.counts.conflicts,0);assert.equal(p.counts.create,0);assert.equal(existing.email,'');
});
