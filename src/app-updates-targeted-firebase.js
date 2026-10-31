import {doc, collection, getDocFromServer, getDocsFromServer, setDoc, updateDoc, serverTimestamp, query, orderBy, documentId, limit, startAfter, writeBatch} from 'firebase/firestore';
import {db} from './firebase.js';
import {auth} from './firebase-auth.js';
import {deployment} from './deployment-context.js';
import {newAppUpdateId} from './app-updates-targeted.js';

function actor(uid) {
  if (!uid || auth?.currentUser?.uid !== uid) throw Error('APP_UPDATE_SESSION_CHANGED');
}
export async function recordAppInstallation(value) {
  actor(value.uid);
  if (value.target !== deployment.target) throw Error('APP_UPDATE_TARGET_MISMATCH');
  await setDoc(doc(db, 'users', value.uid, 'appInstallations', value.deviceId + '_' + value.target), {
    ...value, lastSeenAt: serverTimestamp()
  });
}
export async function readUserAppUpdates(actorUid, uid) {
  actor(actorUid);
  const [profile, devices] = await Promise.all([
    getDocFromServer(doc(db, 'users', uid)),
    getDocsFromServer(collection(db, 'users', uid, 'appInstallations'))
  ]);
  actor(actorUid);
  return {request: profile.data()?.appUpdateRequest || null, devices: devices.docs.map(item => item.data())};
}
export async function requestUserAppUpdate(actorUid, uid, minimumRelease) {
  actor(actorUid);
  if (!Number.isSafeInteger(minimumRelease) || minimumRelease <= 0) throw Error('APP_UPDATE_RELEASE_INVALID');
  await updateDoc(doc(db, 'users', uid), {appUpdateRequest: {
    id: newAppUpdateId(), target: deployment.target, minimumRelease,
    requestedByUid: actorUid, requestedAt: serverTimestamp()
  }});
}
export async function cancelUserAppUpdate(actorUid, uid) {
  actor(actorUid);
  await updateDoc(doc(db, 'users', uid), {appUpdateRequest: null});
}
export async function listAppUpdateUsers(actorUid) {
  actor(actorUid);
  const users = []; let cursor = null;
  do {
    const page = await getDocsFromServer(query(collection(db, 'users'), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(200)));
    actor(actorUid); users.push(...page.docs.map(item => ({...item.data(), uid: item.id})));
    cursor = page.size === 200 ? page.docs.at(-1) : null;
  } while (cursor);
  return users.filter(user => user.active === true && user.access === true);
}
export async function sendAppUpdateBatch(actorUid, uids, minimumRelease) {
  actor(actorUid);
  if (uids.length > 200 || !Number.isSafeInteger(minimumRelease) || minimumRelease <= 0) throw Error('APP_UPDATE_BATCH_INVALID');
  const batch = writeBatch(db), id = newAppUpdateId();
  for (const uid of uids) batch.update(doc(db, 'users', uid), {appUpdateRequest: {
    id, target: deployment.target, minimumRelease, requestedByUid: actorUid, requestedAt: serverTimestamp()
  }});
  await batch.commit(); actor(actorUid);
}
