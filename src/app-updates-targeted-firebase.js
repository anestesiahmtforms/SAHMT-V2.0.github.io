import {doc, collection, getDocFromServer, getDocsFromServer, setDoc, updateDoc, runTransaction, serverTimestamp, query, orderBy, documentId, limit, startAfter, writeBatch, onSnapshot} from 'firebase/firestore';
import {db} from './firebase.js';
import {auth} from './firebase-auth.js';
import {deployment} from './deployment-context.js';
import {newAppUpdateId} from './app-updates-targeted.js';
import {updateUsersWithContactSiglas} from './app-updates-targeted-identity.js';
import {isSystemOwnerEmail} from './system-account-exclusions.js';
import {reconnectionReceiptId} from './app-reconnection-receipts.js';

function actor(uid) {
  if (!uid || auth?.currentUser?.uid !== uid) throw Error('APP_UPDATE_SESSION_CHANGED');
}
export async function recordAppInstallation({reconnectionConfirmed=false,...value}) {
  actor(value.uid);
  if (value.target !== deployment.target) throw Error('APP_UPDATE_TARGET_MISMATCH');
  const device=doc(db,'users',value.uid,'appInstallations',value.deviceId+'_'+value.target);
  const payload={...value,lastSeenAt:serverTimestamp()};
  const receiptId=reconnectionConfirmed&&value.confirmedRequestId&&reconnectionReceiptId(value.deviceId);
  if(!receiptId)return setDoc(device,payload);
  const receipt=doc(db,'users',value.uid,'appInstallations',receiptId+'_'+value.target);
  await runTransaction(db,async tx=>{
    actor(value.uid);
    const [knownDevice,knownReceipt]=await Promise.all([tx.get(device),tx.get(receipt)]);
    actor(value.uid);
    // An earlier confirmed installation has no separate confirmation timestamp.
    if(!knownReceipt.exists()&&knownDevice.data()?.confirmedRequestId!==value.confirmedRequestId)
      tx.set(receipt,{...payload,deviceId:receiptId});
    tx.set(device,payload);
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
export function watchAppInstallations(actorUid,uid,onData,onError){
  actor(actorUid);
  return onSnapshot(collection(db,'users',uid,'appInstallations'),{includeMetadataChanges:true},snapshot=>{
    try{actor(actorUid);}catch(error){onError(error);return;}
    if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
    onData(snapshot.docs.map(item=>item.data()));
  },onError);
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
  const readAll=async root=>{
    const rows=[];let cursor=null;
    do{
      const page=await getDocsFromServer(query(collection(db,root),orderBy(documentId()),...(cursor?[startAfter(cursor)]:[]),limit(200)));
      actor(actorUid);rows.push(...page.docs.map(item=>({...item.data(),...(root==='users'?{uid:item.id}:{})})));
      cursor=page.size===200?page.docs.at(-1):null;
    }while(cursor);
    return rows;
  };
  const [users,contacts]=await Promise.all([readAll('users'),deployment.target==='FA'?readAll('contacts').catch(()=>[]):Promise.resolve([])]);
  actor(actorUid);
  return updateUsersWithContactSiglas(users.filter(user=>user.active===true&&user.access===true&&!isSystemOwnerEmail(user.email)),contacts);
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
