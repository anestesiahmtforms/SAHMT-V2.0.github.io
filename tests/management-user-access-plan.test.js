import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeManagementAuthUser, planManagementUserAccess, managementIdentityImportRequest, managementPermissionWrites} from '../scripts/lib/management-user-access-plan.js';
const user = (uid = 'member', extra = {}) => ({uid, email: `${uid}@example.invalid`, displayName: 'Synthetic', disabled: false, emailVerified: true, providerData: [], ...extra});
const profile = (uid = 'member', extra = {}) => ({uid, email: `${uid}@example.invalid`, active: true, access: true,
  updateTime: '2026-10-14T10:00:00.000001Z', permissions: {checklistRead: true}, ...extra});
const plan = (extra = {}) => planManagementUserAccess({sourceUsers: [user()], destinationUsers: [], profiles: [profile()], ...extra});
test('discards credentials immediately instead of persisting raw accounts', () => {
  const value = sanitizeManagementAuthUser({localId: 'member', email: 'member@example.invalid', passwordHash: 'DO_NOT_KEEP', salt: 'DO_NOT_KEEP', passwordSalt: 'DO_NOT_KEEP', refreshToken: 'DO_NOT_KEEP', customAttributes: 'DO_NOT_KEEP', validSince: 'DO_NOT_KEEP'});
  assert.equal(JSON.stringify(value).includes('DO_NOT_KEEP'), false);
  assert.equal(value.disabled, false);
});
test('preserves UID, identity and disabled state with no account overwrite or credentials', () => {
  const result = plan({sourceUsers: [user('member', {disabled: true})]});
  const request = managementIdentityImportRequest(result);
  assert.equal(request.users[0].localId, 'member'); assert.equal(request.users[0].disabled, true);
  assert.equal(request.allowOverwrite, false); assert.equal(request.sanityCheck, true);
  assert.equal(result.permissionUpdates.length, 0);
});
test('existing matching identity is preserved and not imported again', () => {
  const result = plan({destinationUsers: [user('member', {displayName: 'Existing name', providerData: [{providerId: 'google.com', uid: 'g'}]})]});
  assert.equal(result.counts.existing, 1); assert.deepEqual(result.createUsers, []);
});
test('same email with another destination UID blocks import', () => {
  const result = plan({destinationUsers: [user('other', {email: 'member@example.invalid'})]});
  assert.equal(result.counts.conflicts, 1); assert.throws(() => managementIdentityImportRequest(result), /NOT_READY/);
});
test('same UID with different identity or disabled state is a conflict', () => {
  for (const override of [{email: 'other@example.invalid'}, {disabled: true}])
    assert.equal(plan({destinationUsers: [user('member', override)]}).counts.conflicts, 1);
});
test('common access patches only two fields and never removes existing privileges', () => {
  const sourceProfile = profile('member', {permissions: {admin: true, financeRead: true, checklistSign: true}});
  const original = structuredClone(sourceProfile);
  const result = plan({profiles: [sourceProfile]});
  const [write] = managementPermissionWrites(result);
  assert.deepEqual(write.updateMask.fieldPaths, ['permissions.managementRead', 'permissions.trainingsRead']);
  assert.deepEqual(write.currentDocument, {updateTime: original.updateTime});
  assert.deepEqual(sourceProfile, original);
  assert.deepEqual(Object.keys(write.update.fields), ['permissions']);
  assert.equal(JSON.stringify(write).includes('admin'), false);
});
test('inactive, denied or disabled identities never gain access', () => {
  for (const override of [{active: false}, {access: false}])
    assert.equal(plan({profiles: [profile('member', override)]}).permissionUpdates.length, 0);
});
test('protected profiles and confirmed homologation identities stay unchanged', () => {
  assert.equal(plan({protectedProfileUids: ['member']}).permissionUpdates.length, 0);
  const result = plan({excludedUids: ['member']});
  assert.equal(result.createUsers.length, 0); assert.equal(result.permissionUpdates.length, 0);
  assert.throws(() => plan({excludedUids: ['unknown']}), /UNCONFIRMED/);
});
test('absent or mismatched FA profile never gains module permissions', () => {
  for (const profiles of [[], [profile('member', {email: 'different@example.invalid'})]]) {
    const result = plan({profiles}); assert.equal(result.permissionUpdates.length, 0); assert.equal(result.counts.review, 1);
  }
});
test('idempotent plan does not reapply existing access', () => {
  const result = plan({destinationUsers: [user()], profiles: [profile('member', {permissions: {managementRead: true, trainingsRead: true, checklistRead: true}})]});
  assert.equal(result.createUsers.length, 0); assert.equal(result.permissionUpdates.length, 0); assert.equal(result.counts.accessAlreadyReady, 1);
});
test('duplicate source email blocks both candidates and duplicate UID rejects input', () => {
  const a=user(), b=user('other', {email:a.email});
  assert.equal(plan({sourceUsers:[a,b]}).counts.conflicts, 2);
  assert.throws(()=>plan({sourceUsers:[a,a]}), /DUPLICATE/);
});
test('forged administrator field cannot be applied or imported', () => {
  const p=plan(); p.permissionUpdates[0].additions.push('admin');
  assert.throws(()=>managementPermissionWrites(p), /FORBIDDEN/);
  const q=plan(); q.createUsers[0].customAttributes='{}';
  assert.throws(()=>managementIdentityImportRequest(q), /FORBIDDEN/);
});
