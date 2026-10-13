import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirebaseSecondarySessionLifecycle, signOutAllFirebaseProjects} from '../src/firebase-secondary-session-lifecycle.js';
import {FIREBASE_PROJECTS} from '../src/firebase-projects.js';

function fixture({fbUid = null, fcUid = null} = {}) {
  const apps = Object.fromEntries(['FB', 'FC'].map(name => {
    const project = FIREBASE_PROJECTS[name];
    return [name, {name: project.appName, options: {projectId: project.projectId}, auth: {currentUser: fbUid || fcUid
      ? {uid: name === 'FB' ? fbUid : fcUid} : null}}];
  }));
  const calls = [];
  const lifecycle = createFirebaseSecondarySessionLifecycle({
    listApps: () => Object.values(apps),
    getExistingAuth: app => app.auth,
    signOut: async auth => { calls.push(auth); auth.currentUser = null; }
  });
  return {apps, calls, lifecycle};
}

test('global secondary logout clears existing FB and FC sessions without touching FA', async () => {
  const {apps, calls, lifecycle} = fixture({fbUid: 'user-a', fcUid: 'user-a'});
  const faAuth = {currentUser: {uid: 'user-a'}};
  const result = await lifecycle.signOutAll();
  assert.equal(result.status, 'complete');
  assert.deepEqual([...result.cleared].sort(), ['FB', 'FC']);
  assert.equal(calls.length, 2);
  assert.equal(apps.FB.auth.currentUser, null);
  assert.equal(apps.FC.auth.currentUser, null);
  assert.equal(faAuth.currentUser.uid, 'user-a');
});

test('FA account switch signs out mismatched secondary UIDs and retains matching sessions', async () => {
  const {apps, calls, lifecycle} = fixture({fbUid: 'user-b', fcUid: 'user-a'});
  const result = await lifecycle.reconcileForFaUid('user-a');
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.cleared, ['FB']);
  assert.equal(calls.length, 1);
  assert.equal(apps.FB.auth.currentUser, null);
  assert.equal(apps.FC.auth.currentUser.uid, 'user-a');
});

test('signed-out FA context clears every existing secondary session', async () => {
  const {apps, lifecycle} = fixture({fbUid: 'user-a', fcUid: 'user-b'});
  await lifecycle.reconcileForFaUid(null);
  assert.equal(apps.FB.auth.currentUser, null);
  assert.equal(apps.FC.auth.currentUser, null);
});

test('missing target apps are not initialized during cleanup', async () => {
  const {calls, lifecycle} = fixture({fbUid: 'user-a'});
  let lookups = 0;
  const guarded = createFirebaseSecondarySessionLifecycle({
    listApps: () => [{name: FIREBASE_PROJECTS.FB.appName, options: {projectId: FIREBASE_PROJECTS.FB.projectId}, auth: {currentUser: {uid: 'user-a'}}}],
    getExistingAuth: app => { lookups++; return app.auth; },
    signOut: async auth => { calls.push(auth); auth.currentUser = null; }
  });
  const result = await guarded.signOutAll();
  assert.deepEqual(result.cleared, ['FB']);
  assert.equal(lookups, 1);
  assert.equal(calls.length, 1);
  lifecycle.dispose();
});

test('FC cleanup failure is reported without preventing FB cleanup', async () => {
  const apps = Object.fromEntries(['FB', 'FC'].map(name => {
    const project = FIREBASE_PROJECTS[name];
    return [name, {name: project.appName, options: {projectId: project.projectId}, auth: {currentUser: {uid: 'user-a'}}}];
  }));
  const lifecycle = createFirebaseSecondarySessionLifecycle({listApps: () => Object.values(apps),
    getExistingAuth: app => app.auth,
    signOut: async auth => {
      if (auth === apps.FC.auth) throw new Error('private detail must not escape');
      auth.currentUser = null;
    }});
  const result = await lifecycle.signOutAll();
  assert.deepEqual(result, {status: 'partial', cleared: ['FB'], failed: ['FC']});
  assert.equal(apps.FB.auth.currentUser, null);
  assert.equal(apps.FC.auth.currentUser.uid, 'user-a');
  assert.equal(JSON.stringify(result).includes('private detail'), false);
});

test('global logout attempts FA even when a secondary cleanup fails and reports partial logout', async () => {
  const calls = [];
  const complete = await signOutAllFirebaseProjects({
    signOutPrimary: async () => { calls.push('FA'); },
    signOutSecondary: async () => { calls.push('FB+FC'); return {status: 'partial'}; }
  });
  assert.equal(complete, false);
  assert.deepEqual(calls.sort(), ['FA', 'FB+FC']);
});

test('global logout attempts FB and FC cleanup even if FA signOut rejects', async () => {
  const calls = [];
  const complete = await signOutAllFirebaseProjects({
    signOutPrimary: async () => { calls.push('FA'); throw new Error('private'); },
    signOutSecondary: async () => { calls.push('FB+FC'); return {status: 'complete'}; }
  });
  assert.equal(complete, false);
  assert.deepEqual(calls.sort(), ['FA', 'FB+FC']);
});

test('a newer FA identity invalidates remaining work from an older cleanup', async () => {
  const apps = Object.fromEntries(['FB', 'FC'].map(name => {
    const project = FIREBASE_PROJECTS[name];
    return [name, {name: project.appName, options: {projectId: project.projectId}, auth: {currentUser: {uid: 'old-user'}}}];
  }));
  let releaseFb;
  const calls = [];
  const lifecycle = createFirebaseSecondarySessionLifecycle({listApps: () => Object.values(apps),
    getExistingAuth: app => app.auth,
    signOut: auth => {
      calls.push(auth);
      if (auth === apps.FB.auth) return new Promise(resolve => { releaseFb = () => { auth.currentUser = null; resolve(); }; });
      auth.currentUser = null;
    }});
  const priorCleanup = lifecycle.reconcileForFaUid('new-user');
  await new Promise(resolve => setImmediate(resolve));
  const nextCleanup = lifecycle.reconcileForFaUid('next-user');
  releaseFb();
  await Promise.all([priorCleanup, nextCleanup]);
  assert.equal(apps.FB.auth.currentUser, null);
  assert.equal(apps.FC.auth.currentUser, null);
  assert.equal(calls.filter(auth => auth === apps.FC.auth).length, 1);
});
