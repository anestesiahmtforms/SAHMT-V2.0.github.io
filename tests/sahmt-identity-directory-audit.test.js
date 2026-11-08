import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileProviderIdentities,SAHMT_IDENTITY_AUDIT_TARGETS} from '../scripts/audit-sahmt-identity-directory.mjs';
test('FD identity audit includes only FD and performance source projects',()=>{
 assert.deepEqual(Object.keys(SAHMT_IDENTITY_AUDIT_TARGETS),['FD','FG','FI','FB','FC','FE']);
 assert.equal(SAHMT_IDENTITY_AUDIT_TARGETS.FD[0],'rotinas-8a617');
});
const user=(id,raw,providerId='google.com')=>({localId:id,email:'same@example.test',providerUserInfo:raw?[{providerId,rawId:raw}]:[]});
test('email and local UID coincidence do not establish identity',()=>{
 const r=reconcileProviderIdentities([user('a','same@example.test','password')],[user('a','same@example.test','password')]);
 assert.equal(r.matches.size,0);assert.equal(r.counts.missingProviderEvidence,1);
});
test('official Google subject survives differing project UIDs',()=>{
 const r=reconcileProviderIdentities([user('a','subject')],[user('b','subject')]);assert.equal(r.matches.get('a'),'b');
});
test('ambiguous provider and duplicate destinations are counted',()=>{
 assert.equal(reconcileProviderIdentities([user('a','subject')],[user('b','subject'),user('c','subject')]).counts.ambiguous,1);
 assert.equal(reconcileProviderIdentities([user('a','subject'),user('b','subject')],[user('c','subject')]).counts.duplicateDestination,1);
});
